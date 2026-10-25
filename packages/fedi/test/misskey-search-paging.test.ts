// X5.2 (M2, M10, M15; networking L6 Misskey half): search offset paging,
// the empty-page-only end rule, and the M10 tolerance guards.
//
// - `users/search` pages by `offset` (cursor encodes the next offset); no
//   `untilId` is ever sent. Covers `search.accounts` and `suggestAccounts`.
// - `pageOf`/`pageOfOffset` end ONLY on an empty page; a short non-empty
//   page still carries a cursor.
// - Guards: `isPureRenote`/`adaptNote` tolerate a missing `fileIds`,
//   favorites skip rows without a note, `countServerDrafts` tolerates an
//   empty body.
// - Loop safety: the one backend-internal paging loop (`thread()`'s
//   ancestor walk) terminates when a repeated page adds no new ids.
//
// Transports are stubbed — no network, no rig. Pure-TS: no react, no
// window/document. Fixtures: `fixtures/misskey/{users-search-p1,
// users-search-p2,favorites,note-no-fileids}.json` (synthesised; see
// manifest — X5.6 records the live bodies).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import {
  adaptNote,
  decodeCursor,
  encodeCursor,
  pageOf,
  pageOfOffset,
} from "../src/misskey/adapt";
import { countServerDrafts } from "../src/misskey/serverDrafts";
import { isPureRenote } from "../src/misskey/wire";
import type { Note, UserLite } from "../src/misskey/wire";

function fixture<T>(rel: string): T {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", rel), "utf8")) as T;
}

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
      upload<T>(_file: File, _opts: Record<string, unknown> = {}): Promise<T> {
        return Promise.reject(new Error("no uploads here"));
      },
    },
  };
}

const note = () => JSON.parse(JSON.stringify(fixture<Note>("misskey/note.json"))) as Note;

describe("misskey search: offset paging (M2)", () => {
  it("accounts() walks >= 2 pages by offset and ends on the empty page", async () => {
    const p1 = fixture<UserLite[]>("misskey/users-search-p1.json");
    const p2 = fixture<UserLite[]>("misskey/users-search-p2.json");
    const { transport, calls } = stubTransport((_endpoint, params) => {
      const offset = params.offset as number;
      if (offset === 0) return p1;
      if (offset === 2) return p2;
      return [];
    });
    const backend = createMisskeyBackend(transport);

    const first = await backend.search.accounts("ann", { limit: 2 });
    expect(calls[0]).toEqual({
      endpoint: "users/search",
      params: { query: "ann", limit: 2, offset: 0 },
    });
    expect(first.items.map((a) => a.id)).toEqual([p1[0].id, p1[1].id]);
    expect(first.end).toBe(false);
    expect(decodeCursor(first.cursor)).toEqual({ offset: 2 });

    const second = await backend.search.accounts("ann", { limit: 2, cursor: first.cursor });
    expect(calls[1]).toEqual({
      endpoint: "users/search",
      params: { query: "ann", limit: 2, offset: 2 },
    });
    expect(second.items.map((a) => a.id)).toEqual([p2[0].id]);
    // Short non-empty page: still pages (M15), cursor advances past it.
    expect(second.end).toBe(false);
    expect(decodeCursor(second.cursor)).toEqual({ offset: 3 });

    const third = await backend.search.accounts("ann", { limit: 2, cursor: second.cursor });
    expect(calls[2]).toEqual({
      endpoint: "users/search",
      params: { query: "ann", limit: 2, offset: 3 },
    });
    expect(third.items).toEqual([]);
    expect(third.end).toBe(true);
    expect(third.cursor).toBeNull();
  });

  it("suggestAccounts() pages by offset with its own default limit", async () => {
    const p1 = fixture<UserLite[]>("misskey/users-search-p1.json");
    const { transport, calls } = stubTransport(() => p1);
    const backend = createMisskeyBackend(transport);

    const first = await backend.search.suggestAccounts!("ann");
    expect(calls[0]).toEqual({
      endpoint: "users/search",
      params: { query: "ann", limit: 8, offset: 0 },
    });
    expect(first.items).toHaveLength(2);
    expect(first.end).toBe(false);
    expect(decodeCursor(first.cursor)).toEqual({ offset: 2 });

    await backend.search.suggestAccounts!("ann", { cursor: first.cursor });
    expect(calls[1]).toEqual({
      endpoint: "users/search",
      params: { query: "ann", limit: 8, offset: 2 },
    });
  });

  it("never sends untilId to users/search; a stale untilId cursor restarts at 0", async () => {
    const { transport, calls } = stubTransport(() => []);
    const backend = createMisskeyBackend(transport);
    const stale = encodeCursor({ untilId: "9oldcursor" });
    const page = await backend.search.accounts("ann", { cursor: stale });
    expect(calls[0].params).toEqual({ query: "ann", limit: 20, offset: 0 });
    expect(page).toEqual({ items: [], cursor: null, end: true });
  });
});

describe("misskey end rule (M15)", () => {
  it("pageOfOffset: empty ends, short non-empty pages with an advancing cursor", () => {
    const p1 = fixture<UserLite[]>("misskey/users-search-p1.json");
    const full = pageOfOffset(p1, 0, (u) => u.id);
    expect(full).toEqual({ items: [p1[0].id, p1[1].id], cursor: encodeCursor({ offset: 2 }), end: false });
    const tail = pageOfOffset(fixture<UserLite[]>("misskey/users-search-p2.json"), 2, (u) => u.id);
    expect(tail.end).toBe(false);
    expect(decodeCursor(tail.cursor)).toEqual({ offset: 3 });
    const empty = pageOfOffset<UserLite, string>([], 3, (u) => u.id);
    expect(empty).toEqual({ items: [], cursor: null, end: true });
  });

  it("pageOf: a full page and a short page both carry the last-id cursor", () => {
    const n = note();
    const full = pageOf([n, { ...n, id: "n2" }], 2, (x) => x.id);
    expect(full.end).toBe(false);
    expect(decodeCursor(full.cursor)).toEqual({ untilId: "n2" });
    const short = pageOf([n], 5, (x) => x.id);
    expect(short.end).toBe(false);
    expect(decodeCursor(short.cursor)).toEqual({ untilId: n.id });
  });

  it("offset cursors round-trip opaquely and reject bad offsets", () => {
    expect(decodeCursor(encodeCursor({ offset: 40 }))).toEqual({ offset: 40 });
    expect(decodeCursor(encodeCursor({ offset: 0 }))).toEqual({ offset: 0 });
    expect(decodeCursor(JSON.stringify({ offset: -1 }) as never)).toEqual({});
    expect(decodeCursor(JSON.stringify({ offset: 1.5 }) as never)).toEqual({});
    expect(decodeCursor(JSON.stringify({ offset: "2" }) as never)).toEqual({});
    expect(encodeCursor({})).toBeNull();
  });
});

describe("misskey guards (M10)", () => {
  it("isPureRenote/adaptNote tolerate a packed note without fileIds", () => {
    const raw = fixture<Record<string, unknown>>("misskey/note-no-fileids.json");
    expect("fileIds" in raw).toBe(false);
    const wireNote = raw as unknown as Note;
    expect(() => isPureRenote(wireNote)).not.toThrow();
    expect(isPureRenote(wireNote)).toBe(true);
    const post = adaptNote(wireNote);
    expect(post.mediaIds).toEqual([]);
    expect(post.media).toEqual([]);
    expect(post.renote?.id).toBe("9fz3examplenote0001");
  });

  it("a note that gains fileIds later still classifies the same way", () => {
    const withFiles = { ...fixture<Note>("misskey/note-no-fileids.json"), fileIds: ["f1"] };
    expect(isPureRenote(withFiles)).toBe(false);
  });

  it("favorites list skips rows without a note and pages on the row id", async () => {
    const rows = fixture<unknown[]>("misskey/favorites.json");
    const { transport, calls } = stubTransport(() => rows);
    const page = await createMisskeyBackend(transport).bookmarks!.list();
    expect(calls[0]).toEqual({ endpoint: "i/favorites", params: { limit: 20 } });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe("9favorite00000001");
    expect(page.items[0].post?.id).toBe("9fz3examplenote0001");
    // Cursor is the surviving ROW id, not the note id.
    expect(decodeCursor(page.cursor)).toEqual({ untilId: "9favorite00000001" });
  });

  it("countServerDrafts reads 0 on an empty body and the count otherwise", async () => {
    const empty = stubTransport(() => undefined);
    await expect(countServerDrafts(empty.transport.call)).resolves.toBe(0);
    const counted = stubTransport(() => ({ count: 3 }));
    await expect(countServerDrafts(counted.transport.call)).resolves.toBe(3);
    const junk = stubTransport(() => ({ count: "many" }));
    await expect(countServerDrafts(junk.transport.call)).resolves.toBe(0);
  });
});

describe("misskey loop safety: repeated pages terminate", () => {
  it("thread() stops when a repeated conversation page adds no new ids", async () => {
    const base = note();
    const rows = Array.from({ length: 30 }, (_, i) => ({ ...base, id: `n${i}` }));
    const { transport, calls } = stubTransport((endpoint) => {
      if (endpoint === "notes/conversation") return rows;
      return [];
    });
    const backend = createMisskeyBackend(transport);
    const post = { ...adaptNote(base), replyToId: "9parent", reply: null };
    const res = await backend.thread(post);
    // Page 1 adds 30 new ids (full page: fetch again); page 2 repeats them
    // (no new ids: stop). Never walks to the MAX_ANCESTOR_WALK bound.
    expect(calls.filter((c) => c.endpoint === "notes/conversation")).toHaveLength(2);
    expect(res.ancestors).toEqual([]);
    expect(res.incomplete).toBe(true);
  });
});
