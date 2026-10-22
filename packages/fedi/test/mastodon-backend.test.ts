// MastodonBackend — stub-transport wire-param pinning (the mirror of
// test/misskey-backend.test.ts). No network, no backends: the client is
// stubbed and every request is asserted against the contract
// (docs/mastoapi-contract.md §4/§5). Core discipline pinned here:
// - Link continuations hide behind the opaque core Cursor; end-of-feed =
//   no next link or empty page, never length<limit (§5);
// - favourites never merge into reactions; `accountReactions` answers
//   the honest unsupported state (keystodon.md §1.5);
// - absent features throw typed 404 ApiErrors (the UI's "not on this
//   server" states), never silent success;
// - every transport error arrives as ApiError with its HTTP status.

// Jest port: `describe/it/expect` are globals (no vitest import).
import { createMastodonBackend, toApiError } from "../src/mastodon/backend";
import { searchV2 } from "../src/mastodon/endpoints";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import { MastoHttpError } from "../src/mastodon/client";
import { decodeContinuation } from "../src/mastodon/adapt";
import { ApiError } from "../src/core/errors";
import type { PostDraft } from "../src/core/backend";
import type { Account, Status } from "../src/mastodon/wire";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function fixture<T>(flavor: string, name: string): T {
  const raw = readFileSync(join(__dirname, "fixtures", flavor, name), "utf8");
  return JSON.parse(raw) as T;
}

const status = fixture<Status>("mastodon", "status.json");
const akkomaStatus = fixture<Status>("akkoma", "status.json");
const account = fixture<Account>("mastodon", "account.json");

interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
}

interface StubOptions {
  respond?: (method: string, path: string, body?: unknown) => { data?: unknown; headers?: Headers };
  link?: string | null;
}

function stubClient(opts: StubOptions = {}): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const respond = (
    method: string,
    path: string,
    body?: unknown,
  ): RequestResult<never> => {
    calls.push({ method, path, body });
    const custom = opts.respond?.(method, path, body);
    return {
      status: 200,
      data: custom?.data as never,
      headers: custom?.headers ?? new Headers(opts.link ? { Link: opts.link } : {}),
    };
  };
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token: "t",
    // GET records its query in the body slot (the params under test).
    get: (path, query, _o) => Promise.resolve(respond("GET", path, query)),
    post: (path, body, _o) => Promise.resolve(respond("POST", path, body)),
    put: (path, body, _o) => Promise.resolve(respond("PUT", path, body)),
    patch: (path, body, _o) => Promise.resolve(respond("PATCH", path, body)),
    delete: (path, body, _o) => Promise.resolve(respond("DELETE", path, body)),
    postForm: (path, body, _o) => Promise.resolve(respond("POST", path, body)),
    postFormData: (path, body, _o) => Promise.resolve(respond("POST", path, body)),
  };
  return { client, calls };
}

/** A stub that answers Status-shaped reads with the fixture. */
function statusStub(items: Status[], link?: string) {
  return stubClient({
    link: link ?? null,
    respond: (method, path) => {
      void method;
      if (/\/context$/.test(path)) return { data: { ancestors: [], descendants: items } };
      if (
        path === "/api/v2/media" ||
        (path.startsWith("/api/v1/statuses") && !path.endsWith("/votes"))
      ) {
        return { data: items[0] };
      }
      return { data: items };
    },
  });
}

describe("MastodonBackend feeds (contract §4 paths, §5 paging)", () => {
  it("maps timeline kinds to the Mastodon feed endpoints", async () => {
    const { client, calls } = statusStub([status]);
    const backend = createMastodonBackend(client);
    await backend.timeline("home");
    await backend.timeline("local");
    await backend.timeline("global");
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v1/timelines/home",
      "/api/v1/timelines/public",
      "/api/v1/timelines/public",
    ]);
  });

  it("end = no next link; a next Link continues behind the opaque Cursor", async () => {
    const link =
      '<https://mastodon.example/api/v1/timelines/home?max_id=99>; rel="next"';
    const { client } = statusStub([status], link);
    const backend = createMastodonBackend(client);
    const page = await backend.timeline("home", { limit: 20 });
    expect(page.end).toBe(false);
    expect(page.items[0].id).toBe(status.id);
    const cont = decodeContinuation(page.cursor);
    expect(cont?.kind).toBe("url");
    expect(cont && cont.kind === "url" && cont.url).toContain("max_id=99");

    // Following it pages from the server's own next URL.
    const second = await backend.timeline("home", { cursor: page.cursor });
    expect(second.items[0].id).toBe(status.id);
  });

  it("an empty page is the end even with a next link (contract §5)", async () => {
    const link = '<https://mastodon.example/api/v1/timelines/home?max_id=99>; rel="next"';
    const { client } = statusStub([], link);
    const page = await createMastodonBackend(client).timeline("home");
    expect(page.end).toBe(true);
  });

  it("a single-item page with a next link is NOT the end (never length<limit)", async () => {
    const link = '<https://mastodon.example/api/v1/timelines/home?max_id=99>; rel="next"';
    const { client } = statusStub([status], link);
    const page = await createMastodonBackend(client).timeline("home", { limit: 20 });
    expect(page.end).toBe(false);
    expect(page.items).toHaveLength(1);
  });

  it("post() adapts the single-status read", async () => {
    const { client, calls } = statusStub([status]);
    const post = await createMastodonBackend(client).post("113959271829458642");
    expect(calls[0].path).toBe("/api/v1/statuses/113959271829458642");
    expect(post.id).toBe(status.id);
    expect(post.content.html).toContain("Hello");
  });

  it("thread() rebuilds the chain from the flat context (contract §4)", async () => {
    const root = { ...status, in_reply_to_id: "parent1" };
    const parent = { ...status, id: "parent1", in_reply_to_id: "root1" };
    const grand = { ...status, id: "root1", in_reply_to_id: null };
    const reply = { ...status, id: "child1", in_reply_to_id: root.id };
    const { client } = stubClient({
      respond: (method, path) => {
        void method;
        if (/\/context$/.test(path)) {
          return { data: { ancestors: [grand, parent], descendants: [reply] } };
        }
        return { data: root };
      },
    });
    const post = await createMastodonBackend(client).post(root.id);
    const thread = await createMastodonBackend(client).thread(post);
    expect(thread.ancestors.map((p) => p.id)).toEqual(["root1", "parent1"]); // oldest-first
    expect(thread.incomplete).toBe(false);
    expect(post.renote).toBeNull();
  });

  it("thread() reports an incomplete chain when a parent is missing", async () => {
    const root = { ...status, in_reply_to_id: "gone" };
    const { client } = stubClient({
      respond: (method, path) => {
        void method;
        if (/\/context$/.test(path)) return { data: { ancestors: [], descendants: [] } };
        return { data: root };
      },
    });
    const post = await createMastodonBackend(client).post(root.id);
    const thread = await createMastodonBackend(client).thread(post);
    expect(thread.ancestors).toEqual([]);
    expect(thread.incomplete).toBe(true);
  });

  it("threadReplies() is the direct children of one post", async () => {
    const root = { ...status, id: "root" };
    const child = { ...status, id: "child", in_reply_to_id: "root" };
    const deep = { ...status, id: "deep", in_reply_to_id: "child" };
    const other = { ...status, id: "other", in_reply_to_id: null };
    const { client } = stubClient({
      respond: (method, path) => {
        void method;
        if (/\/context$/.test(path)) {
          return { data: { ancestors: [], descendants: [child, deep, other] } };
        }
        return { data: root };
      },
    });
    const page = await createMastodonBackend(client).threadReplies("root");
    expect(page.items.map((p) => p.id)).toEqual(["child"]);
    expect(page.end).toBe(true);
  });
});

describe("MastodonBackend compose (contract §7 field map)", () => {
  it("builds the create body from a core draft — raw visibility round-trips", async () => {
    const { client, calls } = statusStub([status]);
    const backend = createMastodonBackend(client);
    const draft: PostDraft = {
      text: "  hello  ",
      cw: "cw here",
      visibility: { kind: "quiet", localOnly: true, raw: "local" },
      replyId: "p1",
      renoteId: "q1",
      mediaIds: ["m1"],
      poll: { choices: ["a", "b"], multiple: true, expiredAfter: 300 },
    };
    await backend.createPost(draft);
    const body = calls[0].body as Record<string, unknown>;
    expect(calls[0].path).toBe("/api/v1/statuses");
    expect(body.status).toBe("hello");
    expect(body.spoiler_text).toBe("cw here");
    // `raw` is written back verbatim (plan §2.1): a local post stays local.
    expect(body.visibility).toBe("local");
    expect(body.in_reply_to_id).toBe("p1");
    expect(body.quoted_status_id).toBe("q1");
    expect(body.media_ids).toEqual(["m1"]);
    expect(body.poll).toEqual({ options: ["a", "b"], multiple: true, expires_in: 300 });
  });

  it("maps kinds to wire visibilities when no raw rides along", async () => {
    const { client, calls } = statusStub([status]);
    const backend = createMastodonBackend(client);
    await backend.createPost({ text: "x", visibility: { kind: "followers", localOnly: false } });
    await backend.createPost({ text: "x", visibility: { kind: "direct", localOnly: false } });
    await backend.createPost({ text: "x", visibility: { kind: "public", localOnly: false } });
    expect(calls.map((c) => (c.body as Record<string, unknown>).visibility)).toEqual([
      "private",
      "direct",
      "public",
    ]);
  });

  it("editPost writes the same body shape back", async () => {
    const { client, calls } = statusStub([status]);
    await createMastodonBackend(client).editPost("s1", {
      text: "edited",
      visibility: { kind: "quiet", localOnly: true, raw: "local" },
    });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].path).toBe("/api/v1/statuses/s1");
    expect((calls[0].body as Record<string, unknown>).visibility).toBe("local");
  });

  it("deletePost deletes; boost/unboost use the reblog verbs", async () => {
    const { client, calls } = statusStub([status]);
    const backend = createMastodonBackend(client);
    await backend.deletePost("s1");
    await backend.boost("s1");
    await backend.unboost("s1");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "DELETE /api/v1/statuses/s1",
      "POST /api/v1/statuses/s1/reblog",
      "POST /api/v1/statuses/s1/unreblog",
    ]);
  });
});

describe("MastodonBackend toggles and reactions (never merged)", () => {
  it("favourite/unfavourite hit the favourite verbs", async () => {
    const { client, calls } = statusStub([status]);
    const backend = createMastodonBackend(client);
    await backend.favourite("s1");
    await backend.unfavourite("s1");
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v1/statuses/s1/favourite",
      "/api/v1/statuses/s1/unfavourite",
    ]);
  });

  it("react/unreact use the Pleroma extension paths (contract §9)", async () => {
    const { client, calls } = statusStub([akkomaStatus]);
    const backend = createMastodonBackend(client);
    await backend.react("s1", "🎉");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].path).toBe("/api/v1/pleroma/statuses/s1/reactions/%F0%9F%8E%89");
    await backend.unreact("s1");
    // unreact clears the caller's current set (the fixture: 🎉 is mine).
    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes.map((c) => c.path)).toEqual([
      "/api/v1/pleroma/statuses/s1/reactions/%F0%9F%8E%89",
    ]);
  });

  it("accountReactions is honestly unsupported — favourites are never reactions", async () => {
    const { client, calls } = statusStub([status]);
    await expect(createMastodonBackend(client).accountReactions("u1")).rejects.toThrow(
      /not available/i,
    );
    expect(calls).toHaveLength(0);
  });

  it("featuredPosts is honestly unsupported (no MastoAPI equivalent)", async () => {
    const { client, calls } = statusStub([status]);
    await expect(createMastodonBackend(client).featuredPosts()).rejects.toThrow(
      /not available/i,
    );
    expect(calls).toHaveLength(0);
  });

  it("accountFeaturedPosts is pinned-listings only on Akkoma/Pleroma", async () => {
    const vanilla = statusStub([status]);
    await expect(
      createMastodonBackend(vanilla.client, { flavor: "mastodon" }).accountFeaturedPosts("u1"),
    ).rejects.toThrow(/not available/i);
    expect(vanilla.calls).toHaveLength(0);

    const akkoma = statusStub([akkomaStatus]);
    const page = await createMastodonBackend(akkoma.client, {
      flavor: "akkoma",
    }).accountFeaturedPosts("u1");
    expect(akkoma.calls[0].path).toBe("/api/v1/accounts/u1/statuses");
    expect(page.items[0].id).toBe(akkomaStatus.id);
  });
});

describe("MastodonBackend accounts", () => {
  it("account() reads by id and looks up by handle (contract §4 lookup)", async () => {
    const { client, calls } = stubClient({
      respond: () => ({ data: account }),
    });
    const backend = createMastodonBackend(client);
    await backend.account({ id: "1" });
    await backend.account({ username: "bob", host: "remote.example" });
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v1/accounts/1",
      "/api/v1/accounts/lookup",
    ]);
  });

  it("accountPosts maps the core options to the wire filters", async () => {
    const { client, calls } = statusStub([status]);
    const backend = createMastodonBackend(client);
    await backend.accountPosts("1", { withReplies: false, withRenotes: false });
    await backend.accountPosts("1", { withFiles: true });
    // "All" (profile tab A1) = replies + boosts: Mastodon's default, so the
    // request carries neither exclude_* filter and no only_media.
    await backend.accountPosts("1", { withReplies: true, withRenotes: true });
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v1/accounts/1/statuses",
      "/api/v1/accounts/1/statuses",
      "/api/v1/accounts/1/statuses",
    ]);
    expect(calls[0].body).toEqual({
      exclude_replies: true,
      exclude_reblogs: true,
      limit: 20,
    });
    expect(calls[1].body).toEqual({
      only_media: true,
      limit: 20,
    });
    expect(calls[2].body).toEqual({ limit: 20 });
  });

  it("follow/unfollow/mute/block hit the account verbs", async () => {
    const { client, calls } = statusStub([status]);
    const backend = createMastodonBackend(client);
    await backend.follow("1");
    await backend.unfollow("1");
    await backend.mute("1");
    await backend.unmute("1");
    await backend.block("1");
    await backend.unblock("1");
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v1/accounts/1/follow",
      "/api/v1/accounts/1/unfollow",
      "/api/v1/accounts/1/mute",
      "/api/v1/accounts/1/unmute",
      "/api/v1/accounts/1/block",
      "/api/v1/accounts/1/unblock",
    ]);
  });

  it("muteThread + report hit their endpoints (note-menu items)", async () => {
    const { client, calls } = statusStub([status]);
    const backend = createMastodonBackend(client);
    await backend.muteThread("s1");
    await backend.reportAccount("u1", "spam");
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v1/statuses/s1/mute",
      "/api/v1/reports",
    ]);
    expect(calls[1].body).toEqual({ account_id: "u1", comment: "spam" });
  });

  it("relationships adapts the wire rows (absent flags stay absent)", async () => {
    const rel = fixture<import("../src/mastodon/wire").Relationship>(
      "mastodon",
      "relationship.json",
    );
    const { client } = stubClient({ respond: () => ({ data: [rel] }) });
    const rows = await createMastodonBackend(client).relationships(["2"]);
    expect(rows[0].isFollowing).toBe(true);
    expect(rows[0].hasPendingFollowRequestToYou).toBe(true);
  });
});

describe("MastodonBackend notifications", () => {
  it("maps the core filter tokens to wire types (contract §6 sets)", async () => {
    const { client, calls } = stubClient({ respond: () => ({ data: [] }) });
    await createMastodonBackend(client).notifications({
      includeTypes: ["reaction", "renote", "follow", "receiveFollowRequest", "pollEnded"],
    });
    const query = calls[1].body as Record<string, unknown>;
    expect(calls[0].path).toBe("/api/v2/notifications");
    expect(calls[1].path).toBe("/api/v1/notifications");
    // favourite + emoji reactions fold into the "Reactions" FILTER (a
    // filter, never a model merge); poll → poll; follow_request maps.
    expect(query.types).toEqual([
      "favourite",
      "pleroma:emoji_reaction",
      "reblog",
      "follow",
      "follow_request",
      "poll",
    ]);
  });

  it("adapts flat rows and keeps favourite distinct from reaction", async () => {
    const fav = fixture<import("../src/mastodon/wire").Notification>(
      "mastodon",
      "notification.json",
    );
    const { client } = stubClient({ respond: () => ({ data: [fav] }) });
    const page = await createMastodonBackend(client).notifications();
    expect(page.items[0].kind).toBe("favourite");
    expect(page.items[0].reaction).toBeNull();
  });

  it("markNotificationsRead posts the notifications marker (no v1 mark-read)", async () => {
    const fav = fixture<import("../src/mastodon/wire").Notification>(
      "mastodon",
      "notification.json",
    );
    const { client, calls } = stubClient({ respond: () => ({ data: [fav] }) });
    await createMastodonBackend(client).markNotificationsRead();
    const marker = calls.find((c) => c.path === "/api/v1/markers");
    expect(marker?.body).toEqual({ notifications: { last_read_id: fav.id } });
  });

  // clickstone §1.11 — dismiss/clear exist on Mastodon AND Akkoma
  // (contract §4 "Dismiss/clear notif."), so both are implemented; the id
  // is opaque and encoded, and the calls carry no body.
  it("dismissNotification posts /notifications/:id/dismiss with an encoded id", async () => {
    const { client, calls } = stubClient({ respond: () => ({ data: {} }) });
    await createMastodonBackend(client).dismissNotification!("a/b c");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/notifications/a%2Fb%20c/dismiss");
    expect(calls[0].body).toBeUndefined();
  });

  it("clearNotifications posts /notifications/clear with no body", async () => {
    const { client, calls } = stubClient({ respond: () => ({ data: {} }) });
    await createMastodonBackend(client).clearNotifications!();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/notifications/clear");
    expect(calls[0].body).toBeUndefined();
  });

  it("keeps a 404 on dismiss as the typed unsupported error (never silent success)", async () => {
    const { client } = stubClient({
      respond: () => {
        throw new MastoHttpError({
          message: "Not Found",
          status: 404,
          kind: "http",
          origin: "https://mastodon.example",
        });
      },
    });
    const backend = createMastodonBackend(client);
    await expect(backend.dismissNotification!("n1")).rejects.toMatchObject({ status: 404 });
    await expect(backend.clearNotifications!()).rejects.toMatchObject({ status: 404 });
  });

  it("answers an EMPTY page, not every row, when a preset kind has no wire type", async () => {
    // The Misskey system kinds have no Mastodon equivalent. Sending an
    // empty `types[]` would drop the filter and return everything — the
    // honest answer is an empty page with no request at all.
    const { client, calls } = stubClient({ respond: () => ({ data: [] }) });
    const page = await createMastodonBackend(client).notifications({
      includeTypes: ["exportCompleted", "roleAssigned"],
    });
    expect(page).toEqual({ items: [], cursor: null, end: true });
    expect(calls).toHaveLength(0);
  });
});

describe("MastodonBackend services and error boundary", () => {
  it("customEmojis maps shortcode → name", async () => {
    const { client } = stubClient({
      respond: () => ({
        data: [{ shortcode: "keystone", url: "https://x/keystone.png", category: "test" }],
      }),
    });
    const emojis = await createMastodonBackend(client).customEmojis();
    expect(emojis).toEqual([{ name: "keystone", url: "https://x/keystone.png", category: "test" }]);
  });

  it("translate maps the varied response shapes to core Translation", async () => {
    const { client } = stubClient({
      respond: () => ({
        data: {
          detected_source_language: "de",
          provider: "DeepL",
          content: "<p>Hallo Welt</p>",
        },
      }),
    });
    const t = await createMastodonBackend(client).translate("s1", "en");
    expect(t.sourceLang).toBe("de");
    expect(t.text).toBe("Hallo Welt");
  });

  it("every transport error arrives as ApiError with its status", async () => {
    const client = stubClient().client;
    const failing: MastoClient = {
      ...client,
      get: () =>
        Promise.reject(
          new MastoHttpError({
            message: "gone",
            status: 404,
            kind: "http",
            origin: "https://mastodon.example",
            path: "/x",
          }),
        ),
    };
    await expect(createMastodonBackend(failing).post("x")).rejects.toBeInstanceOf(ApiError);
    await expect(createMastodonBackend(failing).post("x")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("a timeout keeps kind timeout — never 'endpoint unsupported'", () => {
    const err = toApiError(
      new MastoHttpError({
        message: "timed out",
        kind: "timeout",
        origin: "https://mastodon.example",
        path: "/x",
      }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).kind).toBe("timeout");
  });

  it("stream() binds the session origin (WebSocket design); null only with no WebSocket", () => {
    // Feeds keep refresh + paging whenever streaming is unavailable.
    const RealWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
    try {
      expect(createMastodonBackend(stubClient().client).stream()).toBeNull();
    } finally {
      if (RealWebSocket !== undefined) {
        (globalThis as { WebSocket?: unknown }).WebSocket = RealWebSocket;
      }
    }
    // With a WebSocket implementation present, the backend hands out a
    // live handle bound to the session origin (protocol pinned in
    // mastodon-stream.test.ts with a mock socket).
    expect(createMastodonBackend(stubClient().client).stream()).not.toBeNull();
  });

  it("resolveQuoteUri resolves through /api/v2/search and matches strictly", async () => {
    const target = { ...status, id: "q1", uri: "https://remote.example/objects/q1", url: null };
    const other = { ...status, id: "q2", uri: "https://remote.example/objects/q2", url: null };
    const { client, calls } = stubClient({
      respond: () => ({ data: { statuses: [other, target] } }),
    });
    const found = await createMastodonBackend(client).resolveQuoteUri(
      "https://remote.example/objects/q1",
    );
    expect(calls[0].path).toBe("/api/v2/search");
    expect(found?.id).toBe("q1");
    // A URI nothing matches resolves null (the caller keeps the RE: text).
    const miss = await createMastodonBackend(client).resolveQuoteUri(
      "https://remote.example/objects/zzz",
    );
    expect(miss).toBeNull();
  });
});

describe("MastodonBackend explore", () => {
  it("tags() reads trends/tags with weekly sums", async () => {
    const { client, calls } = stubClient({
      respond: (_m, path) => {
        if (path === "/api/v1/trends/tags") {
          return {
            data: [
              { name: "cats", history: [{ day: "1", uses: "13", accounts: "10" }] },
              { name: "", history: [] },
            ],
          };
        }
        return {};
      },
    });
    const res = await createMastodonBackend(client, { flavor: "mastodon" }).explore!.tags();
    expect(calls[0]).toEqual({ method: "GET", path: "/api/v1/trends/tags", body: { limit: 10 } });
    expect(res).toEqual([{ name: "cats", users: 10, uses: 13 }]);
  });

  it("posts() reads trends/statuses with offset paging", async () => {
    const { client, calls } = stubClient({
      respond: (_m, path, body) => {
        if (path !== "/api/v1/trends/statuses") return {};
        const offset = (body as { offset?: number })?.offset ?? 0;
        return { data: offset >= 1 ? [] : [status] };
      },
    });
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    const first = await backend.explore!.posts({ limit: 20 });
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/trends/statuses",
      body: { limit: 20, offset: 0 },
    });
    expect(first.items[0].id).toBe(status.id);
    expect(first.cursor).toBe("1");
    expect(first.end).toBe(false);
    const empty = await backend.explore!.posts({ limit: 20, cursor: "1" as never });
    expect(empty.end).toBe(true);
    expect(empty.cursor).toBeNull();
  });

  it("users() reads v2 suggestions", async () => {
    const { client, calls } = stubClient({
      respond: (_m, path) =>
        path === "/api/v2/suggestions" ? { data: [{ source: "staff", account }] } : {},
    });
    const res = await createMastodonBackend(client, { flavor: "mastodon" }).explore!.users();
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v2/suggestions",
      body: { limit: 10 },
    });
    expect(res).toEqual({ pinned: [], suggested: [expect.objectContaining({ id: account.id })] });
  });

  it("news exists only on the vanilla-mastodon backend", async () => {
    const { client } = stubClient({
      respond: (_m, path) =>
        path === "/api/v1/trends/links"
          ? { data: [{ url: "https://x/y", title: "Y", description: "d" }] }
          : {},
    });
    const mastodon = createMastodonBackend(client, { flavor: "mastodon" });
    expect(typeof mastodon.explore!.news).toBe("function");
    const page = await mastodon.explore!.news!({ limit: 10 });
    expect(page.items).toEqual([
      { url: "https://x/y", title: "Y", description: "d", providerName: null, image: null },
    ]);
    for (const flavor of ["akkoma", "pleroma", "unknown"] as const) {
      const other = createMastodonBackend(client, { flavor });
      expect(other.explore!.news).toBeUndefined();
    }
  });

  it("suggest passes the v2 type filter", async () => {
    const { client, calls } = stubClient({
      respond: () => ({ data: { accounts: [account], statuses: [], hashtags: [{ name: "cats" }] } }),
    });
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    await backend.search.suggestTags!("cat");
    expect(calls[calls.length - 1]).toEqual({
      method: "GET",
      path: "/api/v2/search",
      body: { q: "cat", type: "hashtags", limit: 8 },
    });
    await backend.search.suggestAccounts!("ann");
    expect(calls[calls.length - 1]).toEqual({
      method: "GET",
      path: "/api/v2/search",
      body: { q: "ann", type: "accounts", limit: 8 },
    });
  });
});

// Wave 0 slice 0.2 — search is not one page. v2 search pages by `offset`
// (+`limit`, and only when `type` is set upstream) and its Link header is
// the ONLY source of a cursor: a page without `rel="next"` ends the feed,
// and nothing is fabricated from item counts (contract §5).
describe("MastodonBackend search paging (contract §5 Link cursors)", () => {
  const statusNext =
    "https://mastodon.example/api/v2/search?q=cats&type=statuses&offset=20&limit=20";
  const accountNext =
    "https://mastodon.example/api/v2/search?q=ann&type=accounts&offset=20&limit=20";

  it("search.posts follows rel=next instead of ending on page 1", async () => {
    const { client, calls } = stubClient({
      respond: (_m, path) => {
        // First page: typed search + a next link. Replayed next URL:
        // one older status and no link (the end).
        if (path === "/api/v2/search") {
          return {
            data: { statuses: [status] },
            headers: new Headers({ Link: `<${statusNext}>; rel="next"` }),
          };
        }
        return { data: { statuses: [{ ...status, id: "older1" }] } };
      },
    });
    const backend = createMastodonBackend(client);

    const first = await backend.search.posts("cats", { limit: 20 });
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v2/search",
      body: { q: "cats", type: "statuses", limit: 20 },
    });
    expect(first.end).toBe(false);
    expect(first.cursor).not.toBeNull();
    expect(decodeContinuation(first.cursor)).toEqual({ kind: "url", url: statusNext });

    const second = await backend.search.posts("cats", { cursor: first.cursor });
    // The server's exact next URL carries q/type/offset — replayed
    // verbatim, no duplicated params.
    expect(calls[1]).toEqual({ method: "GET", path: statusNext, body: {} });
    expect(calls[1].path).toContain("offset=20");
    expect(second.items.map((p) => p.id)).toEqual(["older1"]);
    expect(second.end).toBe(true);
    expect(second.cursor).toBeNull();
  });

  it("search.accounts pages by offset too and ends without rel=next", async () => {
    const { client, calls } = stubClient({
      respond: (_m, path) => {
        if (path === "/api/v2/search") {
          return {
            data: { accounts: [account] },
            headers: new Headers({ Link: `<${accountNext}>; rel="next"` }),
          };
        }
        return { data: { accounts: [{ ...account, id: "acc2" }] } };
      },
    });
    const backend = createMastodonBackend(client);
    const first = await backend.search.accounts("ann", { limit: 20 });
    expect(calls[0].body).toEqual({ q: "ann", type: "accounts", limit: 20 });
    expect(first.end).toBe(false);
    expect(decodeContinuation(first.cursor)).toEqual({ kind: "url", url: accountNext });

    const second = await backend.search.accounts("ann", { cursor: first.cursor });
    expect(calls[1]).toEqual({ method: "GET", path: accountNext, body: {} });
    expect(second.items.map((a) => a.id)).toEqual(["acc2"]);
    expect(second.end).toBe(true);
    expect(second.cursor).toBeNull();
  });

  it("a cross-origin next Link carries its offset cursor onto the session origin", async () => {
    // A proxy/base-url mismatch: the advertised URL leaves the session
    // origin, so only the cursor PARAMS are carried over — the token
    // never leaves the origin.
    const foreign =
      "https://elsewhere.example/api/v2/search?q=cats&type=statuses&offset=20&limit=20";
    const { client, calls } = stubClient({
      respond: (_m, path) =>
        path === "/api/v2/search"
          ? { data: { statuses: [status] }, headers: new Headers({ Link: `<${foreign}>; rel="next"` }) }
          : { data: { statuses: [] } },
    });
    const backend = createMastodonBackend(client);
    const first = await backend.search.posts("cats", { limit: 20 });
    expect(first.end).toBe(false);
    expect(decodeContinuation(first.cursor)).toEqual({
      kind: "cursors",
      cursors: { offset: 20, limit: 20 },
    });

    await backend.search.posts("cats", { cursor: first.cursor });
    expect(calls[1]).toEqual({
      method: "GET",
      path: "/api/v2/search",
      body: { q: "cats", type: "statuses", offset: 20, limit: 20 },
    });
  });

  it("a page without any Link is the end — no cursor is invented", async () => {
    const { client } = stubClient({
      respond: () => ({ data: { statuses: [status] } }),
    });
    const page = await createMastodonBackend(client).search.posts("cats", { limit: 1 });
    // A FULL page without a next link is still the end (never length<limit).
    expect(page.items).toHaveLength(1);
    expect(page.cursor).toBeNull();
    expect(page.end).toBe(true);
  });

  it("a next link on an empty page still ends (contract §5)", async () => {
    const { client } = stubClient({
      respond: () => ({
        data: { statuses: [] },
        headers: new Headers({ Link: `<${statusNext}>; rel="next"` }),
      }),
    });
    const page = await createMastodonBackend(client).search.posts("cats");
    expect(page.end).toBe(true);
  });

  it("searchV2 exposes the Link-derived prev plan (back-paging)", async () => {
    const prevUrl =
      "https://mastodon.example/api/v2/search?q=ann&type=accounts&offset=0&limit=20";
    const { client } = stubClient({
      respond: () => ({
        data: { accounts: [account] },
        headers: new Headers({ Link: `<${prevUrl}>; rel="prev"` }),
      }),
    });
    const result = await searchV2(client, "ann", { type: "accounts", limit: 20 });
    expect(result.continuation).toBeNull();
    expect(result.prev).toEqual({ kind: "url", url: prevUrl });
  });
});
