// W4 fedi data-layer rows — Mastodon family (MD1/MD2/MD3/C15-data).
//
// Pins the wire behaviour against the verified server sources
// (docs/mastoapi-contract.md + the Mastodon 4.8 / Akkoma 3.20 checkouts):
// - MD1: v2 notifications take `types[]`/`exclude_types[]` (the v2
//   controller permits both) and page via Link continuations; only
//   404/405 falls back to v1 (auth/timeout/5xx rethrow — never masked);
// - MD2: bookmarks page via `Link rel="next"`, never a length heuristic;
// - MD3: filters try v2 groups first, v1 keywords on 404/405; the v1
//   shape maps directly, the v2 group maps honestly (first keyword is
//   the phrase, `filter_action: "hide"` is the irreversible);
// - C15: lists create/update/delete ride `/api/v1/lists` with `title`.

import { createMastodonBackend } from "../src/mastodon/backend";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import { MastoHttpError } from "../src/mastodon/client";
import { decodeContinuation } from "../src/mastodon/adapt";
import { ApiError } from "../src/core/errors";
import type { Account, Status } from "../src/mastodon/wire";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function fixture<T>(flavor: string, name: string): T {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", flavor, name), "utf8")) as T;
}

const status = fixture<Status>("mastodon", "status.json");
const account = fixture<Account>("mastodon", "account.json");

interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
}

type Responder = (
  method: string,
  path: string,
  body?: unknown,
) => { data?: unknown; headers?: Headers } | never;

function stubClient(respond: Responder): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<RequestResult<never>> => {
    calls.push({ method, path, body });
    // Async (like the real transport): a throwing responder rejects,
    // so the backend's guarded() boundary adapts it to ApiError.
    const out = respond(method, path, body);
    return {
      status: 200,
      data: out.data as never,
      headers: out.headers ?? new Headers(),
    };
  };
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token: "t",
    get: (path, query, _o) => run("GET", path, query),
    post: (path, body, _o) => run("POST", path, body),
    put: (path, body, _o) => run("PUT", path, body),
    patch: (path, body, _o) => run("PATCH", path, body),
    delete: (path, body, _o) => run("DELETE", path, body),
    postForm: (path, body, _o) => run("POST", path, body),
    postFormData: (path, body, _o) => run("POST", path, body),
  };
  return { client, calls };
}

function httpError(status: number): MastoHttpError {
  return new MastoHttpError({
    message: `HTTP ${status}`,
    status,
    kind: "http",
    origin: "https://mastodon.example",
    path: "/x",
  });
}

const V2_NEXT = '<https://mastodon.example/api/v2/notifications?max_id=42>; rel="next"';

function v2Envelope() {
  return {
    accounts: [account],
    notifications: [
      { id: "n1", type: "favourite", account_id: account.id, created_at: "2026-01-01T00:00:00.000Z" },
    ],
  };
}

describe("MD1 — v2 notifications filter + paging", () => {
  it("sends types/exclude_types to /api/v2/notifications", async () => {
    const { client, calls } = stubClient(() => ({ data: v2Envelope() }));
    const page = await createMastodonBackend(client).notifications({
      includeTypes: ["reaction"],
      excludeTypes: ["follow"],
    });
    expect(calls[0].path).toBe("/api/v2/notifications");
    const query = calls[0].body as Record<string, unknown>;
    expect(query.types).toEqual(["favourite", "pleroma:emoji_reaction"]);
    expect(query.exclude_types).toEqual(["follow"]);
    expect(page.items[0].kind).toBe("favourite");
    // No Link header: end, no cursor.
    expect(page.end).toBe(true);
    expect(page.cursor).toBeNull();
  });

  it("pages the v2 path via the Link header (fetchMore advances)", async () => {
    const { client, calls } = stubClient((_m, path) => {
      if (path.startsWith("https://mastodon.example/api/v2/notifications?max_id=")) {
        return { data: v2Envelope() };
      }
      return { data: v2Envelope(), headers: new Headers({ Link: V2_NEXT }) };
    });
    const backend = createMastodonBackend(client);
    const first = await backend.notifications();
    expect(first.end).toBe(false);
    expect(first.cursor).not.toBeNull();
    const cont = decodeContinuation(first.cursor);
    expect(cont?.kind).toBe("url");
    const second = await backend.notifications({ cursor: first.cursor });
    // The follow-up reads the server's own next URL — still on v2, no v1 call.
    expect(calls[1].path).toContain("/api/v2/notifications");
    expect(calls[1].path).toContain("max_id=42");
    expect(calls.map((c) => c.path)).not.toContain("/api/v1/notifications");
    expect(second.items).toHaveLength(1);
    expect(second.end).toBe(true);
  });

  it("falls back to v1 on 404, keeping the type filter honest there", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v2/notifications") throw httpError(404);
      expect(path).toBe("/api/v1/notifications");
      return { data: [] };
    });
    const page = await createMastodonBackend(client).notifications({
      includeTypes: ["mention"],
      excludeTypes: ["follow"],
    });
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v2/notifications",
      "/api/v1/notifications",
    ]);
    const v1query = calls[1].body as Record<string, unknown>;
    expect(v1query.types).toEqual(["mention"]);
    expect(v1query.exclude_types).toEqual(["follow"]);
    expect(page).toEqual({ items: [], cursor: null, end: true });
  });

  it("does NOT swallow non-absence errors into a v1 retry", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v2/notifications") throw httpError(401);
      return { data: [] };
    });
    await expect(createMastodonBackend(client).notifications()).rejects.toMatchObject({
      status: 401,
    });
    expect(calls.map((c) => c.path)).toEqual(["/api/v2/notifications"]);
  });

  it("a real notification_groups envelope falls back to flat v1 rows", async () => {
    // Real grouped servers send `notification_groups` + separate
    // accounts/statuses — a shape the adapter cannot read yet (reported
    // gap). The backend serves honest flat v1 rows instead of broken
    // group rows.
    const fav = fixture<import("../src/mastodon/wire").Notification>(
      "mastodon",
      "notification.json",
    );
    const { client, calls } = stubClient((_m, path) =>
      path === "/api/v2/notifications"
        ? {
            data: {
              accounts: [],
              statuses: [],
              notification_groups: [
                { group_key: "fav-1", notifications_count: 3, type: "favourite" },
              ],
            },
          }
        : { data: [fav] },
    );
    const page = await createMastodonBackend(client).notifications();
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v2/notifications",
      "/api/v1/notifications",
    ]);
    expect(page.items[0].kind).toBe("favourite");
  });

  it("a cursor pinned to a v1 next-URL stays on v1", async () => {
    const v1Next = '<https://mastodon.example/api/v1/notifications?max_id=7>; rel="next"';
    const { client, calls } = stubClient((_m, path) => {
      if (path === "/api/v1/notifications") {
        return { data: [], headers: new Headers({ Link: v1Next }) };
      }
      return { data: [] };
    });
    const backend = createMastodonBackend(client);
    const first = await backend.notifications();
    // Array-bodied v2 stub: no envelope, so v1 served the first page.
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v2/notifications",
      "/api/v1/notifications",
    ]);
    const second = await backend.notifications({ cursor: first.cursor });
    expect(second.end).toBe(true);
    // The follow-up followed the v1 next URL — v2 was never re-probed.
    expect(calls[2].path).toContain("/api/v1/notifications");
    expect(calls[2].path).toContain("max_id=7");
  });
});

describe("MD2 — bookmarks page via Link rel=next", () => {
  it("follows the next link into a real cursor (fetchMore advances)", async () => {
    const next = '<https://mastodon.example/api/v1/bookmarks?max_id=9>; rel="next"';
    const { client, calls } = stubClient((_m, path) => {
      if (path.includes("max_id=9")) return { data: [] };
      return { data: [status], headers: new Headers({ Link: next }) };
    });
    const backend = createMastodonBackend(client);
    const first = await backend.bookmarks!.list({ limit: 20 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toEqual({ id: status.id, post: expect.objectContaining({ id: status.id }) });
    expect(first.end).toBe(false);
    expect(first.cursor).not.toBeNull();
    const second = await backend.bookmarks!.list({ cursor: first.cursor });
    expect(calls[1].path).toContain("/api/v1/bookmarks");
    expect(calls[1].path).toContain("max_id=9");
    expect(second).toEqual({ items: [], cursor: null, end: true });
  });

  it("no next link ends the feed even with items (never length<limit)", async () => {
    const { client } = stubClient(() => ({ data: [status] }));
    const page = await createMastodonBackend(client).bookmarks!.list({ limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.end).toBe(true);
    expect(page.cursor).toBeNull();
  });
});

describe("MD3 — filters v2-first with v1 fallback", () => {
  const v2row = {
    id: "f1",
    title: "spoilers",
    context: ["home", "public"],
    expires_at: null,
    filter_action: "hide",
    keywords: [{ id: "k1", keyword: "spoiler", whole_word: true }],
  };
  const v1row = {
    id: "f9",
    phrase: "leak",
    context: ["home"],
    expires_at: null,
    irreversible: false,
    whole_word: false,
  };

  it("list() maps v2 groups to phrase rows", async () => {
    const { client, calls } = stubClient(() => ({ data: [v2row] }));
    const rows = await createMastodonBackend(client).filters!.list();
    expect(calls[0]).toEqual({ method: "GET", path: "/api/v2/filters", body: undefined });
    expect(rows).toEqual([
      {
        id: "f1",
        phrase: "spoiler",
        context: ["home", "public"],
        expiresAt: null,
        irreversible: true,
        wholeWord: true,
      },
    ]);
  });

  it("list() falls back to v1 keywords on 404 (Akkoma/Pleroma)", async () => {
    const { client, calls } = stubClient((_m, path) => {
      if (path === "/api/v2/filters") throw httpError(404);
      return { data: [v1row] };
    });
    const rows = await createMastodonBackend(client).filters!.list();
    expect(calls.map((c) => c.path)).toEqual(["/api/v2/filters", "/api/v1/filters"]);
    expect(rows).toEqual([
      {
        id: "f9",
        phrase: "leak",
        context: ["home"],
        expiresAt: null,
        irreversible: false,
        wholeWord: false,
      },
    ]);
  });

  it("list() rethrows non-absence errors (no silent v1 retry)", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v2/filters") throw httpError(403);
      return { data: [] };
    });
    await expect(createMastodonBackend(client).filters!.list()).rejects.toBeInstanceOf(ApiError);
    expect(calls.map((c) => c.path)).toEqual(["/api/v2/filters"]);
  });

  it("create() posts a v2 group (title + keywords_attributes + filter_action)", async () => {
    const { client, calls } = stubClient(() => ({ data: v2row }));
    const row = await createMastodonBackend(client).filters!.create("spoiler", ["home"], {
      wholeWord: true,
      irreversible: true,
    });
    expect(calls[0].path).toBe("/api/v2/filters");
    expect(calls[0].body).toEqual({
      title: "spoiler",
      context: ["home"],
      filter_action: "hide",
      keywords_attributes: [{ keyword: "spoiler", whole_word: true }],
    });
    expect(row.phrase).toBe("spoiler");
    expect(row.irreversible).toBe(true);
  });

  it("create() maps expiresAt to expires_in seconds on both paths", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const { client, calls } = stubClient(() => ({ data: v2row }));
    await createMastodonBackend(client).filters!.create("x", ["home"], { expiresAt: future });
    const body = calls[0].body as Record<string, unknown>;
    expect(typeof body.expires_in).toBe("number");
    expect(body.expires_in as number).toBeGreaterThan(3000);
    expect(body.expires_in as number).toBeLessThanOrEqual(3600);
    expect("expires_at" in body).toBe(false);
  });

  it("create() falls back to the v1 keyword shape on 405", async () => {
    const { client, calls } = stubClient((_m, path) => {
      if (path === "/api/v2/filters") throw httpError(405);
      return { data: v1row };
    });
    const row = await createMastodonBackend(client).filters!.create("leak", ["home"]);
    expect(calls[1]).toEqual({
      method: "POST",
      path: "/api/v1/filters",
      body: { phrase: "leak", context: ["home"] },
    });
    // No filter_action on v1 — stays absent, never fabricated.
    expect(row).toEqual({
      id: "f9",
      phrase: "leak",
      context: ["home"],
      expiresAt: null,
      irreversible: false,
      wholeWord: false,
    });
  });

  it("update() rewrites v2 keywords in place (show-then-PUT)", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (method === "GET") return { data: v2row };
      return {
        data: {
          ...v2row,
          title: "edited",
          keywords: [{ id: "k1", keyword: "edited", whole_word: false }],
        },
      };
    });
    const row = await createMastodonBackend(client).filters!.update("f1", "edited", ["home"]);
    expect(calls[0]).toEqual({ method: "GET", path: "/api/v2/filters/f1", body: undefined });
    expect(calls[1].path).toBe("/api/v2/filters/f1");
    // The existing keyword keeps its id (edited in place, not appended).
    expect((calls[1].body as Record<string, unknown>).keywords_attributes).toEqual([
      { id: "k1", keyword: "edited", whole_word: false },
    ]);
    expect(row.phrase).toBe("edited");
  });

  it("delete() falls back to v1 on 404", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v2/filters/f1") throw httpError(404);
      return {};
    });
    await createMastodonBackend(client).filters!.delete("f1");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "DELETE /api/v2/filters/f1",
      "DELETE /api/v1/filters/f1",
    ]);
  });
});

describe("C15-data — mastodon lists CRUD", () => {
  it("create/update/delete ride /api/v1/lists with title", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (method === "POST") return { data: { id: "l1", title: "news" } };
      if (method === "PUT") return { data: { id: "l1", title: "renamed" } };
      return {};
    });
    const backend = createMastodonBackend(client);
    await expect(backend.lists!.create!("news")).resolves.toEqual({ id: "l1", name: "news" });
    await expect(backend.lists!.update!("l1", { name: "renamed" })).resolves.toEqual({
      id: "l1",
      name: "renamed",
    });
    await backend.lists!.delete!("l1");
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/lists", body: { title: "news" } },
      { method: "PUT", path: "/api/v1/lists/l1", body: { title: "renamed" } },
      { method: "DELETE", path: "/api/v1/lists/l1", body: undefined },
    ]);
  });
});
