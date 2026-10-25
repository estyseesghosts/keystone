// X5.6 — Misskey stream ack-timeout path (audit M13, "Test and fixture gaps").
//
// Dedupe: connect timeout + subscribe queue, heartbeat liveness, fast-close
// breaker, dispatch isolation + malformed counter, and idle release already
// live in `misskey-stream-x3.4.test.ts`; chat-channel resubscription lives in
// `misskey-chat-stream.test.ts` (whose header claims the ack-timeout path,
// but no test drives it — this file is that missing test). Missing until
// now: a `connect` the server never acks marks the subscription
// `unavailable` after ACK_TIMEOUT_MS, and the next `connected` (after a
// reconnect) restores it to `subscribed`.

import { createStreamPool, type StreamSocket } from "../src/misskey/stream";

type Listener = (ev: { data?: unknown }) => void;

class MockSocket implements StreamSocket {
  static readonly OPEN = 1;
  static instances: MockSocket[] = [];
  readonly readyState = MockSocket.OPEN;
  url: string;
  sent: string[] = [];
  listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close", {});
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, ev: { data?: unknown }): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

const MockWsImpl = MockSocket as unknown as {
  new (url: string): StreamSocket;
  readonly OPEN: number;
};

function lastConnectId(socket: MockSocket): string {
  const frames = socket.sent.map((raw) => JSON.parse(raw) as { type: string; body?: { id?: unknown } });
  const connects = frames.filter((frame) => frame.type === "connect");
  const id = connects[connects.length - 1]?.body?.id;
  if (typeof id !== "string") throw new Error("no connect id sent");
  return id;
}

function connected(socket: MockSocket, serverId: string): void {
  socket.emit("message", { data: JSON.stringify({ type: "connected", body: { id: serverId } }) });
}

describe("misskey stream ack timeout (M13)", () => {
  beforeEach(() => {
    MockSocket.instances = [];
  });

  it("marks the subscription unavailable after the ack timeout, then subscribed on the next connected", () => {
    jest.useFakeTimers();
    try {
      const pool = createStreamPool({
        origin: "https://mk.example",
        token: "sess-token",
        wsImpl: MockWsImpl,
      });
      const sub = pool.subscribeChannel("homeTimeline", {}, {});
      const first = MockSocket.instances[0];
      first.emit("open", {});
      expect(sub.status()).toBe("pending");
      // No `connected` ack arrives: the watchdog fires, not the socket.
      jest.advanceTimersByTime(10_001);
      expect(sub.status()).toBe("unavailable");
      expect(pool.status()).toBe("live");
      // The socket drops; the pool redials with the same subscription, the
      // server acks this time, and the sub recovers — the M13 retry path.
      first.emit("close", {});
      expect(pool.status()).toBe("reconnecting");
      jest.advanceTimersByTime(2_000);
      expect(MockSocket.instances).toHaveLength(2);
      const second = MockSocket.instances[1];
      second.emit("open", {});
      connected(second, lastConnectId(second));
      expect(sub.status()).toBe("subscribed");
      sub.dispose();
      pool.close();
    } finally {
      jest.useRealTimers();
    }
  });
});
