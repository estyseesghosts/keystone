// P6.2 Mastodon-family conversations (DM inbox):
//   GET    /api/v1/conversations          → Link-paged inbox
//   <get>  (client-side list scan — NEITHER server has a show route;
//           Mastodon `resources :conversations, only: [:index, :destroy]`,
//           Akkoma's `:show` lives under `/api/v1/pleroma`, not `/api/v1`)
//   DELETE /api/v1/conversations/:id
//   POST   /api/v1/conversations/:id/read → the updated conversation
//
// Row shape verified in the local checkouts (Mastodon
// `REST::ConversationSerializer`, Akkoma `ConversationView`
// `participation.json`): `{id, accounts[], unread, last_status|null}`.
// Replies reuse the existing status-post path (`visibility: direct` +
// `in_reply_to_id`) — pinned here so nobody duplicates compose code.
// Transport stubbed — no network.

import { createMastodonBackend } from "../src/mastodon/backend";
import {
  deleteConversation,
  fetchConversation,
  fetchConversationsPage,
  markConversationRead,
} from "../src/mastodon/conversations";
import type { MastoClient, RequestOptions, RequestResult } from "../src/mastodon/client";
import { ApiError } from "../src/core/errors";
import { isUnsupportedError } from "../src/misskey/client";
import { isPermissionError } from "../src/misskey/client";
import { statusBodyOf } from "../src/mastodon/compose";

interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
  opts?: RequestOptions;
}

type Responder = (
  method: string,
  path: string,
  body: unknown,
) => { data?: unknown; headers?: Headers; status?: number } | never;

function stubClient(respond: Responder): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run = async (
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<RequestResult<never>> => {
    calls.push({ method, path, body, opts });
    const out = respond(method, path, body);
    return {
      status: out.status ?? 200,
      data: out.data as never,
      headers: out.headers ?? new Headers(),
    };
  };
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token: "t",
    get: (path, query, opts) => run("GET", path, query, opts),
    post: (path, body, opts) => run("POST", path, body, opts),
    put: (path, body, opts) => run("PUT", path, body, opts),
    patch: (path, body, opts) => run("PATCH", path, body, opts),
    delete: (path, body, opts) => run("DELETE", path, body, opts),
    postForm: (path, body, opts) => run("POST", path, body, opts),
    postFormData: (path, body, opts) => run("POST", path, body, opts),
    patchFormData: (path, body, opts) => run("PATCH", path, body, opts),
  };
  return { client, calls };
}

function absent(status = 404): never {
  throw new ApiError(`HTTP ${status}`, status);
}

const wireAccount = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  username: "alice",
  acct: "alice",
  display_name: "Alice",
  ...overrides,
});

const wireStatus = (overrides: Record<string, unknown> = {}) => ({
  id: "s1",
  created_at: "2026-10-20T10:00:00.000Z",
  content: "<p>hello there</p>",
  visibility: "direct",
  account: wireAccount(),
  ...overrides,
});

const wireConversation = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  accounts: [wireAccount()],
  unread: true,
  last_status: wireStatus(),
  ...overrides,
});

function linkNext(url: string): Headers {
  return new Headers({ Link: `<${url}>; rel="next"` });
}

describe("conversations list (GET /api/v1/conversations)", () => {
  it("pages the inbox and adapts rows to domain models", async () => {
    const next = "https://mastodon.example/api/v1/conversations?limit=20&max_id=c1";
    const { client, calls } = stubClient(() => ({
      data: [wireConversation()],
      headers: linkNext(next),
    }));
    const page = await fetchConversationsPage(client, {});
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/v1/conversations" });
    expect(page.items).toHaveLength(1);
    const [conv] = page.items;
    expect(conv.id).toBe("c1");
    expect(conv.unread).toBe(true);
    // Domain models only: adapted accounts and post, never wire rows.
    expect(conv.accounts[0].acct).toBe("alice");
    expect(conv.lastPost?.id).toBe("s1");
    expect(conv.lastPost?.content.plain).toBe("hello there");
    // A server next link means more pages (contract §5).
    expect(page.end).toBe(false);
    expect(page.continuation).not.toBeNull();
  });

  it("ends on a missing next link or an empty page — never on length", async () => {
    const noLink = stubClient(() => ({ data: [wireConversation()] }));
    const full = await fetchConversationsPage(noLink.client, {});
    expect(full.end).toBe(true);
    expect(full.continuation).toBeNull();

    const empty = stubClient(() => ({
      data: [],
      headers: linkNext("https://mastodon.example/api/v1/conversations?max_id=c9"),
    }));
    expect((await fetchConversationsPage(empty.client, {})).end).toBe(true);
  });

  it("carries the cursor on older pages and tolerates a null last_status", async () => {
    const { client, calls } = stubClient(() => ({
      data: [wireConversation({ id: "c2", last_status: null, unread: false })],
    }));
    const page = await fetchConversationsPage(client, {
      continuation: { kind: "cursors", cursors: { max_id: "c1", limit: 20 } },
    });
    expect(calls[0].body).toMatchObject({ max_id: "c1" });
    expect(page.items[0].lastPost).toBeNull();
    expect(page.items[0].unread).toBe(false);
  });

  it("maps a 404/405 list to the honest unsupported state (no DM inbox here)", async () => {
    for (const status of [404, 405]) {
      const { client } = stubClient(() => absent(status));
      let caught: unknown = null;
      try {
        await fetchConversationsPage(client, {});
      } catch (err) {
        caught = err;
      }
      expect(isUnsupportedError(caught)).toBe(true);
    }
  });

  it("keeps a 403 as a permission error (scope upgrade), never absence", async () => {
    const { client } = stubClient(() => absent(403));
    let caught: unknown = null;
    try {
      await fetchConversationsPage(client, {});
    } catch (err) {
      caught = err;
    }
    expect(isPermissionError(caught)).toBe(true);
    expect(isUnsupportedError(caught)).toBe(false);
  });
});

describe("conversations get-one (client-side scan — no show route)", () => {
  it("finds a conversation across pages", async () => {
    const { client } = stubClient((method, path, body) => {
      const params = (body ?? {}) as Record<string, unknown>;
      // A same-origin next link replays through the URL (contract §5), so
      // the stub matches the cursor in both the path and the query object.
      if (params.max_id === "c1" || path.includes("max_id=c1")) {
        return { data: [wireConversation({ id: "c2" })]};
      }
      return {
        data: [wireConversation({ id: "c1" })],
        headers: linkNext("https://mastodon.example/api/v1/conversations?max_id=c1"),
      };
    });
    const conv = await fetchConversation(client, "c2");
    expect(conv.id).toBe("c2");
    expect(conv.accounts[0].acct).toBe("alice");
  });

  it("reads a 404 scan miss as unsupported (nothing to open)", async () => {
    const { client } = stubClient(() => ({ data: [wireConversation({ id: "c1" })] }));
    let caught: unknown = null;
    try {
      await fetchConversation(client, "gone");
    } catch (err) {
      caught = err;
    }
    expect(isUnsupportedError(caught)).toBe(true);
  });

  it("stops on a repeated continuation instead of spinning forever", async () => {
    const next = "https://mastodon.example/api/v1/conversations?max_id=c1";
    const { client } = stubClient(() => ({
      data: [wireConversation({ id: "c1" })],
      headers: linkNext(next),
    }));
    let caught: unknown = null;
    try {
      await fetchConversation(client, "gone");
    } catch (err) {
      caught = err;
    }
    expect(isUnsupportedError(caught)).toBe(true);
  });
});

describe("conversations delete + mark-read", () => {
  it("deletes through DELETE /api/v1/conversations/:id with an encoded id", async () => {
    const { client, calls } = stubClient(() => ({ status: 200, data: {} }));
    await deleteConversation(client, "c1");
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/api/v1/conversations/c1" });
    await deleteConversation(client, "a/b");
    expect(calls[1].path).toBe("/api/v1/conversations/a%2Fb");
  });

  it("marks read through POST .../:id/read and returns the updated row", async () => {
    const { client, calls } = stubClient(() => ({ data: wireConversation({ unread: false }) }));
    const conv = await markConversationRead(client, "c1");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/v1/conversations/c1/read" });
    expect(conv.id).toBe("c1");
    expect(conv.unread).toBe(false);
  });

  it("maps a 404 delete/read to the honest unsupported state", async () => {
    const { client } = stubClient(() => absent(404));
    for (const run of [() => deleteConversation(client, "c1"), () => markConversationRead(client, "c1")]) {
      let caught: unknown = null;
      try {
        await run();
      } catch (err) {
        caught = err;
      }
      expect(isUnsupportedError(caught)).toBe(true);
    }
  });
});

describe("MastodonBackend.conversations", () => {
  it("is present on mastodon + akkoma, absent on pleroma/unknown", () => {
    for (const flavor of ["mastodon", "akkoma"] as const) {
      const { client } = stubClient(() => ({ data: [] }));
      const backend = createMastodonBackend(client, { flavor });
      expect(backend.conversations).toBeDefined();
      expect(backend.capabilities.direct_messages).toBe("supported");
    }
    for (const flavor of ["pleroma", "unknown"] as const) {
      const { client } = stubClient(() => ({ data: [] }));
      const backend = createMastodonBackend(client, { flavor });
      expect(backend.conversations).toBeUndefined();
    }
  });

  it("lists through the backend with the session cursor", async () => {
    const { client, calls } = stubClient(() => ({ data: [wireConversation()] }));
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    const page = await backend.conversations!.list({ limit: 10 });
    expect(calls[0].body).toMatchObject({ limit: 10 });
    expect(page.items[0].id).toBe("c1");
    expect(page.end).toBe(true);
  });

  it("never leaks a token across sessions: each backend calls its own origin", async () => {
    const origins: string[] = [];
    const mk = (origin: string): MastoClient => ({
      origin,
      token: `token-for-${origin}`,
      get: (async <T>(path: string) => {
        origins.push(origin);
        void path;
        return { status: 200, data: [] as unknown as T, headers: new Headers() };
      }) as MastoClient["get"],
      post: () => Promise.reject(new Error("unexpected post")),
      put: () => Promise.reject(new Error("unexpected put")),
      patch: () => Promise.reject(new Error("unexpected patch")),
      delete: () => Promise.reject(new Error("unexpected delete")),
      postForm: () => Promise.reject(new Error("unexpected postForm")),
      postFormData: () => Promise.reject(new Error("unexpected postFormData")),
      patchFormData: () => Promise.reject(new Error("unexpected patchFormData")),
    });
    const a = createMastodonBackend(mk("https://a.example"), { flavor: "mastodon" });
    const b = createMastodonBackend(mk("https://b.example"), { flavor: "mastodon" });
    await a.conversations!.list();
    await b.conversations!.list();
    expect(origins).toEqual(["https://a.example", "https://b.example"]);
  });
});

describe("DM replies reuse the status-post path (no duplicate compose code)", () => {
  it("a direct reply body carries visibility direct + in_reply_to_id", () => {
    const body = statusBodyOf({
      text: "on it",
      cw: null,
      visibility: { kind: "direct", localOnly: false },
      replyId: "s1",
    });
    expect(body.visibility).toBe("direct");
    expect(body.in_reply_to_id).toBe("s1");
    expect(body.status).toBe("on it");
  });
});
