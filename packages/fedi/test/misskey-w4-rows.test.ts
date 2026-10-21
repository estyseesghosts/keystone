// W4 fedi data-layer rows — Misskey family (C15-data/C18-data).
//
// - C15: lists create/update/delete ride `users/lists/create|update|
//   delete` with `{name}` / `{listId, name}` / `{listId}`; the packed
//   UserList answers `{id, name, ...}`.
// - C18: `renoteMutes` lists `renote-mute/list`, which answers packed
//   RenoteMuting rows (`{id, createdAt, muteeId, mutee}` — verified in the
//   Misskey checkout), unwrapped to accounts; paging is the standard
//   untilId cursor.

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import type { UserDetailed } from "../src/misskey/wire";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "misskey", name), "utf8"),
  ) as T;
}

const user = fixture<UserDetailed>("user.json");

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

function stubTransport(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { transport: MisskeyTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: {
      call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint, params });
        return Promise.resolve(respond(endpoint, params) as T);
      },
      upload<T>(): Promise<T> {
        throw new Error("not used here");
      },
    },
  };
}

function mutingRow(id: string, mutee: UserDetailed) {
  return { id, createdAt: "2026-01-01T00:00:00.000Z", muteeId: mutee.id, mutee };
}

describe("C15-data — misskey lists CRUD", () => {
  it("create/update/delete hit users/lists/* with the v1 params", async () => {
    const { transport, calls } = stubTransport((endpoint) => {
      if (endpoint === "users/lists/create") return { id: "l1", name: "news" };
      if (endpoint === "users/lists/update") return { id: "l1", name: "renamed" };
      return undefined;
    });
    const backend = createMisskeyBackend(transport);
    await expect(backend.lists!.create!("news")).resolves.toEqual({ id: "l1", name: "news" });
    await expect(backend.lists!.update!("l1", { name: "renamed" })).resolves.toEqual({
      id: "l1",
      name: "renamed",
    });
    await backend.lists!.delete!("l1");
    expect(calls).toEqual([
      { endpoint: "users/lists/create", params: { name: "news" } },
      { endpoint: "users/lists/update", params: { listId: "l1", name: "renamed" } },
      { endpoint: "users/lists/delete", params: { listId: "l1" } },
    ]);
  });
});

describe("C18-data — misskey renoteMutes", () => {
  it("unwraps renote-mute/list rows to accounts with an untilId cursor", async () => {
    const rows = [mutingRow("m1", user), mutingRow("m2", { ...user, id: "u2", username: "b" })];
    const { transport, calls } = stubTransport(() => rows);
    const backend = createMisskeyBackend(transport);
    const page = await backend.renoteMutes!({ limit: 20 });
    expect(calls[0]).toEqual({ endpoint: "renote-mute/list", params: { limit: 20 } });
    expect(page.items.map((a) => a.id)).toEqual([user.id, "u2"]);
    // Cursor is the last MUTING id (what renote-mute/list pages on).
    expect(page.cursor).toBe(JSON.stringify({ untilId: "m2" }));
    const second = await backend.renoteMutes!({ cursor: page.cursor });
    expect(calls[1]).toEqual({
      endpoint: "renote-mute/list",
      params: { limit: 20, untilId: "m2" },
    });
    expect(second.items).toHaveLength(2);
  });

  it("an empty listing ends with no cursor", async () => {
    const { transport } = stubTransport(() => []);
    const page = await createMisskeyBackend(transport).renoteMutes!();
    expect(page).toEqual({ items: [], cursor: null, end: true });
  });
});
