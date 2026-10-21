// W8 mastodon data-layer rows (MD6–MD12 mastodon side, MD14 mastodon half).
//
// Pins the parity-gap closures against the verified wire contracts
// (docs/mastoapi-contract.md §4/§5) with stubbed transports — no network:
// - MD6: updateProfile maps name/bio/locked/bot/fields_attributes,
//   lang→source.language, snake_case ext allow-list; Misskey-only
//   generics refuse honestly; avatar/banner refusal stays.
// - MD7: followRequests pages via Link cursor (PageOpts, same array
//   return) and verifies self once per handle.
// - MD8: account() falls back past a 404ing /lookup (v1 search, then
//   v2 search resolve); only absence falls back.
// - MD9: scheduled.list fills the draft preview from wire
//   params/media_attachments (still {post, draft} — no interface change).
// - MD10: the socket dials the advertised streamingOrigin; one socket
//   per (stream, params) shared across subscriptions; subscribePost
//   filters the shared user stream by id (status/delete hooks only).
// - MD11: GoToSocial/glitch-soc/Hometown collapse to mastodon; the News
//   tab stays vanilla-mastodon-only (live GTS unverified — no GTS rig).
// - MD12: toApiError adapts MastoHttpError so the shared predicates
//   read it; direct instance failures leave adapted.
// - MD14: fixtures for grouped-v2 notifications, media-processing,
//   filter rows and list payloads; thread-cycle, quoteMarker and
//   presentation cycles covered here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMastodonBackend, toApiError } from "../src/mastodon/backend";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import { MastoHttpError } from "../src/mastodon/client";
import { isPermissionError, isUnsupportedError } from "../src/misskey/client";
import { ApiError } from "../src/core/errors";
import type { FollowRequest, PageOpts } from "../src/core/backend";
import { detectFamily } from "../src/mastodon/instance";
import { collapseReblogs, foldTree } from "../src/mastodon/presentation";
import { pickQuotedStatus } from "../src/mastodon/quoteMarker";
import { rebuildThread } from "../src/mastodon/thread";
import { adaptStatus } from "../src/mastodon/adapt";
import {
  createStreamHandle,
  streamUrl,
  type MastoSocket,
} from "../src/mastodon/stream";
import type { Account, Status } from "../src/mastodon/wire";

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

function stubClient(
  respond: (method: string, path: string, body?: unknown) => { data?: unknown; headers?: Headers } | never,
): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<RequestResult<never>> => {
    calls.push({ method, path, body });
    const out = respond(method, path, body);
    return { status: 200, data: out.data as never, headers: out.headers ?? new Headers() };
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

// --- MD6 --------------------------------------------------------------------

describe("MD6 — updateProfile maps the credential wire honestly", () => {
  it("sends display_name/note/locked/bot/fields_attributes verbatim", async () => {
    const credential = { ...account, source: { privacy: "public" } };
    const { client, calls } = stubClient(() => ({ data: credential }));
    const updated = await createMastodonBackend(client).updateProfile({
      name: "Eugen",
      bio: "dev",
      locked: true,
      bot: false,
      fields: [{ name: "site", value: "https://example.com" }],
    });
    expect(calls[0]).toEqual({
      method: "PATCH",
      path: "/api/v1/accounts/update_credentials",
      body: {
        display_name: "Eugen",
        note: "dev",
        locked: true,
        bot: false,
        fields_attributes: [{ name: "site", value: "https://example.com" }],
      },
    });
    expect(updated.id).toBe(account.id);
  });

  it("maps lang to source.language and passes the snake_case ext allow-list", async () => {
    const { client, calls } = stubClient(() => ({ data: account }));
    await createMastodonBackend(client).updateProfile({
      lang: "de",
      ext: { discoverable: false, indexable: true, source: { privacy: "private" } },
    });
    expect(calls[0].body).toEqual({
      source: { language: "de", privacy: "private" },
      discoverable: false,
      indexable: true,
    });
  });

  it("refuses Misskey-only generics instead of dropping them (new code, ADD-only)", async () => {
    const { client, calls } = stubClient(() => ({ data: account }));
    await expect(
      createMastodonBackend(client).updateProfile({ location: "Berlin" }),
    ).rejects.toMatchObject({ code: "errors.unsupported.profileField" });
    await expect(
      createMastodonBackend(client).updateProfile({ birthday: "2000-01-01", followedMessage: "hi" }),
    ).rejects.toMatchObject({ code: "errors.unsupported.profileField" });
    expect(calls).toHaveLength(0);
  });

  it("avatar/banner refusal is unchanged (honestly unsupported)", async () => {
    const { client, calls } = stubClient(() => ({ data: account }));
    await expect(
      createMastodonBackend(client).updateProfile({ avatarId: "drive-id" }),
    ).rejects.toMatchObject({ code: "errors.unsupported.avatar" });
    expect(calls).toHaveLength(0);
  });
});

// --- MD7 --------------------------------------------------------------------

describe("MD7 — followRequests pages and verifies self once", () => {
  it("defaults to one 40-row Link page, honors an explicit cursor", async () => {
    const next = '<https://mastodon.example/api/v1/follow_requests?max_id=9>; rel="next"';
    const { client, calls } = stubClient((_m, path, body) => {
      if (path === "/api/v1/accounts/verify_credentials") return { data: account };
      if (String(path).includes("max_id=9")) return { data: [] };
      return { data: [account], headers: new Headers({ Link: next }) };
    });
    const backend = createMastodonBackend(client);
    const first = await backend.followRequests();
    expect(first).toEqual([{ id: account.id, follower: expect.objectContaining({ id: account.id }), followee: expect.objectContaining({ id: account.id }) }]);
    expect(calls[1]).toEqual({
      method: "GET",
      path: "/api/v1/follow_requests",
      body: { limit: 40 },
    });
    // The cursor threads the server's own next URL (fetchMore advances).
    // NOTE (MD7): the `Backend` interface in core/backend.ts still declares
    // the zero-arg form — the owning agent adds the optional `PageOpts`
    // there (interface freeze permits exactly that line). Until then this
    // exercises the implementation through a compat alias.
    const cursor = JSON.stringify({
      kind: "url",
      url: "https://mastodon.example/api/v1/follow_requests?max_id=9",
    });
    const followPaged = backend.followRequests as unknown as (
      opts?: PageOpts,
    ) => Promise<FollowRequest[]>;
    const second = await followPaged({ cursor: cursor as never });
    expect(second).toEqual([]);
    expect(calls[2].path).toContain("max_id=9");
  });

  it("verifies self once per handle, not once per call", async () => {
    let verifies = 0;
    const { client } = stubClient((method, path) => {
      if (path === "/api/v1/accounts/verify_credentials") {
        verifies += 1;
        return { data: account };
      }
      void method;
      return { data: [] };
    });
    const backend = createMastodonBackend(client);
    await backend.followRequests();
    await backend.followRequests();
    expect(verifies).toBe(1);
  });
});

// --- MD8 --------------------------------------------------------------------

describe("MD8 — account() falls back past a missing /lookup", () => {
  it("uses /lookup when the server has it (no fallback traffic)", async () => {
    const { client, calls } = stubClient(() => ({ data: account }));
    const found = await createMastodonBackend(client).account({ username: "gargron" });
    expect(calls.map((c) => c.path)).toEqual(["/api/v1/accounts/lookup"]);
    expect(found.id).toBe(account.id);
  });

  it("404 on /lookup → v1 search exact match (read:search is in the scope set)", async () => {
    const other = { ...account, id: "9", acct: "someone-else" };
    const { client, calls } = stubClient((_m, path) => {
      if (path === "/api/v1/accounts/lookup") throw httpError(404);
      return { data: [other, account] };
    });
    const found = await createMastodonBackend(client).account({ username: "gargron" });
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v1/accounts/lookup",
      "/api/v1/accounts/search",
    ]);
    // Exact acct wins — a near miss is never returned as the account.
    expect(found.id).toBe(account.id);
  });

  it("v1 search absent too → v2 search resolve; total miss reads 404", async () => {
    const { client, calls } = stubClient((_m, path) => {
      if (path === "/api/v1/accounts/lookup") throw httpError(404);
      if (path === "/api/v1/accounts/search") throw httpError(404);
      if (path === "/api/v2/search") {
        return { data: { accounts: [{ ...account, acct: "gargron@remote.example" }] } };
      }
      throw httpError(500);
    });
    const found = await createMastodonBackend(client).account({
      username: "gargron",
      host: "remote.example",
    });
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v1/accounts/lookup",
      "/api/v1/accounts/search",
      "/api/v2/search",
    ]);
    expect(found.id).toBe(account.id);

    const { client: missing } = stubClient((_m, path) => {
      if (path === "/api/v2/search") return { data: { accounts: [] } };
      throw httpError(404);
    });
    await expect(
      createMastodonBackend(missing).account({ username: "nobody-here" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("auth failures never fall back (a refused lookup is not 'not found')", async () => {
    const { client, calls } = stubClient((method, path) => {
      void method;
      void path;
      throw httpError(401);
    });
    await expect(
      createMastodonBackend(client).account({ username: "gargron" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(calls.map((c) => c.path)).toEqual(["/api/v1/accounts/lookup"]);
  });
});

// --- MD9 --------------------------------------------------------------------

describe("MD9 — scheduled.list fills the draft preview (same {post,draft} shape)", () => {
  it("adapts wire params + media_attachments into draft; bare rows stay null", async () => {
    const rows = fixture<Array<Record<string, unknown>>>("mastodon", "scheduled.json");
    const { client, calls } = stubClient(() => ({ data: rows }));
    const items = await createMastodonBackend(client).scheduled!.list();
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/scheduled_statuses",
      body: { limit: 20 },
    });
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("s1");
    expect(items[0].scheduledAt).toBe("2026-11-01T10:00:00.000Z");
    expect(items[0].post).toBeNull();
    const draft = items[0].draft as Record<string, unknown>;
    expect(draft.text).toBe("hello future");
    expect(draft.cw).toBe("cw here");
    expect(draft.visibility).toBe("unlisted");
    expect(draft.mediaIds).toEqual(["m1"]);
    expect(draft.media).toEqual([
      {
        id: "m1",
        kind: "image",
        url: "https://files.mastodon.example.com/media/m1.png",
        previewUrl: "https://files.mastodon.example.com/media/m1-small.png",
        description: "a cat",
      },
    ]);
    // A row with neither params nor media lists honestly with nulls.
    expect(items[1]).toEqual({
      id: "s2",
      scheduledAt: "2026-11-02T10:00:00.000Z",
      post: null,
      draft: null,
    });
  });
});

// --- MD10 -------------------------------------------------------------------

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

describe("MD10 — pooled streaming on the advertised origin", () => {
  it("dials the advertised streamingOrigin, not an assumed REST-host mapping", () => {
    const url = streamUrl(
      "https://mastodon.example",
      "user",
      {},
      "tok",
      "wss://streaming.mastodon.example",
    );
    expect(url).toBe(
      "wss://streaming.mastodon.example/api/v1/streaming?stream=user&access_token=tok",
    );
    // Without an advertised origin the session origin maps as before.
    expect(streamUrl("https://mastodon.example", "user", {}, "tok")).toBe(
      "wss://mastodon.example/api/v1/streaming?stream=user&access_token=tok",
    );
  });

  it("one socket per (stream, params): a second subscribe never closes the first", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle("https://mastodon.example", {
      token: "t",
      wsFactory: mockFactory(sockets),
    })!;
    const home: string[] = [];
    const local: string[] = [];
    const subHome = handle.subscribeTimeline({ kind: "home" }, (p) => home.push(p.id));
    const subLocal = handle.subscribeTimeline({ kind: "local" }, (p) => local.push(p.id));
    expect(sockets).toHaveLength(2);
    sockets[0].fireOpen();
    sockets[1].fireOpen();
    const body = { ...status, id: "p1" };
    sockets[0].fireFrame("update", JSON.stringify(body));
    expect(home).toEqual(["p1"]);
    expect(local).toEqual([]);
    // Unsubscribing home leaves the local socket untouched.
    subHome.unsubscribe();
    expect(sockets[0].closed).toBe(true);
    expect(sockets[1].closed).toBe(false);
    const body2 = { ...status, id: "p2" };
    sockets[1].fireFrame("update", JSON.stringify(body2));
    expect(local).toEqual(["p2"]);
    subLocal.unsubscribe();
    expect(sockets[1].closed).toBe(true);
  });

  it("subscribePost filters the shared user stream: update + delete hooks only", () => {
    const sockets: MockSocket[] = [];
    const handle = createStreamHandle("https://mastodon.example", {
      token: "t",
      wsFactory: mockFactory(sockets),
    })!;
    const updated: Array<{ id: string; type: string }> = [];
    let deleted = 0;
    const off = handle.subscribePost("p1", {
      onUpdated: (e) => updated.push(e),
      onDeleted: () => {
        deleted += 1;
      },
    });
    // One socket for the shared user stream (no per-post connection).
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("stream=user");
    sockets[0].fireOpen();
    sockets[0].fireFrame("status.update", JSON.stringify({ ...status, id: "p1" }));
    sockets[0].fireFrame("update", JSON.stringify({ ...status, id: "other" }));
    expect(updated).toEqual([{ id: "p1", type: "status.update" }]);
    sockets[0].fireFrame("delete", "p1");
    sockets[0].fireFrame("delete", "other");
    expect(deleted).toBe(1);
    off();
    expect(sockets[0].closed).toBe(true);
  });
});

// --- MD11 -------------------------------------------------------------------

describe("MD11 — fork collapse to mastodon; News stays vanilla-only", () => {
  it.each([
    ["GoToSocial", "4.2.0 (compatible; GoToSocial 0.17.4)"],
    ["glitch-soc", "4.2.0+glitch abc1234"],
    ["Hometown", "4.0.0+hometown-1.1.2"],
    ["mastodon marker", "4.3.0 (compatible; Mastodon 4.3.0)"],
  ])("version %s collapses to the mastodon family", (_label, version) => {
    expect(detectFamily(version, false, [], null)).toBe("mastodon");
  });

  it("a bare version with no marker or shape stays unknown (never guessed)", () => {
    expect(detectFamily("4.3.0", false, [], null)).toBe("unknown");
  });

  it("gotosocial NodeInfo name collapses; ambiguous evidence stays unknown", () => {
    expect(detectFamily(null, false, [], "gotosocial")).toBe("mastodon");
    expect(detectFamily(null, false, [], null)).toBe("unknown");
    // Akkoma/pleroma markers still win over the mastodon collapse.
    expect(detectFamily("4.2.0 (compatible; Akkoma 3.20.1)", true, [], null)).toBe("akkoma");
  });

  it("explore.news exists only on flavor mastodon (GTS would 404 it)", async () => {
    const { client } = stubClient(() => ({ data: [] }));
    expect(typeof createMastodonBackend(client, { flavor: "mastodon" }).explore!.news).toBe(
      "function",
    );
    for (const flavor of ["akkoma", "pleroma", "unknown"] as const) {
      expect(createMastodonBackend(client, { flavor }).explore!.news).toBeUndefined();
    }
  });
});

// --- MD12 -------------------------------------------------------------------

describe("MD12 — direct throws adapt so the shared predicates read them", () => {
  it("toApiError turns a MastoHttpError into a shared ApiError", () => {
    const adapted = toApiError(httpError(404));
    expect(adapted).toBeInstanceOf(ApiError);
    expect(isUnsupportedError(adapted)).toBe(true);
    expect(isUnsupportedError(httpError(404))).toBe(false);
    expect(isPermissionError(toApiError(httpError(403)))).toBe(true);
    // Non-transport values pass through untouched.
    const plain = new Error("boom");
    expect(toApiError(plain)).toBe(plain);
  });

  it("backend failures arrive adapted (guarded boundary)", async () => {
    const { client } = stubClient(() => {
      throw httpError(405);
    });
    await expect(createMastodonBackend(client).post("x")).rejects.toMatchObject({
      status: 405,
    });
    const err = await createMastodonBackend(client).post("x").catch((e: unknown) => e);
    expect(isUnsupportedError(err)).toBe(true);
  });

  it("a real grouped-v2 envelope adapts in place (no v1 call)", async () => {
    // WS-F (V2_GAPS MD1): the grouped envelope is no longer "unreadable"
    // — it adapts to grouped rows directly. The error boundary itself is
    // unchanged: real transport errors still arrive as shared ApiErrors
    // (pinned by the tests above).
    const grouped = fixture<Record<string, unknown>>("mastodon", "notification-grouped-v2.json");
    const { client, calls } = stubClient(() => ({ data: grouped }));
    const page = await createMastodonBackend(client).notifications();
    expect(calls.map((c) => c.path)).toEqual(["/api/v2/notifications"]);
    expect(page.items[0].kind).toBe("favourite");
    expect(page.items[0].actors).toHaveLength(3);
  });
});

// --- MD14 -------------------------------------------------------------------

describe("MD14 — thread cycles terminate; quotes match strictly", () => {
  const base = adaptStatus(status);

  it("mutual and self ancestor cycles stop at the visited guard", () => {
    const root = { ...base, id: "root", replyToId: "a" };
    const a = { ...base, id: "a", replyToId: "b" };
    const b = { ...base, id: "b", replyToId: "a" }; // mutual cycle
    const { chain } = rebuildThread(root, [a, b], []);
    expect(chain.map((p) => p.id)).toEqual(["b", "a"]); // oldest-first, no loop

    const self = { ...base, id: "s", replyToId: "s" }; // self cycle
    const root2 = { ...base, id: "root2", replyToId: "s" };
    const cycled = rebuildThread(root2, [self], []);
    expect(cycled.chain.map((p) => p.id)).toEqual(["s"]);
  });

  it("pickQuotedStatus matches exactly and nothing else (strict)", () => {
    const target = { ...base, uri: "https://remote.example/objects/1", url: null };
    expect(pickQuotedStatus([target], "https://remote.example/objects/1")).toBe(target);
    // Strict: a trailing slash is a different path, never a fuzzy match.
    expect(pickQuotedStatus([target], "https://remote.example/objects/1/")).toBeNull();
    expect(pickQuotedStatus([target], "https://remote.example/objects/2")).toBeNull();
  });
});

describe("MD14 — presentation: reblog collapse and fold budget", () => {
  const base = adaptStatus(status);

  it("pure boosts absorb into the original; impure wrappers keep their row", () => {
    const original = { ...base, id: "o" };
    const boost = {
      ...base,
      id: "w1",
      content: { html: undefined, plain: "" },
      cw: null,
      media: [],
      poll: null,
      quote: null,
      quoteUnavailable: false,
      card: null,
      renote: original,
    };
    const rows = collapseReblogs([boost, original]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status.id).toBe("o");
    expect(rows[0].totalBoosters).toBe(1);
  });

  it("foldTree cuts past the budget with an ellipsis and reports folded", () => {
    const long = foldTree([{ kind: "text", text: "a".repeat(800) }]);
    expect(long.folded).toBe(true);
    expect(long.nodes).toHaveLength(1);
    expect(long.nodes[0]).toEqual({ kind: "text", text: `${"a".repeat(750)}…` });
    const short = foldTree([{ kind: "text", text: "hi" }]);
    expect(short.folded).toBe(false);
  });
});

describe("MD14 — bookmarks, lists, filters, uploadMedia paths", () => {
  it("bookmark add/remove hit the status verbs; lists timeline pages Link-style", async () => {
    const listRow = fixture<{ id: string; title: string }>("mastodon", "list.json");
    const { client, calls } = stubClient((_m, path) => {
      if (path === "/api/v1/lists") return { data: [listRow] };
      return { data: [status] };
    });
    const backend = createMastodonBackend(client);
    await backend.bookmarks!.add("s1");
    await backend.bookmarks!.remove("s1");
    const lists = await backend.lists!.list();
    expect(lists).toEqual([{ id: "l1", name: "news" }]);
    const page = await backend.lists!.timeline("l1");
    expect(page.items[0].id).toBe(status.id);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/v1/statuses/s1/bookmark",
      "POST /api/v1/statuses/s1/unbookmark",
      "GET /api/v1/lists",
      "GET /api/v1/timelines/list/l1",
    ]);
  });

  it("uploadMedia polls the processing fixture once, then adapts honestly", async () => {
    const processing = fixture<Record<string, unknown>>("mastodon", "media-processing.json");
    const done = {
      ...processing,
      url: "https://files.mastodon.example.com/media/m1.png",
      preview_url: "https://files.mastodon.example.com/media/m1-small.png",
    };
    const { client, calls } = stubClient((_m, path) => {
      if (path === "/api/v2/media") return { data: processing };
      return { data: done };
    });
    const media = await createMastodonBackend(client).uploadMedia(
      new File(["x"], "x.png", { type: "image/png" }),
      { isSensitive: true },
    );
    expect(media.id).toBe("200");
    expect(media.url).toBe("https://files.mastodon.example.com/media/m1.png");
    expect(media.isSensitive).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/api/v2/media", "/api/v1/media/200"]);
  });

  it("filters list the v2 fixture row honestly", async () => {
    const v2row = fixture<Record<string, unknown>>("mastodon", "filter-v2.json");
    const { client } = stubClient(() => ({ data: [v2row] }));
    const rows = await createMastodonBackend(client).filters!.list();
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
});
