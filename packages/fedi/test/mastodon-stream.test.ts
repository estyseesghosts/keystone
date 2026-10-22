// Mastodon-family WebSocket streaming (`mastodon/stream`): the socket URL
// is built from the SESSION origin (never a mismatched advertised one),
// auth rides the `Sec-WebSocket-Protocol` pair (never the query string),
// and frames route to the right handler. The socket itself is injected
// (no network); reconnect breaker/timeout cases use fake timers.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createStreamHandle,
  resolveStreamingBase,
  streamingSupported,
  streamUrl,
  type MastoSocket,
} from "../src/mastodon/stream";
import type { Notification as WireNotification, Status as WireStatus } from "../src/mastodon/wire";

function fixture<T>(flavor: string, name: string): T {
  const raw = readFileSync(join(__dirname, "fixtures", flavor, name), "utf8");
  return JSON.parse(raw) as T;
}

const ORIGIN = "https://mastodon.example";
const TOKEN = "tok-123";

interface MockSocket extends MastoSocket {
  url: string;
  protocols?: string[];
  sent: string[];
  closed: boolean;
  fireOpen(): void;
  fireFrame(event: string, payload: unknown): void;
  fireRaw(data: string): void;
  fireClose(): void;
}

function mockFactory(sockets: MockSocket[]) {
  return (url: string, protocols?: string[]): MastoSocket => {
    const socket: MockSocket = {
      url,
      protocols,
      sent: [],
      closed: false,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close() {
        socket.closed = true;
      },
      send(data) {
        socket.sent.push(data);
      },
      fireOpen() {
        socket.onopen?.({});
      },
      fireFrame(event, payload) {
        socket.onmessage?.({ data: JSON.stringify({ event, payload }) });
      },
      fireRaw(data) {
        socket.onmessage?.({ data });
      },
      fireClose() {
        socket.onclose?.({});
      },
    };
    sockets.push(socket);
    return socket;
  };
}

const status = () => fixture<WireStatus>("mastodon", "status.json");
const notification = () => fixture<WireNotification>("mastodon", "notification.json");

describe("streamUrl", () => {
  it("builds /api/v1/streaming from the session origin without a token", () => {
    const url = streamUrl(ORIGIN, "user", {});
    expect(url).toBe("wss://mastodon.example/api/v1/streaming?stream=user");
    expect(url).not.toContain("access_token");
    expect(streamUrl("http://localhost:4000", "public", {})).toBe(
      "ws://localhost:4000/api/v1/streaming?stream=public",
    );
  });

  it("streamingSupported reflects the WebSocket global", () => {
    expect(streamingSupported()).toBe(typeof (globalThis as { WebSocket?: unknown }).WebSocket === "function");
  });
});

describe("streaming origin scheme pin (contract §8)", () => {
  it("accepts a split host whose scheme matches the session origin", () => {
    expect(resolveStreamingBase("https://mastodon.example", "wss://stream.mastodon.example")).toBe(
      "wss://stream.mastodon.example",
    );
    expect(resolveStreamingBase("http://localhost:4000", "ws://stream.localhost:4000")).toBe(
      "ws://stream.localhost:4000",
    );
  });

  it("refuses a cross-scheme advertisement and falls back to the session origin", () => {
    // https session + ws advertisement: refused.
    expect(resolveStreamingBase("https://mastodon.example", "ws://stream.mastodon.example")).toBe(
      "wss://mastodon.example",
    );
    // http session + wss advertisement: refused.
    expect(resolveStreamingBase("http://localhost:4000", "wss://stream.localhost")).toBe(
      "ws://localhost:4000",
    );
    // Non-ws(s) advertisement is never dialed either.
    expect(resolveStreamingBase("https://mastodon.example", "https://stream.mastodon.example")).toBe(
      "wss://mastodon.example",
    );
  });

  it("never dials a refused origin and never puts the token in the URL", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, {
      token: TOKEN,
      streamingOrigin: "ws://insecure.example",
      wsFactory: mockFactory(sockets),
    })!;
    const sub = handle.subscribeTimeline({ kind: "home" }, () => undefined);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("wss://mastodon.example/api/v1/streaming?stream=user");
    expect(sockets[0].url).not.toContain("insecure.example");
    expect(sockets[0].url).not.toContain(TOKEN);
    sub.unsubscribe();
  });

  it("accepts a split-host advertisement only when the scheme agrees", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, {
      token: TOKEN,
      streamingOrigin: "wss://stream.mastodon.example",
      wsFactory: mockFactory(sockets),
    })!;
    const sub = handle.subscribeTimeline({ kind: "home" }, () => undefined);
    expect(sockets[0].url).toBe("wss://stream.mastodon.example/api/v1/streaming?stream=user");
    sub.unsubscribe();
  });
});

describe("createStreamHandle over WebSocket", () => {
  it("authenticates with Sec-WebSocket-Protocol, not ?access_token=", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const sub = handle!.subscribeTimeline({ kind: "home" }, () => undefined);
    expect(sockets).toHaveLength(1);
    // The auth pair rides the subprotocol list; the URL carries no token.
    expect(sockets[0].protocols).toEqual(["Bearer", TOKEN]);
    expect(sockets[0].url).toBe("wss://mastodon.example/api/v1/streaming?stream=user");
    expect(sockets[0].url).not.toContain("access_token");
    expect(sockets[0].url).not.toContain(TOKEN);
    sub.unsubscribe();
  });

  it("connects to /api/v1/streaming and routes update events", () => {
    const sockets: MockSocket[] = [];
    const posts: string[] = [];
    const states: string[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const unsub = handle!.onStatusChange((s) => states.push(s));
    const sub = handle!.subscribeTimeline({ kind: "home" }, (p) => posts.push(p.id));

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("wss://mastodon.example/api/v1/streaming?stream=user");
    expect(handle!.status()).toBe("connecting");

    sockets[0].fireOpen();
    expect(handle!.status()).toBe("connected");
    // Immediate current-state on subscribe, re-announced by open(), then open.
    expect(states).toEqual(["connecting", "connecting", "connected"]);

    const body = status();
    sockets[0].fireFrame("update", JSON.stringify(body));
    expect(posts).toEqual([body.id]);
    sockets[0].fireFrame("status.update", JSON.stringify(body));
    expect(posts).toEqual([body.id, body.id]);
    // Delete + malformed frames never crash the socket.
    sockets[0].fireFrame("delete", body.id);
    sockets[0].onmessage?.({ data: "not-json" });
    expect(posts).toHaveLength(2);

    sub.unsubscribe();
    expect(sockets[0].closed).toBe(true);
    unsub();
  });

  it("answers Akkoma's bare text ping with pong without routing it", () => {
    const sockets: MockSocket[] = [];
    const posts: string[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) })!;
    const sub = handle.subscribeTimeline({ kind: "home" }, (p) => posts.push(p.id));
    sockets[0].fireOpen();

    sockets[0].fireRaw("ping");
    expect(sockets[0].sent).toEqual(["pong"]);
    // A defensive JSON ping shape answers the same way.
    sockets[0].fireFrame("ping", null);
    expect(sockets[0].sent).toEqual(["pong", "pong"]);
    // Nothing was routed or errored: the socket still delivers updates.
    const body = status();
    sockets[0].fireFrame("update", JSON.stringify(body));
    expect(posts).toEqual([body.id]);
    expect(handle.status()).toBe("connected");
    sub.unsubscribe();
  });

  it("closes on kill and never redials", () => {
    jest.useFakeTimers();
    try {
      const sockets: MockSocket[] = [];
      const handle = createStreamHandle(ORIGIN, {
        token: TOKEN,
        wsFactory: mockFactory(sockets),
      })!;
      const sub = handle.subscribeTimeline({ kind: "home" }, () => undefined);
      sockets[0].fireOpen();
      expect(handle.status()).toBe("connected");

      sockets[0].fireFrame("kill", null);
      expect(sockets[0].closed).toBe(true);
      expect(handle.status()).toBe("stopped");
      // No reconnect is scheduled, ever.
      jest.advanceTimersByTime(120_000);
      expect(sockets).toHaveLength(1);
      sub.unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });

  it("surfaces filters_changed through onFiltersChanged", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) })!;
    let changed = 0;
    const off = handle.onFiltersChanged!(() => {
      changed += 1;
    });
    const sub = handle.subscribeTimeline({ kind: "home" }, () => undefined);
    sockets[0].fireOpen();
    sockets[0].fireFrame("filters_changed", undefined);
    expect(changed).toBe(1);
    off();
    sockets[0].fireFrame("filters_changed", undefined);
    expect(changed).toBe(1);
    sub.unsubscribe();
  });

  it("routes notification events to the notification listener", () => {
    const sockets: MockSocket[] = [];
    const kinds: string[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const off = handle!.onNotification((n) => kinds.push(n.kind));
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("stream=user");
    sockets[0].fireOpen();
    sockets[0].fireFrame("notification", JSON.stringify(notification()));
    expect(kinds).toEqual(["favourite"]);
    off();
  });

  it("social has no socket — the feed falls back to paging, never an error", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const sub = handle!.subscribeTimeline({ kind: "social" }, () => {
      throw new Error("must never fire");
    });
    expect(sub.status()).toBe("disabled");
    expect(sockets).toHaveLength(0);
    expect(() => sub.unsubscribe()).not.toThrow();
  });
});

describe("reconnect breaker (contract §8: 10s ack, stop after 5)", () => {
  it("treats a socket that never opens as a failure after 10s and redials", () => {
    jest.useFakeTimers();
    try {
      const sockets: MockSocket[] = [];
      const handle = createStreamHandle(ORIGIN, {
        token: TOKEN,
        wsFactory: mockFactory(sockets),
      })!;
      const sub = handle.subscribeTimeline({ kind: "home" }, () => undefined);
      expect(sockets).toHaveLength(1);

      jest.advanceTimersByTime(9_999);
      expect(sockets[0].closed).toBe(false);
      expect(handle.status()).toBe("connecting");

      // 10s without an open/connected ack = a failure, not a permanent
      // connect: the socket is closed and a redial is scheduled.
      jest.advanceTimersByTime(1);
      expect(sockets[0].closed).toBe(true);
      expect(handle.status()).toBe("error");

      jest.advanceTimersByTime(2_000);
      expect(sockets).toHaveLength(2);
      sub.unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops after 5 fast closes and a manual retry re-dials and clears it", () => {
    jest.useFakeTimers();
    try {
      const sockets: MockSocket[] = [];
      const handle = createStreamHandle(ORIGIN, {
        token: TOKEN,
        wsFactory: mockFactory(sockets),
      })!;
      const sub = handle.subscribeTimeline({ kind: "home" }, () => undefined);

      // Backoff after each close: attempt 1..4 → 2s, 4s, 8s, 16s.
      const delays = [2_000, 4_000, 8_000, 16_000];
      for (let i = 0; i < 5; i++) {
        sockets[sockets.length - 1].fireClose();
        if (i < 4) jest.advanceTimersByTime(delays[i]);
      }
      expect(handle.status()).toBe("stopped");
      const dialed = sockets.length;
      expect(dialed).toBe(5);

      // Dead means dead: advancing time never dials again.
      jest.advanceTimersByTime(600_000);
      expect(sockets).toHaveLength(dialed);

      // Manual retry clears the breaker and re-dials; a healthy open
      // returns to the normal connected state.
      handle.retry!();
      expect(sockets).toHaveLength(dialed + 1);
      expect(handle.status()).toBe("connecting");
      sockets[dialed].fireOpen();
      expect(handle.status()).toBe("connected");
      sub.unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });

  it("resets the breaker after a connection that stayed up", () => {
    jest.useFakeTimers();
    try {
      const sockets: MockSocket[] = [];
      const handle = createStreamHandle(ORIGIN, {
        token: TOKEN,
        wsFactory: mockFactory(sockets),
      })!;
      const sub = handle.subscribeTimeline({ kind: "home" }, () => undefined);
      sockets[0].fireOpen();
      jest.advanceTimersByTime(30_000); // healthy for 30s
      sockets[0].fireClose();
      expect(handle.status()).toBe("error");
      // Four more fast closes after a healthy connection stay under the
      // breaker: it counted 1, not 6.
      const delays = [2_000, 4_000, 8_000, 16_000];
      for (let i = 0; i < 4; i++) {
        jest.advanceTimersByTime(delays[i]);
        sockets[sockets.length - 1].fireClose();
      }
      expect(handle.status()).not.toBe("stopped");
      sub.unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });
});
