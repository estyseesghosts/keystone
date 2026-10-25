// Misskey-family WebSocket streaming client (`/streaming`).
//
// Covers: authenticated connect (`?i=` token, same as the official client),
// channel subscribe/unsubscribe (`connect`/`disconnect` with per-connection
// ids), note capture (`subNote`/`unsubNote` + broadcast `noteUpdated`),
// notification events on the `main` channel, reconnect with backoff, and
// honest stale/error states (per-channel ack timeout, fast-fail error).
//
// One pool per session (`createStreamPool`): the old module-global pool +
// Solid signals became instance state + an `eventemitter3` status event
// (pure-TS rule: no UI framework in this package). The stream URL is built
// from the session ORIGIN (never `window.location`); the token always
// belongs to that origin, so the old internal/external socket split is
// gone — every pool carries exactly its own session's credential.
//
// Hard guarantees (roadmap §7):
// - Feeds never depend on the socket: cursor paging + manual refresh work
//   with NO socket. This module only *adds* events; nothing here is on any
//   critical load path.
// - Dedupe is the caller's one-line rule: insert streamed notes with an
//   id-check, so a streamed event racing a pending API response can never
//   double-insert.
// - Unsupported servers (Pinetree: no `/streaming` route — the server tree
//   holds empty stub modules only): subscribing returns a disabled handle;
//   no socket is opened.
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
// Auth: `?i=` query (or Authorization header — sockets can't set headers,
// so query it is). Bad token -> HTTP 401 at upgrade, surfaced as an opaque
// close; repeated immediate failures therefore land the pool in `error`
// instead of retrying forever.

import EventEmitter from "eventemitter3";
import type {
  ChatMessage,
  ChatStreamHandlers,
  FeedSource,
  FeedSubscription,
  PostUpdateEvent,
  StreamHandle,
  StreamState,
} from "../core/backend";
import type { Notification, Post } from "../core/models";
import { FediError } from "../core/errors";
import { randomBytes } from "../core/random";
import { adaptChatMessage } from "./chat";
import { adaptNote, adaptNotification } from "./adapt";
import type { Note, NotificationItem } from "./wire";

export type StreamStatus =
  | "disabled"
  | "connecting"
  | "live"
  | "reconnecting"
  | "error"
  | "idle";

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

/** Minimal socket surface the pool needs (the global WebSocket on
 * device/web, a mock in tests). */
export interface StreamSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void;
}

export interface StreamSocketImpl {
  new (url: string): StreamSocket;
  readonly OPEN: number;
}

export interface StreamPoolOptions {
  /** Session origin (`https://example.com`): scheme picks ws/wss. */
  origin: string;
  /** Session token (`?i=` query). Null for logged-out public feeds. */
  token: string | null;
  /** False where the server has no `/streaming` route (Pinetree). */
  supported?: boolean;
  /** Socket constructor (tests inject a mock). Defaults to global WebSocket. */
  wsImpl?: StreamSocketImpl;
}

export interface StreamSnapshot {
  status: StreamStatus;
  attempt: number;
  lastError: string | null;
  lastEventAt: number | null;
}

export interface StreamPool {
  subscribeChannel(
    channel: string,
    params: Record<string, unknown> | undefined,
    handlers: ChannelHandlers,
    token?: string | null,
  ): ChannelHandle;
  captureNote(
    noteId: string,
    onUpdated: (update: NoteUpdatedEvent) => void,
    token?: string | null,
  ): () => void;
  status(): StreamStatus;
  snapshot(): StreamSnapshot;
  onStatusChange(handler: (status: StreamStatus) => void): () => void;
  /** Close the socket and drop all subscriptions (unmount/sign-out). */
  close(): void;
}

const ACK_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
// Consecutive closes within QUICK_CLOSE_MS this many times -> `error`
// (the server is refusing us, e.g. a revoked token: retrying blindly
// would spin forever).
const QUICK_CLOSE_MS = 2_000;
const MAX_QUICK_CLOSES = 5;
/** A dialed socket that never opens within this long is a failure (the
 * Mastodon family has the same 10s ack watchdog): close it and back off,
 * never sit in `connecting` forever (captive portal, blackholed SYN). */
const CONNECT_TIMEOUT_MS = 10_000;
/** Heartbeat cadence while live (under the server's 2min idle kill, over
 * its 60s protocol ping): a quiet socket still proves itself this often. */
const HEARTBEAT_INTERVAL_MS = 60_000;
/** Consecutive unanswered heartbeat pings that mean the socket is
 * half-open: close it and reconnect (the traffic proves liveness in
 * between, so a chatty socket never pings at all). */
const MAX_MISSED_PONGS = 2;

/** Dropped inbound stream events this process has counted (dev counter:
 * malformed frames, unvalidated payloads, throwing handlers — dropped,
 * never thrown out of the socket listener, never logged). */
let droppedEvents = 0;

/** How many inbound stream events were dropped as malformed. Exported
 * for tests; the socket stays up regardless. */
export function droppedStreamEventCount(): number {
  return droppedEvents;
}

const LIVE_OPEN_MESSAGE = "Could not open the live connection.";
const LIVE_REFUSED_MESSAGE =
  "Live updates were refused by the server. Sign out and sign in again, or keep using manual refresh.";
const LIVE_LOST_MESSAGE = "Live connection lost. Reconnecting…";

/** Build the `/streaming` URL for a session origin. `https:` → `wss`,
 * `http:` (local test targets) → `ws`. Exported for tests. */
export function streamUrlFor(origin: string, token: string | null): string {
  const url = new URL(origin);
  const scheme = url.protocol === "https:" ? "wss" : "ws";
  const base = `${scheme}://${url.host}/streaming`;
  return token ? `${base}?i=${encodeURIComponent(token)}` : base;
}

interface Sub {
  serverId: string;
  channel: string;
  params: Record<string, unknown>;
  handlers: Set<ChannelHandlers>;
  acked: boolean;
  ackTimer: ReturnType<typeof setTimeout> | null;
  status: ChannelStatus;
}

interface NoteCapture {
  handlers: Set<(update: NoteUpdatedEvent) => void>;
}

function defaultSocketImpl(): StreamSocketImpl {
  const Impl = (globalThis as { WebSocket?: StreamSocketImpl }).WebSocket;
  if (!Impl) {
    throw new FediError("Could not open the live connection.", "errors.stream.unavailable");
  }
  return Impl;
}

export function createStreamPool(opts: StreamPoolOptions): StreamPool {
  const supported = opts.supported ?? true;
  const wsImpl = opts.wsImpl ?? ((): StreamSocketImpl => defaultSocketImpl())();
  const openValue: number = wsImpl.OPEN ?? 1;
  const events = new EventEmitter();

  let poolStatus: StreamStatus = supported ? "connecting" : "disabled";
  let poolAttempt = 0;
  let poolLastError: string | null = null;
  let poolLastEventAt: number | null = null;

  const subs = new Map<number, Sub>();
  const captures = new Map<string, NoteCapture>();
  let socket: StreamSocket | null = null;
  let activeToken: string | null = opts.token;
  let subscriberCount = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = BACKOFF_BASE_MS;
  let quickCloses = 0;
  /** When the current socket logically opened (`null` = never). The
   * breaker decides from `now - openedAt` in the close handler, never
   * from resets in the open handler (an accept-then-close loop must keep
   * counting). */
  let openedAt: number | null = null;
  let wantSocket = false;
  let nextLocalId = 0;
  /** Dial watchdog: a socket that never opens within CONNECT_TIMEOUT_MS. */
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Heartbeat while live (see `startHeartbeat`): cadence timer, the
   * in-flight ping id + its ack timer, and consecutive unanswered pings. */
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let pingId: string | null = null;
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  let missedPongs = 0;
  let pingSeq = 0;

  function emitStatus(): void {
    events.emit("status", poolStatus);
  }

  function setStatus(next: StreamStatus): void {
    if (poolStatus === next) return;
    poolStatus = next;
    emitStatus();
  }

  /** Best-effort send on the current socket. Returns whether the frame
   * was actually handed to the socket (a frame dropped on a
   * not-yet-open socket is queued, never armed — see `sendConnect`). */
  function sendMessage(type: string, body?: Record<string, unknown>): boolean {
    if (!socket || socket.readyState !== openValue) return false;
    try {
      socket.send(JSON.stringify(body === undefined ? { type } : { type, body }));
    } catch {
      return false;
    }
    return true;
  }

  function armAckTimeout(sub: Sub): void {
    if (sub.ackTimer) clearTimeout(sub.ackTimer);
    sub.ackTimer = setTimeout(() => {
      sub.ackTimer = null;
      // The server silently ignores channel connects it won't serve
      // (unknown params, missing permission on a pre-scope token). An ack
      // that never arrives is a stale subscription, not a crash: say so.
      if (!sub.acked) sub.status = "unavailable";
    }, ACK_TIMEOUT_MS);
  }

  function sendConnect(sub: Sub): void {
    sub.acked = false;
    sub.status = "pending";
    // The ack watchdog starts only after the message is actually sent: on
    // a slow dial the frame is queued until `open` (the open handler
    // re-sends every subscribe) instead of marking the sub `unavailable`
    // for a message the server never saw.
    if (
      sendMessage("connect", {
        channel: sub.channel,
        id: sub.serverId,
        ...(Object.keys(sub.params).length > 0 ? { params: sub.params } : {}),
        pong: true,
      })
    ) {
      armAckTimeout(sub);
    }
  }

  function sendAllSubscribes(): void {
    for (const sub of subs.values()) sendConnect(sub);
    for (const id of captures.keys()) sendMessage("subNote", { id });
  }

  function scheduleReconnect(): void {
    if (reconnectTimer || !wantSocket) return;
    // Reconnect jitter (X12.2): decorrelates client stampedes after a
    // server restart. Non-security use, but drawn from the CSPRNG seam
    // (never `Math.random`, which is banned under `packages/fedi/src`) —
    // a missing CSPRNG degrades to zero jitter, never a throw: the reconnect
    // timer must always arm.
    let jitter = 0;
    try {
      const rb = randomBytes(2);
      jitter = (((rb[0] ?? 0) * 256 + (rb[1] ?? 0)) % 500 + 500) % 500;
    } catch {
      jitter = 0;
    }
    const delay = backoffMs + jitter;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    poolAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  function clearConnectTimer(): void {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  /** Heartbeat liveness while `live` (two missed pongs -> reconnect).
   *
   * The server pings every 60s at the protocol level (auto-answered) and
   * kills idle connections after 2min, so a half-open socket shows no
   * `close` and stays `live` forever. The client therefore proves the
   * round trip itself: every HEARTBEAT_INTERVAL_MS with no inbound traffic
   * it connects a throwaway `globalTimeline` subscription with `pong: true`
   * (documented frames only) and waits for the `connected` ack. A chatty
   * socket never pings — traffic is the proof. Two consecutive unanswered
   * pings close the socket and reconnect with the normal backoff. */
  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (pingTimer) {
      clearTimeout(pingTimer);
      pingTimer = null;
    }
    pingId = null;
  }

  function sendPing(): void {
    if (socket === null || pingId !== null) return;
    pingSeq += 1;
    const id = `hb-${Date.now().toString(36)}-${pingSeq}`;
    if (
      !sendMessage("connect", { channel: "globalTimeline", id, pong: true })
    ) {
      return;
    }
    pingId = id;
    pingTimer = setTimeout(() => {
      pingTimer = null;
      pingId = null;
      missedPongs += 1;
      if (missedPongs < MAX_MISSED_PONGS) return;
      // Half-open: the socket takes frames but answers nothing. Close it
      // and let the normal path redial (a healthy close resets the
      // breaker there, so this never trips the fast-fail on its own).
      const ws = socket;
      socket = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          // Ignore — the state moves on regardless.
        }
      }
      afterGone();
    }, ACK_TIMEOUT_MS);
  }

  function scheduleHeartbeat(): void {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    const timer = setTimeout(() => {
      heartbeatTimer = null;
      if (socket === null || poolStatus !== "live") return;
      if (pingId !== null) return; // a ping is already in flight
      if (Date.now() - (poolLastEventAt ?? 0) < HEARTBEAT_INTERVAL_MS) {
        missedPongs = 0;
        scheduleHeartbeat();
        return;
      }
      sendPing();
      scheduleHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer = timer;
    // A quiet socket must not hold the process open on its own (the
    // one-shot ack/reconnect timers stay ref'd like the existing ones).
    (heartbeatTimer as unknown as { unref?: () => void }).unref?.();
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    if (socket === null) return;
    scheduleHeartbeat();
  }

  /** One socket went away (close, error-close, dial/connect-timeout, or
   * two missed pongs). Subs drop to pending; the breaker decides between
   * a bounded redial and the dead state. */
  function afterGone(): void {
    stopHeartbeat();
    clearConnectTimer();
    const upSince = openedAt;
    openedAt = null;
    for (const sub of subs.values()) {
      sub.acked = false;
      if (sub.ackTimer) {
        clearTimeout(sub.ackTimer);
        sub.ackTimer = null;
      }
      sub.status = "pending";
    }
    if (!wantSocket) return;
    // Fast-fail: closes right after open, over and over, mean the server
    // is refusing the connection (e.g. revoked token surfacing as an
    // opaque close). A connection that stayed up past QUICK_CLOSE_MS
    // resets the count HERE instead of in the open handler — an
    // accept-then-close loop trips the breaker instead of spinning
    // forever. Stop and say so instead of retrying blindly.
    if (upSince === null || Date.now() - upSince < QUICK_CLOSE_MS) {
      quickCloses += 1;
      if (quickCloses >= MAX_QUICK_CLOSES) {
        setStatus("error");
        poolLastError = LIVE_REFUSED_MESSAGE;
        return;
      }
    } else {
      quickCloses = 0;
      backoffMs = BACKOFF_BASE_MS;
      poolAttempt = 0;
    }
    setStatus("reconnecting");
    poolLastError = LIVE_LOST_MESSAGE;
    scheduleReconnect();
  }

  function openSocket(): void {
    if (!wantSocket || socket) return;
    if (!supported) {
      setStatus("disabled");
      return;
    }
    setStatus(poolAttempt > 0 || poolStatus === "error" ? "reconnecting" : "connecting");
    let ws: StreamSocket;
    try {
      ws = new wsImpl(streamUrlFor(opts.origin, activeToken));
    } catch (err) {
      poolLastError = err instanceof Error ? err.message : LIVE_OPEN_MESSAGE;
      scheduleReconnect();
      return;
    }
    socket = ws;
    clearConnectTimer();
    // Dial watchdog: a socket that never opens is a failure, not a
    // permanent `connecting` (captive portal, blackholed SYN). Closing it
    // feeds the same path as a real close.
    connectTimer = setTimeout(() => {
      connectTimer = null;
      if (socket !== ws) return;
      socket = null;
      try {
        ws.close();
      } catch {
        // Ignore — the state moves on regardless.
      }
      afterGone();
    }, CONNECT_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      clearConnectTimer();
      // Mark the open time only — the breaker/backoff reset in the close
      // handler once the connection proves healthy (see `afterGone`).
      openedAt = Date.now();
      poolLastEventAt = Date.now();
      missedPongs = 0;
      poolLastError = null;
      setStatus("live");
      sendAllSubscribes();
      startHeartbeat();
    });

    ws.addEventListener("message", (ev) => {
      if (socket !== ws) return;
      poolLastEventAt = Date.now();
      // Inbound traffic proves the socket is alive end to end.
      missedPongs = 0;
      let msg: unknown;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        droppedEvents += 1;
        return;
      }
      if (typeof msg !== "object" || msg === null) {
        droppedEvents += 1;
        return;
      }
      const { type, body } = msg as { type?: unknown; body?: unknown };
      if (typeof type !== "string") {
        droppedEvents += 1;
        return;
      }
      if (type === "connected") {
        const id =
          typeof body === "object" && body !== null
            ? (body as { id?: unknown }).id
            : undefined;
        if (typeof id !== "string") {
          droppedEvents += 1;
          return;
        }
        if (id === pingId) {
          // Heartbeat pong (see `sendPing`): the round trip works.
          // Tear the throwaway subscription down server-side.
          pingId = null;
          if (pingTimer) {
            clearTimeout(pingTimer);
            pingTimer = null;
          }
          missedPongs = 0;
          sendMessage("disconnect", { id });
          return;
        }
        for (const sub of subs.values()) {
          if (sub.serverId === id) {
            sub.acked = true;
            if (sub.ackTimer) {
              clearTimeout(sub.ackTimer);
              sub.ackTimer = null;
            }
            sub.status = "subscribed";
          }
        }
        return;
      }
      if (type === "channel") {
        if (typeof body !== "object" || body === null) {
          droppedEvents += 1;
          return;
        }
        const { id, type: eventType, body: payload } = body as {
          id?: unknown;
          type?: unknown;
          body?: unknown;
        };
        if (typeof id !== "string" || typeof eventType !== "string") {
          droppedEvents += 1;
          return;
        }
        // Ignore the heartbeat's own throwaway subscription (its ack is
        // handled above; stray events addressed to it are never routed).
        if (pingId !== null && id === pingId) return;
        for (const sub of subs.values()) {
          if (sub.serverId === id) {
            for (const h of sub.handlers) {
              try {
                h.onEvent?.(eventType, payload);
              } catch {
                // One bad handler must not break dispatch to the rest —
                // and never out of the socket listener.
                droppedEvents += 1;
              }
            }
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
      afterGone();
    };
    ws.addEventListener("close", onGone);
    ws.addEventListener("error", () => {
      // No detail available here; the `close` handler owns the state.
    });
  }

  function retain(token: string | null): void {
    if (activeToken !== token) {
      // Token changed (sign-in/out): drop the old socket; subscriptions
      // re-send themselves on the new one.
      stopHeartbeat();
      clearConnectTimer();
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
      poolAttempt = 0;
      poolLastError = null;
      if (poolStatus === "error") setStatus("connecting");
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
    stopHeartbeat();
    clearConnectTimer();
    if (socket) {
      const ws = socket;
      socket = null;
      try {
        ws.close();
      } catch {
        // Teardown is best-effort.
      }
    }
    backoffMs = BACKOFF_BASE_MS;
    quickCloses = 0;
    poolAttempt = 0;
    openedAt = null;
    // An idle pool with no socket is `idle`, never `connecting` (a UI
    // keyed on status must not show a dial that will never happen).
    if (poolStatus !== "disabled") setStatus("idle");
  }

  /**
   * Subscribe to a channel. The socket is shared; each call gets its own
   * server-side id and unsubscribes on dispose. On unsupported servers the
   * handle is immediately `disabled` and no socket is opened.
   */
  function subscribeChannel(
    channel: string,
    params: Record<string, unknown> | undefined,
    handlers: ChannelHandlers,
    token: string | null = activeToken,
  ): ChannelHandle {
    if (!supported) {
      const status: ChannelStatus = "disabled";
      return { status: () => status, dispose: () => undefined };
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
      status: "pending",
    };
    subs.set(localId, sub);
    // A pool-level `error` (fast-fail) belongs to the old attempt: a new
    // subscriber means the UI is retrying, so reset and reconnect.
    if (poolStatus === "error") {
      quickCloses = 0;
      backoffMs = BACKOFF_BASE_MS;
      poolAttempt = 0;
      poolLastError = null;
      setStatus("connecting");
      openSocket();
    } else {
      sendConnect(sub);
    }
    let disposed = false;
    return {
      status: () => subs.get(localId)?.status ?? sub.status,
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
   * capturing the same id produce one server subscription. On unsupported
   * servers the releaser is a no-op.
   */
  function captureNote(
    noteId: string,
    onUpdated: (update: NoteUpdatedEvent) => void,
    token: string | null = activeToken,
  ): () => void {
    if (!supported || !noteId) return () => undefined;
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

  return {
    subscribeChannel,
    captureNote,
    status: () => poolStatus,
    snapshot: () => ({
      status: poolStatus,
      attempt: poolAttempt,
      lastError: poolLastError,
      lastEventAt: poolLastEventAt,
    }),
    onStatusChange: (handler: (status: StreamStatus) => void): (() => void) => {
      events.on("status", handler);
      return () => {
        events.off("status", handler);
      };
    },
    close: () => {
      wantSocket = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopHeartbeat();
      clearConnectTimer();
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
    },
  };
}

// --- StreamHandle (plan §2.2 `stream()`) -----------------------------------
//
// The pool above is the Misskey-family streaming machinery; this factory
// is the only shape the UI sees (`core/backend.StreamHandle`). The pool is
// built for exactly one session (its origin + token), matching the
// transport discipline (a credential only ever travels to its own origin).

const STATE_MAP: Record<StreamStatus, StreamState> = {
  disabled: "unavailable",
  connecting: "connecting",
  live: "connected",
  reconnecting: "reconnecting",
  error: "error",
  // An idle pool holds no socket: the handle reads `unavailable` (never a
  // dial that will never happen), same as an unsupported server.
  idle: "unavailable",
};

function isNoteLike(value: unknown): value is Note {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/** A note event worth adapting: a string id AND a present author object.
 * `adaptNote` throws on either absence (wire `fileIds` guard, missing
 * `user`), so the check happens before adaptation, not inside a catch. */
function isAdaptableNote(value: unknown): value is Note {
  return (
    isNoteLike(value) &&
    typeof (value as { user?: unknown }).user === "object" &&
    (value as { user?: unknown }).user !== null
  );
}

function isNotificationLike(value: unknown): value is NotificationItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** A packed chat message is any object with a string id (detailed or
 * either lite pack — `adaptChatMessage` sorts the variants). */
function isChatMessageLike(value: unknown): value is Parameters<typeof adaptChatMessage>[0] {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/** Feed source -> channel spec. Home needs auth, local/global do not,
 * antennas carry their id. */
function channelSpec(
  source: FeedSource,
): { channel: string; params?: Record<string, unknown>; needsAuth: boolean } | null {
  if ("kind" in source) {
    if (source.kind === "home") return { channel: "homeTimeline", needsAuth: true };
    if (source.kind === "local") return { channel: "localTimeline", needsAuth: false };
    if (source.kind === "social") return { channel: "hybridTimeline", needsAuth: true };
    return { channel: "globalTimeline", needsAuth: false };
  }
  if ("antennaId" in source) {
    return {
      channel: "antenna",
      params: { antennaId: source.antennaId },
      needsAuth: true,
    };
  }
  if ("listId" in source) {
    return {
      channel: "userList",
      params: { listId: source.listId },
      needsAuth: true,
    };
  }
  // A channel's live channel is literally `channel` with the channel id
  // (backend `stream/channels/channel.ts`: `params.channelId`). Public —
  // the server filters by the note's own `channelId`.
  if ("channelId" in source) {
    return {
      channel: "channel",
      params: { channelId: source.channelId },
      needsAuth: false,
    };
  }
  if ("tag" in source) {
    return {
      channel: "hashtag",
      params: { q: [[source.tag]] },
      needsAuth: false,
    };
  }
  return null;
}

export interface StreamHandleOptions extends StreamPoolOptions {
  // The pool options ARE the handle options (one pool per handle).
}

/** Build the StreamHandle for one session, or null when this backend has
 * no streaming at all (`core/backend.Backend.stream()`). */
export function createStreamHandle(opts: StreamHandleOptions): StreamHandle | null {
  if (opts.supported === false) return null;
  const pool = createStreamPool(opts);

  const noSubscription: FeedSubscription = {
    unsubscribe: () => undefined,
    status: () => "disabled",
  };

  return {
    subscribeTimeline(source, onPost) {
      const spec = channelSpec(source);
      if (!spec) return noSubscription;
      // An auth channel is never subscribed without a credential (an
      // unauthenticated connect would be silently ignored).
      if (spec.needsAuth && !opts.token) return noSubscription;
      const handle = pool.subscribeChannel(spec.channel, spec.params, {
        onEvent: (type, body) => {
          // Malformed note events are dropped and counted, never thrown
          // out of the socket listener (the pool isolates sibling
          // subscribers; this guards the adapter itself).
          if (type !== "note" || !isNoteLike(body)) return;
          if (!isAdaptableNote(body)) {
            droppedEvents += 1;
            return;
          }
          try {
            onPost(adaptNote(body));
          } catch {
            droppedEvents += 1;
          }
        },
      });
      return {
        unsubscribe: () => handle.dispose(),
        status: () => handle.status(),
      };
    },

    subscribePost(id, handlers) {
      return pool.captureNote(
        id,
        (update) => {
          if (update.type === "deleted") {
            handlers.onDeleted?.();
            return;
          }
          const event: PostUpdateEvent = { id: update.id, type: update.type };
          const body = update.body as { reaction?: unknown; userId?: unknown };
          if (typeof body?.reaction === "string") event.reaction = body.reaction;
          else if (body && "reaction" in body) event.reaction = null;
          if (typeof body?.userId === "string") event.userId = body.userId;
          handlers.onUpdated?.(event);
        },
      );
    },

    onNotification(handler) {
      if (!opts.token) return () => undefined;
      const handle = pool.subscribeChannel("main", undefined, {
        onEvent: (type, body) => {
          if (type !== "notification" || !isNotificationLike(body)) return;
          try {
            handler(adaptNotification(body));
          } catch {
            // A malformed notification is dropped and counted, never
            // thrown out of the socket listener.
            droppedEvents += 1;
          }
        },
      });
      return () => handle.dispose();
    },

    // Chat live delivery (P6.2 §2.2): `chatRoom` + `chatUser` are the two
    // channels the official client holds open (`pages/chat/room.vue` +
    // `message.vue`), with `message` / `deleted` / `react` / `unreact`
    // events. Keystone surfaces message + deleted only: reaction deltas
    // arrive on the next thread refetch, never as guessed state. Both
    // channels require a credential (upstream `requireCredential`), so an
    // unauthenticated handle is a no-op — the thread pages without it.
    // Read markers need no socket write: both timeline endpoints mark
    // read server-side on every fetch, and `connection.send('read')` is
    // the official client's extra, not a state Keystone tracks.
    subscribeChatRoom(roomId, handlers) {
      if (!opts.token || !roomId) return () => undefined;
      const handle = pool.subscribeChannel("chatRoom", { roomId }, {
        onEvent: (type, body) => {
          subscribeChatEvent(handlers, type, body);
        },
      });
      return () => handle.dispose();
    },

    subscribeChatUser(userId, handlers) {
      if (!opts.token || !userId) return () => undefined;
      const handle = pool.subscribeChannel("chatUser", { otherId: userId }, {
        onEvent: (type, body) => {
          subscribeChatEvent(handlers, type, body);
        },
      });
      return () => handle.dispose();
    },

    status() {
      return STATE_MAP[pool.status()];
    },

    onStatusChange(handler) {
      return pool.onStatusChange((status) => handler(STATE_MAP[status]));
    },
  };
}

/** Dispatch one chat-stream event to the caller's handlers. Unknown event
 * types (`react`/`unreact` and any fork extension) are ignored — the open
 * thread refetches them; nothing is guessed into the cache. */
function subscribeChatEvent(
  handlers: ChatStreamHandlers,
  type: string,
  body: unknown,
): void {
  if (type === "message" && isChatMessageLike(body)) {
    handlers.onMessage?.(adaptChatMessage(body));
    return;
  }
  if (type === "deleted" && typeof body === "string") {
    handlers.onDeleted?.(body);
  }
}
