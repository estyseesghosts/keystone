// Misskey-family per-post delete/update capture (WS-G seam proof):
// `subNote` broadcast captures route `noteUpdated` (reacted/unreacted/
// deleted/pollVoted) to the watched id — the same capture `createFeedLive`
// mounts for every cached post id.
import {
  createStreamHandle,
  type StreamSocket,
} from "../src/misskey/stream";

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

function noteUpdated(id: string, type: string) {
  return {
    data: JSON.stringify({ type: "noteUpdated", body: { id, type, body: {} } }),
  };
}

beforeEach(() => {
  MockSocket.instances = [];
});

describe("misskey per-post capture over subNote broadcast (WS-G)", () => {
  it("routes deleted to onDeleted and reaction deltas to onUpdated", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "tok",
      wsImpl: MockWsImpl,
    });
    expect(handle).not.toBeNull();
    const deleted: string[] = [];
    const updated: Array<{ id: string; type: string }> = [];
    const off = handle!.subscribePost("note1", {
      onDeleted: () => deleted.push("note1"),
      onUpdated: (event) => updated.push({ id: event.id, type: event.type }),
    });
    // The capture subscribes over one pooled socket.
    expect(MockSocket.instances).toHaveLength(1);
    expect(MockSocket.instances[0].url).toBe("wss://mk.example/streaming?i=tok");
    MockSocket.instances[0].emit("open", {});

    MockSocket.instances[0].emit(
      "message",
      noteUpdated("note1", "reacted"),
    );
    expect(updated).toEqual([{ id: "note1", type: "reacted" }]);
    MockSocket.instances[0].emit(
      "message",
      noteUpdated("note1", "pollVoted"),
    );
    expect(updated).toEqual([
      { id: "note1", type: "reacted" },
      { id: "note1", type: "pollVoted" },
    ]);
    MockSocket.instances[0].emit(
      "message",
      noteUpdated("note1", "deleted"),
    );
    expect(deleted).toEqual(["note1"]);
    // Updates for unwatched ids never reach this capture.
    MockSocket.instances[0].emit(
      "message",
      noteUpdated("note2", "deleted"),
    );
    expect(deleted).toEqual(["note1"]);
    off();
  });
});
