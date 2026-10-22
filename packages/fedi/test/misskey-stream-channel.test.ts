// Misskey channel streaming (clickstone §1.9): a `channel|<id>` feed maps
// to the server's `channel` stream channel with `{channelId}`, the ack
// moves the subscription from pending to subscribed, note events adapt,
// and dispose sends `disconnect` (closing the socket once nothing is left).
// The handle is built from the session origin + token, exactly like every
// other live feed — no URLs assembled from `window.location`, no token
// bug borrowed from the Mastodon family.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createStreamHandle } from "../src/misskey/stream";
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
  closed = false;
  listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
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
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

const MockWsImpl = MockSocket as unknown as {
  new (url: string): StreamSocket;
  readonly OPEN: number;
};

function sentMessages(socket: MockSocket): Array<{ type: string; body?: Record<string, unknown> }> {
  return socket.sent.map(raw => JSON.parse(raw) as { type: string; body?: Record<string, unknown> });
}

beforeEach(() => {
  MockSocket.instances = [];
});

describe("channel feed streaming", () => {
  it("subscribes the `channel` stream channel with the channel id", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: null,
      wsImpl: MockWsImpl,
    })!;
    const sub = handle.subscribeTimeline({ channelId: "8f2chan0000000001" }, () => undefined);

    expect(MockSocket.instances).toHaveLength(1);
    const [connect] = sentMessages(MockSocket.instances[0]);
    expect(connect).toEqual({
      type: "connect",
      body: {
        channel: "channel",
        id: expect.any(String),
        params: { channelId: "8f2chan0000000001" },
        pong: true,
      },
    });
    // Public channel: no credential required (a tokenless viewer streams too).
    expect(MockSocket.instances[0].url).toBe("wss://mk.example/streaming");
    // Pending until the server acks.
    expect(sub.status()).toBe("pending");
    sub.unsubscribe();
  });

  it("acks by id, dispatches adapted notes, and is subscribed only after `connected`", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "tok",
      wsImpl: MockWsImpl,
    })!;
    const received: Array<{ id: string }> = [];
    const sub = handle.subscribeTimeline({ channelId: "c1" }, post => {
      received.push({ id: post.id });
    });

    const socket = MockSocket.instances[0];
    socket.emit("open", {});
    const connect = sentMessages(socket)[0];
    const id = connect.body!.id as string;

    expect(sub.status()).toBe("pending");
    socket.emit("message", { data: JSON.stringify({ type: "connected", body: { id } }) });
    expect(sub.status()).toBe("subscribed");

    const event = fixtureNote();
    socket.emit("message", {
      data: JSON.stringify({ type: "channel", body: { id, type: "note", body: event } }),
    });
    expect(received).toEqual([{ id: event.id }]);
  });

  it("ignores a `connected` ack for another subscription", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "tok",
      wsImpl: MockWsImpl,
    })!;
    const sub = handle.subscribeTimeline({ channelId: "c1" }, () => undefined);
    const socket = MockSocket.instances[0];
    socket.emit("message", { data: JSON.stringify({ type: "connected", body: { id: "nope" } }) });
    expect(sub.status()).toBe("pending");
    sub.unsubscribe();
  });

  it("sends disconnect on unsubscribe and closes the socket when nothing is left", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "tok",
      wsImpl: MockWsImpl,
    })!;
    const sub = handle.subscribeTimeline({ channelId: "c1" }, () => undefined);
    const socket = MockSocket.instances[0];
    socket.emit("open", {});
    const id = sentMessages(socket)[0].body!.id as string;

    sub.unsubscribe();
    expect(sentMessages(socket).at(-1)).toEqual({ type: "disconnect", body: { id } });
    expect(socket.closed).toBe(true);
  });

  it("keeps the socket open while another feed is still subscribed", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "tok",
      wsImpl: MockWsImpl,
    })!;
    const channelSub = handle.subscribeTimeline({ channelId: "c1" }, () => undefined);
    const homeSub = handle.subscribeTimeline({ kind: "home" }, () => undefined);
    const socket = MockSocket.instances[0];
    socket.emit("open", {});

    channelSub.unsubscribe();
    expect(socket.closed).toBe(false);
    // The channel disconnect went out; the home channel stays.
    const types = sentMessages(socket).map(m => m.type);
    expect(types).toContain("disconnect");

    homeSub.unsubscribe();
    expect(socket.closed).toBe(true);
  });

  it("does not borrow a Mastodon-style URL token: the token rides `?i=` on the same origin", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "sec ret",
      wsImpl: MockWsImpl,
    })!;
    const sub = handle.subscribeTimeline({ channelId: "c1" }, () => undefined);
    expect(MockSocket.instances[0].url).toBe(
      "wss://mk.example/streaming?i=sec%20ret",
    );
    sub.unsubscribe();
  });
});
