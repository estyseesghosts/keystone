// Mastodon-family WebSocket streaming client (/api/v1/streaming).
//
// One socket per handle, built from the SESSION origin (http→ws,
// https→wss) with the session token as the `access_token` query param — a
// token is never attached to another origin. When no WebSocket
// implementation exists, `createStreamHandle` answers null and feeds keep
// the polling fallback (refresh + cursor paging), never an error.
//
// Wire protocol: text frames of `{event, payload}` where `payload` is
// itself a JSON string (`update` / `status.update` carry a Status,
// `delete` carries the bare id, `notification` a Notification).

import type { FeedSource, FeedSubscription, StreamHandle, StreamState } from "../core/backend";
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
  /** Session token, sent as `access_token` to the session origin only. */
  token?: string | null;
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

/** `http(s)://host` → `ws(s)://host/api/v1/streaming?stream=…`. */
export function streamUrl(
  origin: string,
  stream: string,
  params: Record<string, string> = {},
  token?: string | null,
): string {
  const normalized = origin.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  const u = new URL(`${normalized}/api/v1/streaming`);
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

interface StreamHandlers {
  onUpdate?: (post: Post) => void;
  onNotification?: (n: Notification) => void;
  onDelete?: (id: string) => void;
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
  let status: MastoStreamStatus = "connecting";
  const listeners = new Set<(s: MastoStreamStatus) => void>();
  let socket: MastoSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let active: { stream: string; params: Record<string, string>; handlers: StreamHandlers } | null = null;

  const noSubscription: FeedSubscription = {
    unsubscribe: () => undefined,
    status: () => "disabled",
  };

  function notify(s: MastoStreamStatus): void {
    status = s;
    for (const fn of listeners) {
      try {
        fn(s);
      } catch {
        // Listener failures never break the socket.
      }
    }
  }

  function closeCurrent(): void {
    if (socket) {
      try {
        socket.close();
      } catch {
        // Ignore.
      }
      socket = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function routeMessage(raw: unknown, handlers: StreamHandlers): void {
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
        handlers.onUpdate?.(adaptStatus(JSON.parse(payload) as WireStatus));
      } else if (frame.event === "delete") {
        if (payload !== null) handlers.onDelete?.(payload);
      } else if (frame.event === "notification") {
        if (payload === null) return;
        handlers.onNotification?.(adaptNotification(JSON.parse(payload) as WireNotification));
      }
    } catch {
      // Malformed payload: ignore.
    }
  }

  function open(spec: { stream: string; params: Record<string, string>; handlers: StreamHandlers }): void {
    closeCurrent();
    notify("connecting");
    let ws: MastoSocket;
    try {
      ws = factory(streamUrl(origin, spec.stream, spec.params, token));
    } catch {
      notify("unavailable");
      return;
    }
    socket = ws;
    ws.onopen = () => {
      reconnectAttempt = 0;
      notify("connected");
    };
    ws.onerror = () => {
      notify(reconnectAttempt === 0 ? "error" : "reconnecting");
    };
    ws.onclose = () => {
      if (socket !== ws) return; // superseded by a newer socket
      socket = null;
      if (!active) {
        notify("unavailable");
        return;
      }
      notify(reconnectAttempt === 0 ? "error" : "reconnecting");
      reconnectAttempt += 1;
      const delay = backoffMs(reconnectAttempt);
      reconnectTimer = setTimeout(() => {
        if (active) open(active);
      }, delay);
    };
    ws.onmessage = (ev) => {
      const data =
        ev !== null && typeof ev === "object" && "data" in (ev as Record<string, unknown>)
          ? (ev as { data: unknown }).data
          : ev;
      routeMessage(data, spec.handlers);
    };
  }

  return {
    subscribeTimeline(source, onPost) {
      const spec = streamNameFor(source);
      if (!spec) return noSubscription;
      active = { ...spec, handlers: { onUpdate: onPost } };
      open(active);
      return {
        unsubscribe: () => {
          active = null;
          closeCurrent();
          notify("unavailable");
        },
        status: () => (status === "connected" ? "subscribed" : status === "unavailable" ? "unavailable" : "pending"),
      };
    },
    subscribePost(_id, _handlers) {
      return () => undefined;
    },
    onNotification(handler) {
      if (!active) {
        active = { stream: "user", params: {}, handlers: { onNotification: handler } };
        open(active);
      }
      return () => {
        // Shared-socket handle: listeners detach per subscription above.
      };
    },
    status() {
      return status;
    },
    onStatusChange(handler) {
      listeners.add(handler as (s: MastoStreamStatus) => void);
      try {
        handler(status);
      } catch {
        // Ignore.
      }
      return () => {
        listeners.delete(handler as (s: MastoStreamStatus) => void);
      };
    },
  };
}
