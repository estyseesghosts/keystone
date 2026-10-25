// Mastodon-family delete delivery (mastodon 13): per-post capture over the
// shared `user` stream filters by id, so watched-id deletes reach
// `onDeleted` — and every `delete` frame ALSO fans out to the handle-level
// `onDeletes` subscription, so the app drops unwatched ids from its feed
// caches without a refetch. `onPost` still never receives deletes (they
// are not arrivals).
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

describe("mastodon delete delivery (mastodon 13)", () => {
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

  it("feed-level deletes fan out to onDeletes but never to onPost (mastodon 13)", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const posts: string[] = [];
    const deleted: string[] = [];
    const sub = handle!.subscribeTimeline({ kind: "home" }, (p) => posts.push(p.id));
    const offDeletes = deletesOf(handle!)(id => deleted.push(id));
    sockets[0].fireOpen();
    const body = status();
    sockets[0].fireFrame("delete", body.id);
    // Feed-level deletes never look like arrivals ...
    expect(posts).toEqual([]);
    // ... but they DO reach the feed-level deletes subscription now (the
    // app drops the post from its feed caches): previously they surfaced
    // nowhere unless the id was watched.
    expect(deleted).toEqual([body.id]);
    sub.unsubscribe();
    offDeletes();
  });

  it("per-post capture and the feed-level fan-out fire together for watched ids", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle(ORIGIN, { token: TOKEN, wsFactory: mockFactory(sockets) });
    expect(handle).not.toBeNull();
    const watched: string[] = [];
    const fanned: string[] = [];
    const offPost = handle!.subscribePost("post-a", { onDeleted: () => watched.push("post-a") });
    const offFan = deletesOf(handle!)(id => fanned.push(id));
    sockets[0].fireOpen();
    sockets[0].fireFrame("delete", "post-a");
    // Both paths fire (the app's delete handler is idempotent, so the
    // double delivery removes the row exactly once).
    expect(watched).toEqual(["post-a"]);
    expect(fanned).toEqual(["post-a"]);
    offPost();
    offFan();
  });
});

/** Feed-level deletes subscription (structural: beyond `StreamHandle`). */
function deletesOf(handle: NonNullable<ReturnType<typeof createStreamHandle>>) {
  const fanout = handle as unknown as {
    onDeletes: (handler: (id: string) => void) => () => void;
  };
  return fanout.onDeletes;
}
