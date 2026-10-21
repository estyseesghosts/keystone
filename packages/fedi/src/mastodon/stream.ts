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
// only when none was advertised. The session token rides as the
// `access_token` query param to that origin only — a token is never
// attached to another origin. When no WebSocket implementation exists,
// `createStreamHandle` answers null and feeds keep the polling fallback
// (refresh + cursor paging), never an error.
//
// Wire protocol: text frames of `{event, payload}` where `payload` is
// itself a JSON string (`update` / `status.update` carry a Status,
// `delete` carries the bare id, `notification` a Notification).

import type { FeedChannelState, FeedSource, FeedSubscription, PostUpdateEvent, StreamHandle, StreamState } from "../core/backend";
import type { Notification, Post } from "../core/models";
import { adaptNotification, adaptStatus } from "./adapt";
import type { Notification as WireNotification, Status as WireStatus } from "./wire";

export type MastoStreamStatus = StreamState;

/** Minimal WebSocket surface this module needs (the global WebSocket
 * satisfies it; tests inject a mock). */
export interface MastoSocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown } | unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  close(): void;
}

export type WebSocketFactory = (url: string) => MastoSocket;

export interface StreamHandleOptions {
  /** Session token, sent as `access_token` to the streaming origin only. */
  token?: string | null;
  /** Advertised streaming origin (`instance.ts` `streamingOrigin`, a
   * `ws(s)://host[:port]` origin). When null the session origin's
   * ws(s) mapping is used — never an assumed third host. */
  streamingOrigin?: string | null;
  /** WebSocket constructor seam (tests inject a mock). */
  wsFactory?: WebSocketFactory;
}

function defaultFactory(url: string): MastoSocket | null {
  try {
    const WS = (globalThis as { WebSocket?: new (url: string) => MastoSocket }).WebSocket;
    if (typeof WS !== "function") return null;
    return new WS(url);
  } catch {
    return null;
  }
}

export function streamingSupported(): boolean {
  return (
    typeof (globalThis as { WebSocket?: unknown }).WebSocket === "function"
  );
}

/** `origin` (or the advertised streaming base) → `…/api/v1/streaming?stream=…`. */
export function streamUrl(
  origin: string,
  stream: string,
  params: Record<string, string> = {},
  token?: string | null,
  streamingBase?: string | null,
): string {
  const base =
    streamingBase ??
    origin.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  const u = new URL(`${base}/api/v1/streaming`);
  u.searchParams.set("stream", stream);
  if (token) u.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function backoffMs(attempt: number): number {
  return Math.min(30000, 1000 * Math.pow(2, attempt));
}

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
  if (state === "unavailable") return "unavailable";
  return "pending";
}

export function createStreamHandle(
  origin: string,
  opts: StreamHandleOptions = {},
): StreamHandle | null {
  const globalFactory: WebSocketFactory | null = streamingSupported()
    ? (url: string) => {
        const socket = defaultFactory(url);
        if (!socket) throw new Error(`No WebSocket implementation for ${url}.`);
        return socket;
      }
    : null;
  const maybeFactory: WebSocketFactory | null = opts.wsFactory ?? globalFactory;
  if (!maybeFactory) return null;
  const factory: WebSocketFactory = maybeFactory;

  const token = opts.token ?? null;
  const streamingBase = opts.streamingOrigin ?? null;
  const entries = new Map<string, Entry>();
  const listeners = new Set<(s: StreamState) => void>();

  const noSubscription: FeedSubscription = {
    unsubscribe: () => undefined,
    status: () => "disabled",
  };

  function overall(): StreamState {
    if (entries.size === 0) return "connecting";
    let fresh = false;
    let retry = false;
    let err: StreamState | null = null;
    for (const e of entries.values()) {
      if (e.state === "connected") return "connected";
      if (e.state === "connecting") {
        if (e.attempt === 0) fresh = true;
        else retry = true;
      } else if (e.state === "reconnecting") {
        retry = true;
      } else if (e.state === "error" || e.state === "unavailable") {
        err = e.state;
      }
    }
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
  }

  function dropIfEmpty(key: string, e: Entry): void {
    if (!entryEmpty(e)) return;
    closeEntry(e);
    entries.delete(key);
    notify();
  }

  function routeMessage(raw: unknown, e: Entry): void {
    if (typeof raw !== "string") return;
    let frame: { event?: unknown; payload?: unknown };
    try {
      frame = JSON.parse(raw) as { event?: unknown; payload?: unknown };
    } catch {
      return; // malformed: ignore
    }
    if (typeof frame.event !== "string") return;
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
    e.state = "connecting";
    notify();
    let ws: MastoSocket;
    try {
      ws = factory(streamUrl(origin, e.stream, e.params, token, streamingBase));
    } catch {
      e.state = "unavailable";
      notify();
      return;
    }
    e.socket = ws;
    ws.onopen = () => {
      if (e.socket !== ws) return;
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
      if (e.socket !== ws) return; // superseded by a newer socket
      e.socket = null;
      if (!entries.has(key) || entryEmpty(e)) {
        e.state = "unavailable";
        notify();
        return;
      }
      e.state = e.attempt === 0 ? "error" : "reconnecting";
      notify();
      e.attempt += 1;
      const delay = backoffMs(e.attempt);
      e.timer = setTimeout(() => {
        e.timer = null;
        if (entries.get(key) === e && !entryEmpty(e)) open(key, e);
      }, delay);
    };
    ws.onmessage = (ev) => {
      const data =
        ev !== null && typeof ev === "object" && "data" in (ev as Record<string, unknown>)
          ? (ev as { data: unknown }).data
          : ev;
      routeMessage(data, e);
    };
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
        attempt: 0,
        state: "connecting",
        updates: new Set(),
        notifications: new Set(),
        deletes: new Set(),
        posts: new Map(),
      };
      entries.set(key, e);
      open(key, e);
    } else if (!e.socket && !e.timer) {
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
  };
}
