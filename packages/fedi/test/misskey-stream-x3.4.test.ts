// Repair X3.4 (networking M4/M6/L4, misskey M12/M13): Misskey stream
// hardening — breaker resets on healthy close only, 10s connect timeout,
// ping/pong liveness (two missed pongs -> reconnect), subscribe queue
// until open, handler isolation + malformed-event counter, idle release.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createStreamHandle,
  createStreamPool,
  droppedStreamEventCount,
  type StreamSocket,
} from "../src/misskey/stream";
import type { Note } from "../src/misskey/wire";

function fixtureNote(): Note {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "misskey", "note.json"), "utf8"),
  ) as Note;
}

type Listener = (ev: { data?: unknown }) => void;

/** Controllable socket: starts CONNECTING, goes OPEN on `open` (like a
 * real WebSocket — unlike the always-OPEN mocks elsewhere). */
class CtlSocket implements StreamSocket {
  static readonly OPEN = 1;
  static instances: CtlSocket[] = [];
  readyState = 0;
  url: string;
  sent: string[] = [];
  closed = false;
  listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    CtlSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit("close", {});
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, ev: { data?: unknown }): void {
    if (type === "open") this.readyState = CtlSocket.OPEN;
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

const MockWsImpl = CtlSocket as unknown as {
  new (url: string): StreamSocket;
  readonly OPEN: number;
};

function frames(socket: CtlSocket): Array<{ type: string; body?: Record<string, unknown> }> {
  return socket.sent.map((raw) => JSON.parse(raw) as { type: string; body?: Record<string, unknown> });
}

function connectId(socket: CtlSocket, channel: string): string {
  const found = frames(socket).find(
    (f) => f.type === "connect" && (f.body as { channel?: unknown } | undefined)?.channel === channel,
  );
  if (!found?.body || typeof (found.body as { id?: unknown }).id !== "string") {
    throw new Error(`no connect for ${channel} in ${socket.sent.join(" | ")}`);
  }
  return (found.body as { id: string }).id;
}

/** The heartbeat's own throwaway connect (the most recent `connect`;
 * subscription connects are never re-sent while open). */
function pingConnectId(socket: CtlSocket): string {
  const connects = frames(socket).filter((f) => f.type === "connect");
  const last = connects[connects.length - 1];
  const id = (last?.body as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string" || !id.startsWith("hb-")) {
    throw new Error(`no heartbeat ping in ${socket.sent.join(" | ")}`);
  }
  return id;
}

function ack(socket: CtlSocket, id: string): void {
  socket.emit("message", { data: JSON.stringify({ type: "connected", body: { id } }) });
}

beforeEach(() => {
  CtlSocket.instances = [];
});

describe("misskey connect timeout + subscribe queue (L4)", () => {
  it("redials a socket that never opens instead of sitting in connecting", () => {
    jest.useFakeTimers();
    try {
      const pool = createStreamPool({ origin: "https://mk.example", token: "t", wsImpl: MockWsImpl });
      const sub = pool.subscribeChannel("globalTimeline", undefined, {});
      expect(CtlSocket.instances).toHaveLength(1);
      expect(pool.status()).toBe("connecting");

      // 10s with no open: the dial fails, the socket closes, a redial is
      // scheduled (the old code had no watchdog — still `connecting`, same
      // socket, forever).
      jest.advanceTimersByTime(10_000);
      expect(CtlSocket.instances[0].closed).toBe(true);
      expect(pool.status()).toBe("reconnecting");
      jest.advanceTimersByTime(2_000);
      expect(CtlSocket.instances).toHaveLength(2);
      sub.dispose();
      pool.close();
    } finally {
      jest.useRealTimers();
    }
  });

  it("queues subscribes until open instead of marking them unavailable", () => {
    jest.useFakeTimers();
    try {
      const pool = createStreamPool({ origin: "https://mk.example", token: "t", wsImpl: MockWsImpl });
      const sub = pool.subscribeChannel("homeTimeline", undefined, {});
      const first = CtlSocket.instances[0];
      // Nothing is sent on a not-yet-open socket ...
      expect(first.sent).toHaveLength(0);
      expect(sub.status()).toBe("pending");

      // ... and no ack watchdog fires for a message that never went out.
      // The dial watchdog redials instead; the sub stays pending (the old
      // code armed the ack timer on the dropped send and flipped the sub
      // to `unavailable` here).
      jest.advanceTimersByTime(10_000);
      jest.advanceTimersByTime(2_000);
      expect(CtlSocket.instances).toHaveLength(2);
      expect(pool.status()).toBe("reconnecting");
      expect(sub.status()).toBe("pending");

      // The queued subscribe flushes on open and acks to subscribed.
      const second = CtlSocket.instances[1];
      second.emit("open", {});
      expect(connectId(second, "homeTimeline")).toBeDefined();
      ack(second, connectId(second, "homeTimeline"));
      expect(sub.status()).toBe("subscribed");
      sub.dispose();
      pool.close();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("misskey heartbeat liveness (L4: two missed pongs -> reconnect)", () => {
  it("pings a quiet socket and reconnects after two unanswered pings", () => {
    jest.useFakeTimers();
    try {
      const pool = createStreamPool({ origin: "https://mk.example", token: "t", wsImpl: MockWsImpl });
      const sub = pool.subscribeChannel("globalTimeline", undefined, {});
      const socket = CtlSocket.instances[0];
      socket.emit("open", {});
      ack(socket, connectId(socket, "globalTimeline"));
      expect(pool.status()).toBe("live");

      // Quiet for a full heartbeat window: a ping goes out (throwaway
      // `globalTimeline` connect with pong:true — documented frames only).
      jest.advanceTimersByTime(60_000);
      const pingId = pingConnectId(socket);

      // The pong acks the round trip and tears the throwaway down.
      ack(socket, pingId);
      expect(frames(socket).at(-1)).toEqual({ type: "disconnect", body: { id: pingId } });
      expect(pool.status()).toBe("live");

      // Silence again: first ping unanswered (one miss — no reconnect yet).
      jest.advanceTimersByTime(60_000);
      expect(CtlSocket.instances).toHaveLength(1);
      expect(socket.closed).toBe(false);
      jest.advanceTimersByTime(10_000);

      // Next window pings again; the second miss closes the half-open
      // socket and the normal path redials (the old code never pinged —
      // a half-open socket stayed `live` forever).
      jest.advanceTimersByTime(50_000);
      jest.advanceTimersByTime(10_000);
      expect(socket.closed).toBe(true);
      expect(pool.status()).toBe("reconnecting");
      jest.advanceTimersByTime(2_000);
      expect(CtlSocket.instances).toHaveLength(2);
      sub.dispose();
      pool.close();
    } finally {
      jest.useRealTimers();
    }
  });

  it("never pings a chatty socket (traffic is the proof)", () => {
    jest.useFakeTimers();
    try {
      const pool = createStreamPool({ origin: "https://mk.example", token: "t", wsImpl: MockWsImpl });
      const sub = pool.subscribeChannel("globalTimeline", undefined, {});
      const socket = CtlSocket.instances[0];
      socket.emit("open", {});
      const id = connectId(socket, "globalTimeline");
      ack(socket, id);

      // Steady traffic every 30s: no heartbeat ping is ever sent.
      for (let i = 0; i < 4; i++) {
        jest.advanceTimersByTime(30_000);
        socket.emit("message", {
          data: JSON.stringify({ type: "channel", body: { id, type: "note", body: fixtureNote() } }),
        });
      }
      const pings = frames(socket).filter(
        (f) =>
          f.type === "connect" &&
          typeof (f.body as { id?: unknown } | undefined)?.id === "string" &&
          ((f.body as { id: string }).id as string).startsWith("hb-"),
      );
      expect(pings).toHaveLength(0);
      sub.dispose();
      pool.close();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("misskey fast-close breaker (M4: reset on healthy close only)", () => {
  it("trips after accept-then-close loops instead of resetting in open", () => {
    jest.useFakeTimers();
    try {
      const pool = createStreamPool({ origin: "https://mk.example", token: "t", wsImpl: MockWsImpl });
      const sub = pool.subscribeChannel("globalTimeline", undefined, {});
      // Accept then immediately drop, five times: every cycle counts (the
      // old code reset the count in the open handler and looped forever).
      const delays = [2_000, 4_000, 8_000, 16_000];
      for (let i = 0; i < 5; i++) {
        const socket = CtlSocket.instances[CtlSocket.instances.length - 1];
        socket.emit("open", {});
        socket.emit("close", {});
        if (i < 4) jest.advanceTimersByTime(delays[i]);
      }
      expect(pool.status()).toBe("error");
      expect(pool.snapshot().lastError).toMatch(/refused/);
      expect(CtlSocket.instances).toHaveLength(5);
      // Dead means dead: no further dials.
      jest.advanceTimersByTime(600_000);
      expect(CtlSocket.instances).toHaveLength(5);
      sub.dispose();
      pool.close();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("misskey dispatch isolation + malformed counter (M12)", () => {
  it("isolates a throwing handler and drops unadaptable notes with a count", () => {
    const pool = createStreamPool({ origin: "https://mk.example", token: "t", wsImpl: MockWsImpl });
    const before = droppedStreamEventCount();
    const seenB: unknown[] = [];
    const subA = pool.subscribeChannel("globalTimeline", undefined, {
      onEvent: () => {
        throw new Error("sibling bug");
      },
    });
    const subB = pool.subscribeChannel("globalTimeline", undefined, {
      onEvent: (_type, body) => {
        seenB.push(body);
      },
    });
    const socket = CtlSocket.instances[0];
    socket.emit("open", {});
    // One connect per subscription (distinct server ids).
    const ids = frames(socket)
      .filter((f) => f.type === "connect")
      .map((f) => (f.body as { id: string }).id);
    expect(ids).toHaveLength(2);
    // A's handler throws: the throw is caught and counted — it never
    // escapes the socket listener (the old code let it propagate out of
    // `emit`, killing dispatch).
    expect(() =>
      socket.emit("message", {
        data: JSON.stringify({ type: "channel", body: { id: ids[0], type: "note", body: fixtureNote() } }),
      }),
    ).not.toThrow();
    expect(droppedStreamEventCount()).toBe(before + 1);
    expect(seenB).toHaveLength(0);
    // The listener survives: B still receives its own events afterwards.
    socket.emit("message", {
      data: JSON.stringify({ type: "channel", body: { id: ids[1], type: "note", body: fixtureNote() } }),
    });
    expect(seenB).toHaveLength(1);
    subA.dispose();
    subB.dispose();
    pool.close();
  });

  it("validates user presence before adaptNote (M12)", () => {
    const handle = createStreamHandle({ origin: "https://mk.example", token: "t", wsImpl: MockWsImpl })!;
    const before = droppedStreamEventCount();
    const received: string[] = [];
    const sub = handle.subscribeTimeline({ kind: "global" }, (post) => received.push(post.id));
    const socket = CtlSocket.instances[0];
    socket.emit("open", {});
    const id = connectId(socket, "globalTimeline");

    // A note event with an id but no author: dropped + counted, never
    // thrown (the old code called `adaptNote` on it and threw out of the
    // socket listener).
    socket.emit("message", {
      data: JSON.stringify({ type: "channel", body: { id, type: "note", body: { id: "ghost" } } }),
    });
    expect(received).toHaveLength(0);

    // The socket survives and routes the next good event.
    socket.emit("message", {
      data: JSON.stringify({ type: "channel", body: { id, type: "note", body: fixtureNote() } }),
    });
    expect(received).toHaveLength(1);
    expect(droppedStreamEventCount()).toBe(before + 1);
    sub.unsubscribe();
  });
});

describe("misskey idle release (M13)", () => {
  it("reports idle — not connecting — with no subscribers", () => {
    const pool = createStreamPool({ origin: "https://mk.example", token: "t", wsImpl: MockWsImpl });
    const sub = pool.subscribeChannel("globalTimeline", undefined, {});
    CtlSocket.instances[0].emit("open", {});
    expect(pool.status()).toBe("live");
    sub.dispose();
    // The idle pool holds no socket: `idle`, never a dial-that-never-runs
    // `connecting` (the old code reported `connecting` here).
    expect(pool.status()).toBe("idle");
    // A new subscriber dials fresh from idle.
    const sub2 = pool.subscribeChannel("globalTimeline", undefined, {});
    expect(pool.status()).toBe("connecting");
    CtlSocket.instances[1].emit("open", {});
    expect(pool.status()).toBe("live");
    sub2.dispose();
    expect(pool.status()).toBe("idle");
    pool.close();
  });
});
