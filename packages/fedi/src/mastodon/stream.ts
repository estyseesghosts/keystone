// Mastodon-family WebSocket streaming client (/api/v1/streaming).
//
// One POOLED handle per backend (MD10): a single socket per
// (stream, params) key, shared across every timeline, notification and
// post subscription — subscribing a second feed never closes the first's
// socket (the old one-socket-per-handle did). Sockets are created LAZILY
// (nothing dials until the first subscribe — the handle is inert when
// unmounted) and close when their last listener leaves.
//
// The socket dials the ADVERTISED streaming origin (`instance.ts`
// `streamingOrigin`: `configuration.urls.streaming` on v2,
// `urls.streaming_api` on v1 — split-host instances put it on a
// different host), falling back to the session origin's ws(s) mapping
// when none was advertised AND whenever the advertised scheme disagrees
// with the session's (contract §8: an https session only dials `wss`,
// an http session only `ws` — a mismatched advertisement is ignored
// rather than handed a token). The token never rides the URL: it is sent
// as the `Sec-WebSocket-Protocol: Bearer, <token>` subprotocol pair,
// which both Mastodon and Akkoma accept (Akkoma ignores a Bearer
// handshake header), and only to the resolved streaming origin. When no
// WebSocket implementation exists, `createStreamHandle` answers null and
// feeds keep the polling fallback (refresh + cursor paging), never an
// error.
//
// Wire protocol: text frames of `{event, payload}` where `payload` is
// itself a JSON string (`update` / `status.update` carry a Status,
// `delete` carries the bare id, `notification` a Notification). Akkoma
// also sends a bare text `ping` frame (not JSON) which is answered with
// `pong`. `kill` closes that socket for good (no reconnect) and
// `filters_changed` is surfaced so the app can invalidate its filter
// query. Reconnect is bounded: a 10s watchdog for the open/connected ack
// and a breaker after 5 fast closes (see `CONNECT_ACK_TIMEOUT_MS`).

import type { FeedChannelState, FeedSource, FeedSubscription, PostUpdateEvent, StreamHandle, StreamState } from "../core/backend";
import type { Notification, Post } from "../core/models";
import { adaptNotification, adaptStatus } from "./adapt";
import type { Notification as WireNotification, Status as WireStatus } from "./wire";

export type MastoStreamStatus = StreamState;

/** Minimal WebSocket surface this module needs (the global WebSocket
 * satisfies it; tests inject a mock). `send` is used for the `pong`
 * answer only — a mock without it simply stays silent. */
export interface MastoSocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown } | unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  close(): void;
  send?(data: string): void;
}

/** `(url, protocols)` → socket. The protocols carry the auth pair
 * (`["Bearer", token]`), never the query string. */
export type WebSocketFactory = (url: string, protocols?: string[]) => MastoSocket;

export interface StreamHandleOptions {
  /** Session token, sent as the `Sec-WebSocket-Protocol` bearer pair to
   * the streaming origin only. */
  token?: string | null;
  /** Advertised streaming origin (`instance.ts` `streamingOrigin`, a
   * `ws(s)://host[:port]` origin). When null — or when its scheme does
   * not match the session origin's — the session origin's ws(s) mapping
   * is used, never an assumed third host. */
  streamingOrigin?: string | null;
  /** WebSocket constructor seam (tests inject a mock). */
  wsFactory?: WebSocketFactory;
}

function defaultFactory(url: string, protocols?: string[]): MastoSocket | null {
  try {
    const WS = (
      globalThis as {
        WebSocket?: new (url: string, protocols?: string | string[]) => MastoSocket;
      }
    ).WebSocket;
    if (typeof WS !== "function") return null;
    return protocols && protocols.length > 0 ? new WS(url, protocols) : new WS(url);
  } catch {
    return null;
  }
}

export function streamingSupported(): boolean {
  return (
    typeof (globalThis as { WebSocket?: unknown }).WebSocket === "function"
  );
}

/** Session origin → its `ws(s)` mapping (`https:` → `wss`, else `ws`). */
function wsOriginOf(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol === "https:") return `wss://${url.host}`;
    if (url.protocol === "http:") return `ws://${url.host}`;
    return null;
  } catch {
    return null;
  }
}

/** An advertised origin is only usable when its scheme matches the
 * session origin's (`https` → `wss`, `http` → `ws`). A split host is
 * fine; a scheme downgrade/upgrade is not — that advertised host is
 * ignored instead of being handed the session token. */
export function streamingOriginAllowed(
  origin: string,
  advertised: string | null | undefined,
): boolean {
  if (!advertised) return false;
  let protocol: string;
  try {
    protocol = new URL(advertised).protocol;
  } catch {
    return false;
  }
  const session = wsOriginOf(origin);
  if (session === null) return protocol === "ws:" || protocol === "wss:";
  return protocol === (session.startsWith("wss:") ? "wss:" : "ws:");
}

/** The streaming base for `origin`: the advertised origin when it passes
 * the scheme pin, otherwise the session origin's ws(s) mapping. Exported
 * for tests. */
export function resolveStreamingBase(
  origin: string,
  advertised: string | null | undefined = null,
): string {
  const fallback =
    wsOriginOf(origin) ??
    origin.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  if (!streamingOriginAllowed(origin, advertised)) return fallback;
  try {
    return new URL(advertised as string).origin;
  } catch {
    return fallback;
  }
}

/** `origin` (or the advertised streaming base) → `…/api/v1/streaming?stream=…`.
 * The URL carries no token: auth rides the `Sec-WebSocket-Protocol` pair. */
export function streamUrl(
  origin: string,
  stream: string,
  params: Record<string, string> = {},
  streamingBase?: string | null,
): string {
  const base = resolveStreamingBase(origin, streamingBase);
  const u = new URL(`${base}/api/v1/streaming`);
  u.searchParams.set("stream", stream);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function backoffMs(attempt: number): number {
  return Math.min(30000, 1000 * Math.pow(2, attempt));
}

/** How long a dialed socket may go without an open/`connected` ack
 * before the dial is treated as a failure (contract §8: 10s). */
const CONNECT_ACK_TIMEOUT_MS = 10_000;
/** A close this soon after open — or a socket that never opened at all —
 * counts toward the fast-close breaker. */
const FAST_CLOSE_MS = 10_000;
/** Consecutive fast closes that mean "the server is refusing us": stop
 * re-dialing and surface the honest dead state (manual retry only). */
const MAX_FAST_CLOSES = 5;


function streamNameFor(source: FeedSource): { stream: string; params: Record<string, string> } | null {
  if ("kind" in source) {
    if (source.kind === "home") return { stream: "user", params: {} };
    if (source.kind === "local") return { stream: "public:local", params: {} };
    // No social equivalent on the Mastodon family: no socket, the feed
    // falls back to paging + refresh (never an error, never an empty fake).
    if (source.kind === "social") return null;
    return { stream: "public", params: {} };
  }
  if ("listId" in source) {
    return { stream: "list", params: { list: source.listId } };
  }
  if ("tag" in source) {
    return { stream: "hashtag", params: { tag: source.tag } };
  }
  return null;
}

interface PostSub {
  onUpdated?: (event: PostUpdateEvent) => void;
  onDeleted?: () => void;
}

interface Entry {
  stream: string;
  params: Record<string, string>;
  socket: MastoSocket | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Watchdog for the open/`connected` ack of the current dial. */
  connectTimer: ReturnType<typeof setTimeout> | null;
  /** When the current socket reported open (null = never opened). */
  openedAt: number | null;
  /** Consecutive fast closes (breaker reset by a healthy connection). */
  fastCloses: number;
  /** `kill` / breaker tripped: no redial until `retry()`. */
  dead: boolean;
  attempt: number;
  state: StreamState;
  updates: Set<(post: Post) => void>;
  notifications: Set<(n: Notification) => void>;
  deletes: Set<(id: string) => void>;
  posts: Map<string, Set<PostSub>>;
}

function entryKey(stream: string, params: Record<string, string>): string {
  const qp = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return qp.length > 0 ? `${stream}?${qp}` : stream;
}

function channelStatusOf(state: StreamState): FeedChannelState {
  if (state === "connected") return "subscribed";
  if (state === "unavailable" || state === "stopped") return "unavailable";
  return "pending";
}

export function createStreamHandle(
  origin: string,
  opts: StreamHandleOptions = {},
): StreamHandle | null {
  const globalFactory: WebSocketFactory | null = streamingSupported()
    ? (url: string, protocols?: string[]) => {
        const socket = defaultFactory(url, protocols);
        if (!socket) throw new Error(`No WebSocket implementation for ${url}.`);
        return socket;
      }
    : null;
  const maybeFactory: WebSocketFactory | null = opts.wsFactory ?? globalFactory;
  if (!maybeFactory) return null;
  const factory: WebSocketFactory = maybeFactory;

  const token = opts.token ?? null;
  // Auth as subprotocols (`["Bearer", token]`), accepted by Mastodon and
  // Akkoma alike; a bare handshake `Authorization` header is ignored by
  // Akkoma. The URL never carries the token.
  const protocols = token ? ["Bearer", token] : undefined;
  const streamingBase = opts.streamingOrigin ?? null;
  const entries = new Map<string, Entry>();
  const listeners = new Set<(s: StreamState) => void>();
  const filterListeners = new Set<() => void>();

  const noSubscription: FeedSubscription = {
    unsubscribe: () => undefined,
    status: () => "disabled",
  };

  function overall(): StreamState {
    if (entries.size === 0) return "connecting";
    let fresh = false;
    let retry = false;
    let dead = false;
    let err: StreamState | null = null;
    for (const e of entries.values()) {
      if (e.state === "connected") return "connected";
      if (e.state === "connecting") {
        if (e.attempt === 0) fresh = true;
        else retry = true;
      } else if (e.state === "reconnecting") {
        retry = true;
      } else if (e.state === "stopped") {
        dead = true;
      } else if (e.state === "error" || e.state === "unavailable") {
        err = e.state;
      }
    }
    // A dead entry (kill / breaker) is not "retrying": the badge must say
    // so instead of spinning "Reconnecting…" forever.
    if (dead) return "stopped";
    // A first dial reads "connecting" (the badge's pending state); only
    // a dropped socket retrying reads "reconnecting".
    if (fresh) return "connecting";
    if (retry) return "reconnecting";
    if (err !== null) return err;
    return "connecting";
  }

  function notify(): void {
    const s = overall();
    for (const fn of listeners) {
      try {
        fn(s);
      } catch {
        // Listener failures never break the socket.
      }
    }
  }

  /** `filters_changed` arrived: the app re-reads its filter list. */
  function notifyFiltersChanged(): void {
    for (const fn of filterListeners) {
      try {
        fn();
      } catch {
        // Listener failures never break the socket.
      }
    }
  }

  function entryEmpty(e: Entry): boolean {
    if (e.updates.size > 0 || e.notifications.size > 0 || e.deletes.size > 0) return false;
    for (const subs of e.posts.values()) if (subs.size > 0) return false;
    return true;
  }

  function closeEntry(e: Entry): void {
    if (e.socket) {
      try {
        e.socket.close();
      } catch {
        // Ignore.
      }
      e.socket = null;
    }
    if (e.timer) {
      clearTimeout(e.timer);
      e.timer = null;
    }
    if (e.connectTimer) {
      clearTimeout(e.connectTimer);
      e.connectTimer = null;
    }
    e.openedAt = null;
  }

  function dropIfEmpty(key: string, e: Entry): void {
    if (!entryEmpty(e)) return;
    closeEntry(e);
    entries.delete(key);
    notify();
  }

  /** Drop the current socket for good: `kill` and the breaker both mean
   * "do not re-dial until the user asks". The entry (and its listeners)
   * stay so status/subscriptions survive; only `retry()` revives it. */
  function stopEntry(e: Entry): void {
    closeEntry(e);
    e.dead = true;
    e.state = "stopped";
    notify();
  }

  function sendPong(socket: MastoSocket | null): void {
    if (!socket || typeof socket.send !== "function") return;
    try {
      socket.send("pong");
    } catch {
      // A failed pong never breaks the socket.
    }
  }

  /** One socket went away (close, error-close or ack timeout). Decide
   * between a bounded redial and the dead state. */
  function socketGone(key: string, e: Entry): void {
    const openedAt = e.openedAt;
    e.openedAt = null;
    if (!entries.has(key) || entryEmpty(e)) {
      e.state = "unavailable";
      notify();
      return;
    }
    if (e.dead) {
      e.state = "stopped";
      notify();
      return;
    }
    // Fast-fail breaker: a socket that never opened, or one that closed
    // within FAST_CLOSE_MS of opening, over and over, means the server is
    // refusing us (revoked token, bad origin). A connection that stayed
    // up resets the count — normal reconnects keep their behaviour.
    const fast = openedAt === null || Date.now() - openedAt < FAST_CLOSE_MS;
    if (fast) {
      e.fastCloses += 1;
      if (e.fastCloses >= MAX_FAST_CLOSES) {
        e.dead = true;
        e.state = "stopped";
        notify();
        return;
      }
    } else {
      e.fastCloses = 0;
    }
    e.state = e.attempt === 0 ? "error" : "reconnecting";
    notify();
    e.attempt += 1;
    const delay = backoffMs(e.attempt);
    e.timer = setTimeout(() => {
      e.timer = null;
      if (entries.get(key) === e && !entryEmpty(e)) open(key, e);
    }, delay);
  }

  function routeMessage(raw: unknown, key: string, e: Entry): void {
    if (typeof raw !== "string") return;
    // Akkoma sends a bare text `ping` (not JSON): answer `pong`, never
    // route it as an event and never log it as malformed.
    if (raw.trim() === "ping") {
      sendPong(e.socket);
      return;
    }
    let frame: { event?: unknown; payload?: unknown };
    try {
      frame = JSON.parse(raw) as { event?: unknown; payload?: unknown };
    } catch {
      return; // malformed: ignore
    }
    if (typeof frame.event !== "string") return;
    // Control frames first — a defensive `{event:"ping"}` shape answers
    // the same way as the bare text frame.
    if (frame.event === "ping") {
      sendPong(e.socket);
      return;
    }
    if (frame.event === "connected") {
      // Open ack (some deployments send it as a frame): clear the
      // watchdog without waiting for `onopen`.
      if (e.connectTimer) {
        clearTimeout(e.connectTimer);
        e.connectTimer = null;
      }
      if (e.state !== "connected") {
        e.openedAt = e.openedAt ?? Date.now();
        e.attempt = 0;
        e.state = "connected";
        notify();
      }
      return;
    }
    if (frame.event === "kill") {
      // The server is terminating this connection for good (e.g. a
      // reauth requirement): close it and do NOT schedule a reconnect.
      stopEntry(e);
      return;
    }
    if (frame.event === "filters_changed") {
      notifyFiltersChanged();
      return;
    }
    const payload = typeof frame.payload === "string" ? frame.payload : null;
    try {
      if (frame.event === "update" || frame.event === "status.update") {
        if (payload === null) return;
        const post = adaptStatus(JSON.parse(payload) as WireStatus);
        for (const fn of e.updates) {
          try {
            fn(post);
          } catch {
            // Listener failures never break the socket.
          }
        }
        const subs = e.posts.get(post.id);
        if (subs) {
          for (const sub of subs) {
            try {
              sub.onUpdated?.({ id: post.id, type: frame.event });
            } catch {
              // Ignore.
            }
          }
        }
      } else if (frame.event === "delete") {
        if (payload !== null) {
          for (const fn of e.deletes) {
            try {
              fn(payload);
            } catch {
              // Ignore.
            }
          }
          const subs = e.posts.get(payload);
          if (subs) {
            for (const sub of subs) {
              try {
                sub.onDeleted?.();
              } catch {
                // Ignore.
              }
            }
          }
        }
      } else if (frame.event === "notification") {
        if (payload === null) return;
        const n = adaptNotification(JSON.parse(payload) as WireNotification);
        for (const fn of e.notifications) {
          try {
            fn(n);
          } catch {
            // Ignore.
          }
        }
      }
    } catch {
      // Malformed payload: ignore.
    }
  }

  function open(key: string, e: Entry): void {
    closeEntry(e);
    // A dead entry (kill / breaker) only redials through `retry()`.
    if (e.dead) return;
    e.state = "connecting";
    notify();
    let ws: MastoSocket;
    try {
      ws = factory(streamUrl(origin, e.stream, e.params, streamingBase), protocols);
    } catch {
      e.state = "unavailable";
      notify();
      return;
    }
    e.socket = ws;
    // Ack watchdog: a dial that never opens is a failure, not a permanent
    // "connecting". Closing it feeds the same path as a real close.
    e.connectTimer = setTimeout(() => {
      e.connectTimer = null;
      if (e.socket !== ws) return;
      e.socket = null;
      try {
        ws.close();
      } catch {
        // Ignore — the state moves on regardless.
      }
      socketGone(key, e);
    }, CONNECT_ACK_TIMEOUT_MS);
    ws.onopen = () => {
      if (e.socket !== ws) return;
      if (e.connectTimer) {
        clearTimeout(e.connectTimer);
        e.connectTimer = null;
      }
      e.openedAt = Date.now();
      e.fastCloses = 0;
      e.attempt = 0;
      e.state = "connected";
      notify();
    };
    ws.onerror = () => {
      if (e.socket !== ws) return;
      e.state = e.attempt === 0 ? "error" : "reconnecting";
      notify();
    };
    ws.onclose = () => {
      if (e.socket !== ws) return; // superseded by a newer socket / watchdog
      e.socket = null;
      if (e.connectTimer) {
        clearTimeout(e.connectTimer);
        e.connectTimer = null;
      }
      socketGone(key, e);
    };
    ws.onmessage = (ev) => {
      const data =
        ev !== null && typeof ev === "object" && "data" in (ev as Record<string, unknown>)
          ? (ev as { data: unknown }).data
          : ev;
      routeMessage(data, key, e);
    };
  }

  /** Manual retry (badge button): clear the breaker and re-dial every
   * live entry that is not connected. Returns false when there was
   * nothing to re-dial (the caller may remount the whole handle). */
  function retry(): boolean {
    let dialed = false;
    for (const [key, e] of entries) {
      if (entryEmpty(e)) continue;
      const wasDead = e.dead;
      e.dead = false;
      e.fastCloses = 0;
      e.attempt = 0;
      if (e.socket && !wasDead) continue; // already connected/in flight
      if (e.socket) closeEntry(e);
      if (e.timer) {
        clearTimeout(e.timer);
        e.timer = null;
      }
      open(key, e);
      dialed = true;
    }
    return dialed;
  }

  function getEntry(stream: string, params: Record<string, string>): { key: string; entry: Entry } {
    const key = entryKey(stream, params);
    let e = entries.get(key);
    if (!e) {
      e = {
        stream,
        params,
        socket: null,
        timer: null,
        connectTimer: null,
        openedAt: null,
        fastCloses: 0,
        dead: false,
        attempt: 0,
        state: "connecting",
        updates: new Set(),
        notifications: new Set(),
        deletes: new Set(),
        posts: new Map(),
      };
      entries.set(key, e);
      open(key, e);
    } else if (!e.socket && !e.timer && !e.dead) {
      open(key, e);
    }
    return { key, entry: e };
  }

  return {
    subscribeTimeline(source, onPost) {
      const spec = streamNameFor(source);
      if (!spec) return noSubscription;
      const { key, entry } = getEntry(spec.stream, spec.params);
      entry.updates.add(onPost);
      return {
        unsubscribe: () => {
          entry.updates.delete(onPost);
          dropIfEmpty(key, entry);
        },
        status: () => channelStatusOf(entry.state),
      };
    },
    subscribePost(
      id,
      handlers: {
        onUpdated?: (event: PostUpdateEvent) => void;
        onDeleted?: () => void;
      },
    ) {
      // No per-post channel exists on this family (MD10): the post's
      // updates ride the shared `user` stream and are filtered by id
      // here. Only events the server pushes (own-post updates, deletes
      // visible to the viewer) arrive — never synthesized.
      const sub: PostSub = { onUpdated: handlers.onUpdated, onDeleted: handlers.onDeleted };
      const { key, entry } = getEntry("user", {});
      let set = entry.posts.get(id);
      if (!set) {
        set = new Set();
        entry.posts.set(id, set);
      }
      set.add(sub);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const live = entry.posts.get(id);
        if (live) {
          live.delete(sub);
          if (live.size === 0) entry.posts.delete(id);
        }
        dropIfEmpty(key, entry);
      };
    },
    onNotification(handler) {
      const { key, entry } = getEntry("user", {});
      entry.notifications.add(handler);
      return () => {
        entry.notifications.delete(handler);
        dropIfEmpty(key, entry);
      };
    },
    status() {
      return overall();
    },
    onStatusChange(handler) {
      listeners.add(handler as (s: StreamState) => void);
      try {
        handler(overall());
      } catch {
        // Ignore.
      }
      return () => {
        listeners.delete(handler as (s: StreamState) => void);
      };
    },
    retry() {
      return retry();
    },
    onFiltersChanged(handler) {
      filterListeners.add(handler);
      return () => {
        filterListeners.delete(handler);
      };
    },
  };
}
