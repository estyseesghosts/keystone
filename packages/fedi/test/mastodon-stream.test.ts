// Mastodon-family WebSocket streaming (`mastodon/stream`): the socket URL
// is built from the SESSION origin with its token, and frames route to the
// right handler. The socket itself is injected (no network, no timers).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createStreamHandle,
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
  closed: boolean;
  fireOpen(): void;
  fireFrame(event: string, payload: unknown): void;
  fireClose(): void;
}

function mockFactory(sockets: MockSocket[]) {
  return (url: string): MastoSocket => {
    const socket: MockSocket = {
      url,
      closed: false,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close() {
        socket.closed = true;
      },
      fireOpen() {
        socket.onopen?.({});
      },
      fireFrame(event, payload) {
        socket.onmessage?.({ data: JSON.stringify({ event, payload }) });
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
  it("builds /api/v1/streaming from the session origin with its token", () => {
    const url = streamUrl(ORIGIN, "user", {}, TOKEN);
    expect(url).toBe("wss://mastodon.example/api/v1/streaming?stream=user&access_token=tok-123");
    expect(streamUrl("http://localhost:4000", "public", {})).toBe(
      "ws://localhost:4000/api/v1/streaming?stream=public",
    );
  });

  it("streamingSupported reflects the WebSocket global", () => {
    expect(streamingSupported()).toBe(typeof (globalThis as { WebSocket?: unknown }).WebSocket === "function");
  });
});

describe("createStreamHandle over WebSocket", () => {
  it("connects to /api/v1/streaming and routes update events", () => {
    const sockets: MockSocket[] = [];
    const posts: string[] = [];
    const states: string[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const unsub = handle!.onStatusChange((s) => states.push(s));
    const sub = handle!.subscribeTimeline({ kind: "home" }, (p) => posts.push(p.id));

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("wss://mastodon.example/api/v1/streaming?stream=user&access_token=tok-123");
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
