// Misskey-family WebSocket streaming client (`/streaming`).
//
// Covers: authenticated connect (`?i=` token, same as the official client),
// channel subscribe/unsubscribe (`connect`/`disconnect` with per-connection
// ids), note capture (`subNote`/`unsubNote` + broadcast `noteUpdated`),
// notification events on the `main` channel, reconnect with backoff, and
// honest stale/error states (per-channel ack timeout, fast-fail error).
//
// Hard guarantees (roadmap §7):
// - Feeds never depend on the socket: cursor paging + manual refresh work
//   with NO socket. This module only *adds* events; nothing here is on any
//   critical load path.
// - Dedupe is the caller's one-line rule: insert streamed notes with an
//   id-check inside the signal updater (`some(n => n.id === note.id)`), so a
//   streamed event racing a pending API response can never double-insert.
// - Pinetree mode: disabled entirely (no `/streaming` route there yet — the
//   server tree holds empty stub modules only). Subscribing returns a
//   disabled handle; no socket is opened, no console errors.
//
// Wire reference (verified against local Misskey 2026.10.1-alpha.0 +
// Sharkey 2025.4.7, see docs/api-surface.md "Streaming"):
//   -> {"type":"connect","body":{"channel":string,"id":string,"params"?:object,"pong"?:true}}
//   -> {"type":"disconnect","body":{"id":string}}
//   -> {"type":"subNote","body":{"id":noteId}} / {"type":"unsubNote",...}
//   <- {"type":"connected","body":{"id"}} (only when pong:true was sent)
//   <- {"type":"channel","body":{"id","type":event,"body":payload}}
//   <- {"type":"noteUpdated","body":{"id":noteId,"type":"reacted"|"unreacted"|
//        "deleted"|"pollVoted","body":{...}}}
// Auth: `?i=` query (or Authorization header — browsers can't set headers
// on WebSocket, so query it is). Bad token -> HTTP 401 at upgrade, which the
// browser surfaces as an opaque close; repeated immediate failures therefore
// land the pool in `error` instead of retrying forever.

import { createSignal } from "solid-js";
import { IS_MISSKEY_FAMILY } from "./backend";

export const STREAMING_SUPPORTED = IS_MISSKEY_FAMILY;

export type StreamStatus =
  | "disabled"
  | "connecting"
  | "live"
  | "reconnecting"
  | "error";

export type ChannelStatus =
  | "disabled"
  | "pending"
  | "subscribed"
  | "unavailable";

export interface NoteUpdatedEvent {
  id: string;
  type: "reacted" | "unreacted" | "deleted" | "pollVoted";
  body: Record<string, unknown>;
}

export interface ChannelHandlers {
  /** Timeline/antenna `note` events and `main`-channel events arrive here. */
  onEvent?: (type: string, body: unknown) => void;
}

export interface ChannelHandle {
  status: () => ChannelStatus;
  dispose: () => void;
}

const ACK_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
// Consecutive closes within QUICK_CLOSE_MS this many times -> `error`
// (the server is refusing us, e.g. a revoked token: retrying blindly
// would spin forever).
const QUICK_CLOSE_MS = 2_000;
const MAX_QUICK_CLOSES = 5;

const [poolStatus, setPoolStatus] = createSignal<StreamStatus>(
  STREAMING_SUPPORTED ? "connecting" : "disabled",
);
const [poolAttempt, setPoolAttempt] = createSignal(0);
const [poolLastError, setPoolLastError] = createSignal<string | null>(null);
const [poolLastEventAt, setPoolLastEventAt] = createSignal<number | null>(null);

/** Shared connection state for status badges. All read-only accessors. */
export function useStreamState() {
  return {
    status: poolStatus,
    attempt: poolAttempt,
    lastError: poolLastError,
    lastEventAt: poolLastEventAt,
  };
}

interface Sub {
  serverId: string;
  channel: string;
  params: Record<string, unknown>;
  handlers: Set<ChannelHandlers>;
  acked: boolean;
  ackTimer: ReturnType<typeof setTimeout> | null;
  setStatus: (s: ChannelStatus) => void;
  status: () => ChannelStatus;
}

interface NoteCapture {
  handlers: Set<(update: NoteUpdatedEvent) => void>;
}

let socket: WebSocket | null = null;
let activeToken: string | null = null;
let subscriberCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = BACKOFF_BASE_MS;
let quickCloses = 0;
let lastOpenAt = 0;
let wantSocket = false;
const subs = new Map<number, Sub>();
const captures = new Map<string, NoteCapture>();
let nextLocalId = 0;

function streamUrl(token: string | null): string {
  const secure = window.location.protocol === "https:";
  const base = `${secure ? "wss" : "ws"}://${window.location.host}/streaming`;
  return token ? `${base}?i=${encodeURIComponent(token)}` : base;
}

function sendMessage(type: string, body?: Record<string, unknown>): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify(body === undefined ? { type } : { type, body }),
  );
}

function armAckTimeout(sub: Sub): void {
  if (sub.ackTimer) clearTimeout(sub.ackTimer);
  sub.ackTimer = setTimeout(() => {
    sub.ackTimer = null;
    // The server silently ignores channel connects it won't serve
    // (unknown params, missing permission on a pre-scope token). An ack
    // that never arrives is a stale subscription, not a crash: say so.
    if (!sub.acked) sub.setStatus("unavailable");
  }, ACK_TIMEOUT_MS);
}

function sendConnect(sub: Sub): void {
  sub.acked = false;
  sub.setStatus("pending");
  sendMessage("connect", {
    channel: sub.channel,
    id: sub.serverId,
    ...(Object.keys(sub.params).length > 0 ? { params: sub.params } : {}),
    pong: true,
  });
  armAckTimeout(sub);
}

function sendAllSubscribes(): void {
  for (const sub of subs.values()) sendConnect(sub);
  for (const id of captures.keys()) sendMessage("subNote", { id });
}

function scheduleReconnect(): void {
  if (reconnectTimer || !wantSocket) return;
  const delay = backoffMs + Math.floor(Math.random() * 500);
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  setPoolAttempt((n) => n + 1);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, delay);
}

function openSocket(): void {
  if (!wantSocket || socket) return;
  if (!STREAMING_SUPPORTED) {
    setPoolStatus("disabled");
    return;
  }
  setPoolStatus(
    poolAttempt() > 0 || poolStatus() === "error"
      ? "reconnecting"
      : "connecting",
  );
  let ws: WebSocket;
  try {
    ws = new WebSocket(streamUrl(activeToken));
  } catch (err) {
    setPoolLastError(
      err instanceof Error ? err.message : "Could not open the live connection.",
    );
    scheduleReconnect();
    return;
  }
  socket = ws;
  lastOpenAt = Date.now();

  ws.addEventListener("open", () => {
    if (socket !== ws) return;
    backoffMs = BACKOFF_BASE_MS;
    quickCloses = 0;
    setPoolAttempt(0);
    setPoolLastError(null);
    setPoolStatus("live");
    sendAllSubscribes();
  });

  ws.addEventListener("message", (ev) => {
    if (socket !== ws) return;
    setPoolLastEventAt(Date.now());
    let msg: unknown;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const { type, body } = msg as { type?: unknown; body?: unknown };
    if (typeof type !== "string") return;
    if (type === "connected") {
      const id =
        typeof body === "object" && body !== null
          ? (body as { id?: unknown }).id
          : undefined;
      if (typeof id !== "string") return;
      for (const sub of subs.values()) {
        if (sub.serverId === id) {
          sub.acked = true;
          if (sub.ackTimer) {
            clearTimeout(sub.ackTimer);
            sub.ackTimer = null;
          }
          sub.setStatus("subscribed");
        }
      }
      return;
    }
    if (type === "channel") {
      if (typeof body !== "object" || body === null) return;
      const { id, type: eventType, body: payload } = body as {
        id?: unknown;
        type?: unknown;
        body?: unknown;
      };
      if (typeof id !== "string" || typeof eventType !== "string") return;
      for (const sub of subs.values()) {
        if (sub.serverId === id) {
          for (const h of sub.handlers) h.onEvent?.(eventType, payload);
        }
      }
      return;
    }
    if (type === "noteUpdated") {
      if (typeof body !== "object" || body === null) return;
      const { id, type: updateType, body: payload } = body as {
        id?: unknown;
        type?: unknown;
        body?: unknown;
      };
      if (
        typeof id !== "string" ||
        (updateType !== "reacted" &&
          updateType !== "unreacted" &&
          updateType !== "deleted" &&
          updateType !== "pollVoted")
      ) {
        return;
      }
      const cap = captures.get(id);
      if (!cap) return;
      const update: NoteUpdatedEvent = {
        id,
        type: updateType,
        body:
          typeof payload === "object" && payload !== null
            ? (payload as Record<string, unknown>)
            : {},
      };
      for (const fn of cap.handlers) {
        try {
          fn(update);
        } catch {
          // One bad handler must not break dispatch to the rest.
        }
      }
    }
    // Unknown broadcast types (emojiAdded, announcementCreated, …) are
    // ignored: Keystone has no UI for them.
  });

  const onGone = () => {
    if (socket !== ws) return;
    socket = null;
    for (const sub of subs.values()) {
      sub.acked = false;
      if (sub.ackTimer) {
        clearTimeout(sub.ackTimer);
        sub.ackTimer = null;
      }
      sub.setStatus("pending");
    }
    if (!wantSocket) return;
    // Fast-fail: closes right after open, over and over, mean the server
    // is refusing the connection (e.g. revoked token surfacing as an
    // opaque close). Stop and say so instead of spinning forever.
    if (Date.now() - lastOpenAt < QUICK_CLOSE_MS) {
      quickCloses += 1;
      if (quickCloses >= MAX_QUICK_CLOSES) {
        setPoolStatus("error");
        setPoolLastError(
          "Live updates were refused by the server. Sign out and sign in again, or keep using manual refresh.",
        );
        return;
      }
    }
    setPoolStatus("reconnecting");
    setPoolLastError("Live connection lost. Reconnecting…");
    scheduleReconnect();
  };
  ws.addEventListener("close", onGone);
  ws.addEventListener("error", () => {
    // Browsers give no detail here; the `close` handler owns the state.
  });
}

function retain(token: string | null): void {
  if (activeToken !== token) {
    // Token changed (sign-in/out): drop the old socket; subscriptions
    // re-send themselves on the new one.
    if (socket) {
      wantSocket = false;
      socket.close();
      socket = null;
      wantSocket = true;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    activeToken = token;
    backoffMs = BACKOFF_BASE_MS;
    quickCloses = 0;
    setPoolAttempt(0);
    setPoolLastError(null);
    if (poolStatus() === "error") setPoolStatus("connecting");
  }
  subscriberCount += 1;
  wantSocket = true;
  if (!socket && !reconnectTimer) openSocket();
}

function release(): void {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount > 0) return;
  // Nobody is listening: close the idle socket instead of holding a dead
  // connection open. State resets so the next subscriber starts clean.
  wantSocket = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    const ws = socket;
    socket = null;
    ws.close();
  }
  backoffMs = BACKOFF_BASE_MS;
  quickCloses = 0;
  setPoolAttempt(0);
  if (poolStatus() !== "disabled") setPoolStatus("connecting");
}

/**
 * Subscribe to a channel. The socket is shared; each call gets its own
 * server-side id and unsubscribes on dispose. In pinetree mode the handle
 * is immediately `disabled` and no socket is opened.
 */
export function subscribeChannel(
  channel: string,
  params: Record<string, unknown> | undefined,
  handlers: ChannelHandlers,
  token: string | null,
): ChannelHandle {
  const [status, setStatus] = createSignal<ChannelStatus>(
    STREAMING_SUPPORTED ? "pending" : "disabled",
  );
  if (!STREAMING_SUPPORTED) {
    return { status, dispose: () => undefined };
  }
  retain(token);
  const localId = ++nextLocalId;
  const serverId = `ks-${Date.now().toString(36)}-${localId}`;
  const sub: Sub = {
    serverId,
    channel,
    params: params ?? {},
    handlers: new Set([handlers]),
    acked: false,
    ackTimer: null,
    setStatus,
    status,
  };
  subs.set(localId, sub);
  // A pool-level `error` (fast-fail) belongs to the old attempt: a new
  // subscriber means the UI is retrying, so reset and reconnect.
  if (poolStatus() === "error") {
    quickCloses = 0;
    backoffMs = BACKOFF_BASE_MS;
    setPoolAttempt(0);
    setPoolLastError(null);
    setPoolStatus("connecting");
    openSocket();
  } else {
    sendConnect(sub);
  }
  let disposed = false;
  return {
    status,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const live = subs.get(localId);
      if (live) {
        if (live.ackTimer) clearTimeout(live.ackTimer);
        sendMessage("disconnect", { id: live.serverId });
        subs.delete(localId);
      }
      release();
    },
  };
}

/**
 * Capture live updates for one note id (`subNote`). Refcounted: N callers
 * capturing the same id produce one server subscription. In pinetree mode
 * the releaser is a no-op.
 */
export function captureNote(
  noteId: string,
  onUpdated: (update: NoteUpdatedEvent) => void,
  token: string | null,
): () => void {
  if (!STREAMING_SUPPORTED || !noteId) return () => undefined;
  retain(token);
  let cap = captures.get(noteId);
  if (!cap) {
    cap = { handlers: new Set() };
    captures.set(noteId, cap);
    sendMessage("subNote", { id: noteId });
  }
  cap.handlers.add(onUpdated);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const live = captures.get(noteId);
    if (live) {
      live.handlers.delete(onUpdated);
      if (live.handlers.size === 0) {
        captures.delete(noteId);
        sendMessage("unsubNote", { id: noteId });
      }
    }
    release();
  };
}

/** Test hook: reset module state (single-flight pools keyed by caller). */
export function __streamTestReset(): void {
  wantSocket = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    const ws = socket;
    socket = null;
    try {
      ws.close();
    } catch {
      // Ignore.
    }
  }
  for (const sub of subs.values()) {
    if (sub.ackTimer) clearTimeout(sub.ackTimer);
  }
  subs.clear();
  captures.clear();
  subscriberCount = 0;
  activeToken = null;
  backoffMs = BACKOFF_BASE_MS;
  quickCloses = 0;
  setPoolAttempt(0);
  setPoolLastError(null);
  setPoolLastEventAt(null);
  setPoolStatus(STREAMING_SUPPORTED ? "connecting" : "disabled");
}
