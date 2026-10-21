// Mastodon-family per-post delete/update capture (WS-G seam proof): the
// shared `user` stream filters by id, so watched-id deletes reach
// `onDeleted` — the feed-level seam is intentional (subscribeTimeline has
// no delete channel on the `StreamHandle` interface; unwatched ids have no
// cached row to remove) and stays as documented, not rewired.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createStreamHandle,
  type MastoSocket,
} from "../src/mastodon/stream";
import type { Status as WireStatus } from "../src/mastodon/wire";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "mastodon", name), "utf8"),
  ) as T;
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

const status = () => fixture<WireStatus>("status.json");

describe("mastodon per-post capture over the shared user stream (WS-G)", () => {
  it("routes delete frames to the watched id's onDeleted only", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const deleted: string[] = [];
    const offA = handle!.subscribePost("post-a", { onDeleted: () => deleted.push("post-a") });
    const offB = handle!.subscribePost("post-b", { onDeleted: () => deleted.push("post-b") });
    // One pooled socket for both captures (same `user` entry).
    expect(sockets).toHaveLength(1);
    sockets[0].fireOpen();

    sockets[0].fireFrame("delete", "post-b");
    expect(deleted).toEqual(["post-b"]);
    sockets[0].fireFrame("delete", "unwatched-id");
    expect(deleted).toEqual(["post-b"]);
    offA();
    offB();
  });

  it("routes update frames to onUpdated with the post id", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const updated: Array<{ id: string; type: string }> = [];
    const body = status();
    const off = handle!.subscribePost(body.id, {
      onUpdated: (event) => updated.push({ id: event.id, type: event.type }),
    });
    sockets[0].fireOpen();
    sockets[0].fireFrame("update", JSON.stringify(body));
    expect(updated).toEqual([{ id: body.id, type: "update" }]);
    off();
  });

  it("feed-level deletes never reach onPost (seam, by design — per-post capture is the delete path)", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const posts: string[] = [];
    const sub = handle!.subscribeTimeline({ kind: "home" }, (p) => posts.push(p.id));
    sockets[0].fireOpen();
    const body = status();
    sockets[0].fireFrame("delete", body.id);
    expect(posts).toEqual([]);
    sub.unsubscribe();
  });
});
