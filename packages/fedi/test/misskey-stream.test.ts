// Misskey streaming against a mock WebSocket (slice 2.2 addition — the old
// repo has no stream test). Opens the pool, subscribes a timeline channel,
// replays `open` + a `channel`/`note` event, and asserts the adapted post
// is dispatched. The stream URL is built from the session ORIGIN (never
// `window.location`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adaptNote } from "../src/misskey/adapt";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { createStreamHandle, createStreamPool, streamUrlFor } from "../src/misskey/stream";
import type { StreamSocket } from "../src/misskey/stream";
import type { Note } from "../src/misskey/wire";

function fixtureNote(): Note {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "misskey", "note.json"), "utf8"),
  ) as Note;
}

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

beforeEach(() => {
  MockSocket.instances = [];
});

describe("streamUrlFor (session origin, never window.location)", () => {
  it("maps https: to wss with the token query", () => {
    expect(streamUrlFor("https://mk.example", "tok")).toBe(
      "wss://mk.example/streaming?i=tok",
    );
  });

  it("maps http: (local test targets) to ws and omits an empty token", () => {
    expect(streamUrlFor("http://localhost:3000", null)).toBe(
      "ws://localhost:3000/streaming",
    );
  });
});

describe("stream pool note events (mock WebSocket)", () => {
  it("dispatches an adapted post for a channel note event", async () => {
    const pool = createStreamPool({
      origin: "https://mk.example",
      token: "sess-token",
      wsImpl: MockWsImpl,
    });
    const received: Array<{ id: string }> = [];
    const sub = pool.subscribeChannel("globalTimeline", undefined, {
      onEvent: (type, body) => {
        if (type === "note" && body && typeof body === "object" && "id" in body) {
          received.push(adaptNote(body as Note));
        }
      },
    });
    expect(MockSocket.instances).toHaveLength(1);
    expect(MockSocket.instances[0].url).toBe("wss://mk.example/streaming?i=sess-token");

    const socket = MockSocket.instances[0];
    socket.emit("open", {});
    expect(pool.status()).toBe("live");

    const connect = JSON.parse(socket.sent[0]) as { type: string; body: { channel: string; id: string } };
    expect(connect.type).toBe("connect");
    expect(connect.body.channel).toBe("globalTimeline");

    // Server ack for our subscription id.
    socket.emit("message", {
      data: JSON.stringify({ type: "connected", body: { id: connect.body.id } }),
    });
    expect(sub.status()).toBe("subscribed");

    const note = fixtureNote();
    socket.emit("message", {
      data: JSON.stringify({
        type: "channel",
        body: { id: connect.body.id, type: "note", body: note },
      }),
    });
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(note.id);

    sub.dispose();
    pool.close();
  });

  it("Backend.stream() wires the handle to the session origin", () => {
    // Smoke-level: the handle subscribes through a pool built from the
    // backend's origin (no global location involved).
    const transport: MisskeyTransport = {
      call: async <T,>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> => {
        void endpoint;
        void params;
        return [] as unknown as T;
      },
      upload: async <T,>(): Promise<T> => {
        throw new Error("no upload in this test");
      },
    };
    const backend = createMisskeyBackend(transport, "misskey", {
      origin: "https://mk.example",
      token: "t",
    });
    // No socket implementation is injected here, so subscribing would hit
    // the global WebSocket — assert only handle construction + status.
    const handle = backend.stream();
    expect(handle).not.toBeNull();
    expect(handle!.status()).toBe("connecting");
  });

  it("createStreamHandle returns null for unsupported servers and tokenless auth feeds", () => {
    expect(
      createStreamHandle({ origin: "https://x.example", token: "t", supported: false }),
    ).toBeNull();
    const handle = createStreamHandle({
      origin: "https://x.example",
      token: null,
      wsImpl: MockWsImpl,
    })!;
    // Home needs auth: no credential, no subscription (disabled, no socket).
    const sub = handle.subscribeTimeline({ kind: "home" }, () => undefined);
    expect(sub.status()).toBe("disabled");
    expect(MockSocket.instances).toHaveLength(0);
  });
});
