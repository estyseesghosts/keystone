// X5.1 (M1): wrapper-row account lists. `users/followers`,
// `users/following`, `mute/list` and `blocking/list` answer WRAPPER rows
// (`{id, follower | followee | mutee | blockee}`), not bare users. Every
// lister must unwrap its key, skip rows without a string-id user, keep the
// paging cursor on the ROW id, and tolerate bare-user rows (fork-compat).
// Follow/unfollow-style writes target the unwrapped USER id, never the row.
//
// Transports are stubbed — no network, no rig. Pure-TS: no react,
// no window/document. Fixtures: `fixtures/misskey/{followers,following,
// mutes,blocks}.json` (synthesised wrapper rows; see manifest).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { decodeCursor } from "../src/misskey/adapt";
import { listBlocks, listMutes } from "../src/misskey/mutes";
import type { WireCall } from "../src/misskey/client";
import type { UserDetailed } from "../src/misskey/wire";

function fixture<T>(rel: string): T {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", rel), "utf8")) as T;
}

const bareUser = (): UserDetailed =>
  JSON.parse(JSON.stringify(fixture<UserDetailed>("misskey/user.json")));

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

function stubCall(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { call: WireCall; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const call = ((endpoint: string, params: Record<string, unknown> = {}) => {
    calls.push({ endpoint, params });
    return Promise.resolve().then(() => respond(endpoint, params));
  }) as WireCall;
  return { call, calls };
}

function stubTransport(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { transport: MisskeyTransport; calls: RecordedCall[] } {
  const { call, calls } = stubCall(respond);
  return {
    calls,
    transport: {
      call,
      upload: (() => Promise.reject(new Error("no uploads here"))) as MisskeyTransport["upload"],
    },
  };
}

describe("misskey wrapper rows: followers", () => {
  it("unwraps follower rows; items carry USER ids, cursor carries the ROW id", async () => {
    const rows = fixture<unknown[]>("misskey/followers.json");
    const { transport, calls } = stubTransport(() => rows);
    const backend = createMisskeyBackend(transport);
    const page = await backend.followers("9exampleuser00001");
    expect(calls[0]).toEqual({
      endpoint: "users/followers",
      params: { userId: "9exampleuser00001", limit: 20 },
    });
    // Items are the inner users, not the wrapper rows.
    expect(page.items.map((a) => a.id)).toEqual(["9exampleuser00002", "9exampleuser00003"]);
    expect(page.items[0].username).toBe("bob");
    expect(page.items[1].acct).toBe("cara@remote.example");
    // 2 < 20 still pages (M15 end rule): only an empty page ends the feed.
    expect(page.end).toBe(false);
    // The cursor is the LAST ROW id (untilId pages on the row).
    expect(decodeCursor(page.cursor)).toEqual({ untilId: "9followrow000002" });
    // ... and it round-trips as untilId on the next page.
    await backend.followers("9exampleuser00001", { cursor: page.cursor });
    expect(calls[1]).toEqual({
      endpoint: "users/followers",
      params: { userId: "9exampleuser00001", limit: 20, untilId: "9followrow000002" },
    });
  });
});

describe("misskey wrapper rows: following", () => {
  it("unwraps followee rows; items carry USER ids, cursor carries the ROW id", async () => {
    const rows = fixture<unknown[]>("misskey/following.json");
    const { transport, calls } = stubTransport(() => rows);
    const backend = createMisskeyBackend(transport);
    const page = await backend.following("9exampleuser00001");
    expect(calls[0]).toEqual({
      endpoint: "users/following",
      params: { userId: "9exampleuser00001", limit: 20 },
    });
    expect(page.items.map((a) => a.id)).toEqual(["9exampleuser00004", "9exampleuser00005"]);
    expect(page.items[0].username).toBe("dan");
    expect(decodeCursor(page.cursor)).toEqual({ untilId: "9followrow000012" });
  });
});

describe("misskey wrapper rows: mutes + blocks", () => {
  it("backend mutes() unwraps mutee rows with no userId param", async () => {
    const rows = fixture<unknown[]>("misskey/mutes.json");
    const { transport, calls } = stubTransport(() => rows);
    const page = await createMisskeyBackend(transport).mutes();
    expect(calls[0]).toEqual({ endpoint: "mute/list", params: { limit: 20 } });
    expect(page.items.map((a) => a.id)).toEqual(["9exampleuser00006", "9exampleuser00007"]);
    expect(page.items[0].username).toBe("fil");
    expect(decodeCursor(page.cursor)).toEqual({ untilId: "9mutingrow000002" });
  });

  it("backend blocks() unwraps blockee rows with no userId param", async () => {
    const rows = fixture<unknown[]>("misskey/blocks.json");
    const { transport, calls } = stubTransport(() => rows);
    const page = await createMisskeyBackend(transport).blocks();
    expect(calls[0]).toEqual({ endpoint: "blocking/list", params: { limit: 20 } });
    expect(page.items.map((a) => a.id)).toEqual(["9exampleuser00008", "9exampleuser00009"]);
    expect(page.items[1].username).toBe("ivy");
    expect(decodeCursor(page.cursor)).toEqual({ untilId: "9blockingrow000002" });
  });

  it("mutes.ts listBlocks/listMutes unwrap and page on the row id", async () => {
    const muteRows = fixture<unknown[]>("misskey/mutes.json");
    const blockRows = fixture<unknown[]>("misskey/blocks.json");
    const { call, calls } = stubCall((endpoint) =>
      endpoint === "mute/list" ? muteRows : blockRows,
    );
    const mutes = await listMutes(call, 10, "cur");
    expect(calls[0]).toEqual({ endpoint: "mute/list", params: { limit: 10, untilId: "cur" } });
    expect(mutes.items.map((a) => a.id)).toEqual(["9exampleuser00006", "9exampleuser00007"]);
    expect(decodeCursor(mutes.cursor)).toEqual({ untilId: "9mutingrow000002" });
    const blocks = await listBlocks(call);
    expect(calls[1]).toEqual({ endpoint: "blocking/list", params: { limit: 20 } });
    expect(blocks.items.map((a) => a.id)).toEqual(["9exampleuser00008", "9exampleuser00009"]);
    expect(decodeCursor(blocks.cursor)).toEqual({ untilId: "9blockingrow000002" });
  });
});

describe("misskey wrapper rows: tolerance", () => {
  it("bare-user rows (fork-compat) adapt as-is on every endpoint", async () => {
    const one = bareUser();
    const two = { ...bareUser(), id: "9exampleuser00010", username: "zed" };
    const { transport } = stubTransport(() => [one, two]);
    const backend = createMisskeyBackend(transport);
    const pages = [
      await backend.followers("9exampleuser00001"),
      await backend.following("9exampleuser00001"),
      await backend.mutes(),
      await backend.blocks(),
    ];
    for (const page of pages) {
      expect(page.items.map((a) => a.id)).toEqual([one.id, "9exampleuser00010"]);
      expect(page.items[1].username).toBe("zed");
    }
    const { call } = stubCall(() => [one, two]);
    expect((await listMutes(call)).items.map((a) => a.id)).toEqual([
      one.id,
      "9exampleuser00010",
    ]);
    expect((await listBlocks(call)).items.map((a) => a.id)).toEqual([
      one.id,
      "9exampleuser00010",
    ]);
  });

  it("mixed wrapper/bare/malformed rows: only valid users survive", async () => {
    const good = fixture<Record<string, unknown>[]>("misskey/followers.json")[0];
    const rows = [
      good,
      bareUser(),
      { id: "row-gone", follower: null },
      { id: "row-empty" },
      null,
      "not-an-object",
      { id: 123, follower: { id: 456 } },
      { id: "row-nonstring-id", follower: { ...bareUser(), id: 42 } },
    ];
    const { transport } = stubTransport(() => rows);
    const page = await createMisskeyBackend(transport).followers("9exampleuser00001");
    expect(page.items.map((a) => a.id)).toEqual(["9exampleuser00002", bareUser().id]);
    expect(page.items[0].username).toBe("bob");
  });
});

describe("misskey wrapper rows: writes target the USER id", () => {
  it("follow/unfollow/block/mute target the unwrapped user id, never the row id", async () => {
    const rows = fixture<Record<string, unknown>[]>("misskey/followers.json");
    const rowId = rows[0].id;
    const userId = (rows[0].follower as UserDetailed).id;
    expect(rowId).not.toBe(userId);
    const { transport, calls } = stubTransport(() => rows);
    const backend = createMisskeyBackend(transport);
    const page = await backend.followers("9exampleuser00001");
    const target = page.items[0].id;
    expect(target).toBe(userId);
    await backend.follow(target);
    await backend.unfollow(target);
    await backend.block(target);
    await backend.unblock(target);
    await backend.mute(target);
    await backend.unmute(target);
    expect(calls.slice(1).map((c) => c.params)).toEqual([
      { userId },
      { userId },
      { userId },
      { userId },
      { userId },
      { userId },
    ]);
    expect(calls.slice(1).map((c) => c.endpoint)).toEqual([
      "following/create",
      "following/delete",
      "blocking/create",
      "blocking/delete",
      "mute/create",
      "mute/delete",
    ]);
  });
});
