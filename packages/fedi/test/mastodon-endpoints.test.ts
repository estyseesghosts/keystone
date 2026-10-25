// P4.2 — param shape + paging for the highest-traffic Mastodon GETs.
//
// Characterization tests (not 100% coverage, no snapshots): each test
// names the contract — the path, the query param name, the paging rule.
// The client is stubbed; nothing here touches the network. The endpoint
// functions throw the RAW MastoHttpError; isAbsent accepts either error
// class (the backend adapts before its own absence checks run).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MastoClient, QueryValue, RequestResult } from "../src/mastodon/client";
import { MastoHttpError } from "../src/mastodon/client";
import { ApiError, FediError } from "../src/core/errors";
import type { Account as WireAccount, Status as WireStatus } from "../src/mastodon/wire";
import {
  answerFollowRequest,
  buildReportBody,
  clearNotifications,
  dismissNotification,
  fetchAccountListPage,
  fetchAccountStatusesPage,
  fetchCustomEmojis,
  fetchNotificationsPage,
  fetchStatusHistory,
  fetchTagTimelinePage,
  fetchTimelinePage,
  fetchTrendingTags,
  fetchV2NotificationRows,
  getAccount,
  getRelationships,
  getStatus,
  getStatusContext,
  historySum,
  isAbsent,
  markNotificationsRead,
  reportAccount,
  resolveAccountByHandle,
  searchV2,
  setBlocked,
  setFollowing,
  setMuted,
  shouldResolveSearch,
  voteInPoll,
} from "../src/mastodon/endpoints";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "mastodon", name), "utf8"),
  ) as T;
}

const status = fixture<WireStatus>("status.json");
const account = fixture<WireAccount>("account.json");

interface RecordedCall {
  method: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

type Responder = (
  method: string,
  path: string,
  payload: unknown,
) => { data?: unknown; headers?: Headers; status?: number } | never;

function stubClient(respond: Responder): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run = async (
    method: string,
    path: string,
    payload?: unknown,
  ): Promise<RequestResult<never>> => {
    if (method === "GET") calls.push({ method, path, query: payload as Record<string, QueryValue> });
    else calls.push({ method, path, body: payload });
    const out = respond(method, path, payload);
    return {
      status: out.status ?? 200,
      data: out.data as never,
      headers: out.headers ?? new Headers(),
    };
  };
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token: "t",
    get: (path, query) => run("GET", path, query),
    post: (path, body) => run("POST", path, body),
    put: (path, body) => run("PUT", path, body),
    patch: (path, body) => run("PATCH", path, body),
    delete: (path, body) => run("DELETE", path, body),
    postForm: (path, body) => run("POST", path, body),
    postFormData: (path, body) => run("POST", path, body),
    patchFormData: (path, body) => run("PATCH", path, body),
  };
  return { client, calls };
}

function httpError(statusCode: number): MastoHttpError {
  return new MastoHttpError({
    message: `HTTP ${statusCode}`,
    status: statusCode,
    kind: "http",
    origin: "https://mastodon.example",
  });
}

const NEXT_HOME =
  '<https://mastodon.example/api/v1/timelines/home?max_id=99>; rel="next"';

describe("fetchTimelinePage (highest-traffic GET)", () => {
  it("home first page sends limit 20; a caller limit is honored", async () => {
    const { client, calls } = stubClient(() => ({ data: [status] }));
    await fetchTimelinePage(client, "home");
    expect(calls[0]).toEqual({ method: "GET", path: "/api/v1/timelines/home", query: { limit: 20 } });
    await fetchTimelinePage(client, "home", { limit: 30 });
    expect(calls[1].query).toEqual({ limit: 30 });
  });

  it("local rides the public timeline with local:true; global without it", async () => {
    const { client, calls } = stubClient(() => ({ data: [status] }));
    await fetchTimelinePage(client, "local");
    await fetchTimelinePage(client, "global");
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/timelines/public",
      query: { local: true, limit: 20 },
    });
    expect(calls[1]).toEqual({
      method: "GET",
      path: "/api/v1/timelines/public",
      query: { limit: 20 },
    });
  });

  it("social has no endpoint: throws before any request", async () => {
    const { client, calls } = stubClient(() => ({ data: [status] }));
    await expect(fetchTimelinePage(client, "social")).rejects.toBeInstanceOf(FediError);
    expect(calls).toHaveLength(0);
  });

  it("a url continuation replays the server URL verbatim with no added query", async () => {
    const { client, calls } = stubClient(() => ({ data: [status] }));
    const url = "https://mastodon.example/api/v1/timelines/home?max_id=99&limit=20";
    await fetchTimelinePage(client, "home", { continuation: { kind: "url", url } });
    expect(calls[0]).toEqual({ method: "GET", path: url, query: {} });
  });

  it("a cursors continuation carries max_id/limit onto the base path", async () => {
    const { client, calls } = stubClient(() => ({ data: [status] }));
    await fetchTimelinePage(client, "home", {
      continuation: { kind: "cursors", cursors: { max_id: "99", limit: 10 } },
    });
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/timelines/home",
      query: { max_id: "99", limit: 10 },
    });
  });

  it("end follows the Link header, never items.length < limit", async () => {
    // One item (fewer than the limit) WITH a next link is not the end.
    const { client } = stubClient(() => ({
      data: [status],
      headers: new Headers({ Link: NEXT_HOME }),
    }));
    const mid = await fetchTimelinePage(client, "home");
    expect(mid.end).toBe(false);
    expect(mid.continuation).toEqual({
      kind: "url",
      url: "https://mastodon.example/api/v1/timelines/home?max_id=99",
    });
    // An empty page IS the end even when the server sent a next link.
    const { client: emptyClient } = stubClient(() => ({
      data: [],
      headers: new Headers({ Link: NEXT_HOME }),
    }));
    await expect(fetchTimelinePage(emptyClient, "home")).resolves.toMatchObject({ end: true });
    // No link is the end even on a full page.
    const { client: noLink } = stubClient(() => ({ data: [status] }));
    await expect(fetchTimelinePage(noLink, "home")).resolves.toMatchObject({
      end: true,
      continuation: null,
    });
  });

  it("a non-array 200 body is a shape FediError, never an empty feed", async () => {
    const { client } = stubClient(() => ({ data: {} }));
    const err = await fetchTimelinePage(client, "home").catch((e) => e);
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.shape.timeline");
  });
});

describe("getAccount / resolveAccountByHandle / getRelationships", () => {
  it("getAccount encodes the id into the path; a missing id is a shape error", async () => {
    const { client, calls } = stubClient(() => ({ data: account }));
    const got = await getAccount(client, "u 1");
    expect(calls[0].path).toBe("/api/v1/accounts/u%201");
    expect(got.id).toBe(account.id);
    const { client: bad } = stubClient(() => ({ data: {} }));
    const err = await getAccount(bad, "u1").catch((e) => e);
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.shape.account");
  });

  it("resolveAccountByHandle lookup hit makes no fallback call", async () => {
    const { client, calls } = stubClient(() => ({ data: account }));
    const got = await resolveAccountByHandle(client, "gargron");
    expect(got.id).toBe(account.id);
    expect(calls).toEqual([
      { method: "GET", path: "/api/v1/accounts/lookup", query: { acct: "gargron" } },
    ]);
  });

  it("lookup 404 falls back to v1 search with an exact case-insensitive match", async () => {
    const upper = { ...account, acct: "GARGRON" };
    const { client, calls } = stubClient((method, path) => {
      void method;
      if (path === "/api/v1/accounts/lookup") throw httpError(404);
      return { data: [{ ...account, acct: "someone-else" }, upper] };
    });
    const got = await resolveAccountByHandle(client, "gargron");
    expect(got.id).toBe(account.id);
    expect(calls[1]).toEqual({
      method: "GET",
      path: "/api/v1/accounts/search",
      query: { q: "gargron", limit: 5 },
    });
  });

  it("no match anywhere is a 404 ApiError, never a wrong account", async () => {
    const { client } = stubClient((method, path) => {
      void method;
      if (path === "/api/v1/accounts/lookup") throw httpError(404);
      if (path === "/api/v1/accounts/search") throw httpError(404);
      return { data: { accounts: [{ ...account, acct: "someone-else" }] } };
    });
    const err = await resolveAccountByHandle(client, "nobody").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe("errors.shape.noAccountFound");
  });

  it("a 401 lookup rethrows without falling back (never masked as not-found)", async () => {
    const { client, calls } = stubClient(() => {
      throw httpError(401);
    });
    const err = await resolveAccountByHandle(client, "gargron").catch((e) => e);
    expect(err).toBeInstanceOf(MastoHttpError);
    expect((err as MastoHttpError).status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it("getRelationships with no ids makes no request; ids ride the repeated id param", async () => {
    const { client, calls } = stubClient(() => ({ data: [] }));
    await expect(getRelationships(client, [])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
    await getRelationships(client, ["a", "b"]);
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/accounts/relationships",
      query: { id: ["a", "b"] },
    });
  });
});

describe("getStatus / getStatusContext / account statuses / voteInPoll", () => {
  it("getStatus encodes the id; a missing id is a shape error", async () => {
    const { client, calls } = stubClient(() => ({ data: status }));
    const got = await getStatus(client, "s 1");
    expect(calls[0].path).toBe("/api/v1/statuses/s%201");
    expect(got.id).toBe(status.id);
    const { client: bad } = stubClient(() => ({ data: {} }));
    const err = await getStatus(bad, "s1").catch((e) => e);
    expect((err as FediError).code).toBe("errors.shape.status");
  });

  it("getStatusContext degrades missing arrays to empty lists; a non-object throws", async () => {
    const { client } = stubClient(() => ({ data: { ancestors: null, descendants: "x" } }));
    await expect(getStatusContext(client, "s1")).resolves.toEqual({
      ancestors: [],
      descendants: [],
    });
    const { client: bad } = stubClient(() => ({ data: "nope" }));
    const err = await getStatusContext(bad, "s1").catch((e) => e);
    expect((err as FediError).code).toBe("errors.shape.statusContext");
  });

  it("account tab filters ride the first page (posts/all/media)", async () => {
    const { client, calls } = stubClient(() => ({ data: [status] }));
    await fetchAccountStatusesPage(client, "a1", "posts");
    await fetchAccountStatusesPage(client, "a1", "all");
    await fetchAccountStatusesPage(client, "a1", "media");
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/accounts/a1/statuses",
      query: { exclude_replies: true, exclude_reblogs: true, limit: 20 },
    });
    expect(calls[1].query).toEqual({ limit: 20 });
    expect(calls[2].query).toEqual({ only_media: true, limit: 20 });
  });

  it("voteInPoll with a null id throws noPoll with zero requests; with an id it posts once with no GET", async () => {
    const { client, calls } = stubClient(() => ({ data: status }));
    const err = await voteInPoll(client, null, [0]).catch((e) => e);
    expect((err as FediError).code).toBe("errors.shape.noPoll");
    expect(calls).toHaveLength(0);
    const { client: withPoll, calls: pollCalls } = stubClient(() => ({}));
    await voteInPoll(withPoll, "34830", [0, 1]);
    expect(pollCalls).toEqual([
      {
        method: "POST",
        path: "/api/v1/polls/34830/votes",
        body: { choices: [0, 1] },
      },
    ]);
  });
});

describe("notifications endpoints (highest-traffic GET)", () => {
  const wire = [{ id: "n1", type: "mention", created_at: "2026-01-01T00:00:00.000Z" }];

  it("fetchNotificationsPage sends types[]/exclude_types + limit; url replay drops them", async () => {
    const { client, calls } = stubClient(() => ({ data: wire }));
    await fetchNotificationsPage(client, { types: ["mention"], excludeTypes: ["follow"] });
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/notifications",
      query: { limit: 20, types: ["mention"], exclude_types: ["follow"] },
    });
    const url = "https://mastodon.example/api/v1/notifications?max_id=9";
    await fetchNotificationsPage(client, {
      continuation: { kind: "url", url },
      types: ["mention"],
    });
    expect(calls[1]).toEqual({ method: "GET", path: url, query: {} });
  });

  it("markNotificationsRead posts the marker body; dismiss/clear hit their paths", async () => {
    const { client, calls } = stubClient(() => ({}));
    await markNotificationsRead(client, "42");
    await dismissNotification(client, "n 1");
    await clearNotifications(client);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/markers",
        body: { notifications: { last_read_id: "42" } },
      },
      { method: "POST", path: "/api/v1/notifications/n%201/dismiss", body: undefined },
      { method: "POST", path: "/api/v1/notifications/clear", body: undefined },
    ]);
  });

  it("fetchV2NotificationRows returns null on an array body (caller falls back to v1)", async () => {
    const { client } = stubClient(() => ({ data: [] }));
    await expect(fetchV2NotificationRows(client)).resolves.toBeNull();
  });

  it("fetchV2NotificationRows maps the grouped envelope with account/status lookups", async () => {
    const { client } = stubClient(() => ({
      data: {
        notification_groups: [{ group_key: "g1", type: "mention" }],
        accounts: [{ id: "a1" }],
        statuses: [{ id: "s1" }],
      },
    }));
    const rows = await fetchV2NotificationRows(client);
    expect(rows?.rows).toHaveLength(1);
    expect(rows?.accounts.get("a1")).toMatchObject({ id: "a1" });
    expect(rows?.statuses.get("s1")).toMatchObject({ id: "s1" });
    expect(rows?.end).toBe(true);
  });

  it("isAbsent accepts 404/405 in either error class; 401/403 never count", () => {
    expect(isAbsent(httpError(404))).toBe(true);
    expect(isAbsent(httpError(405))).toBe(true);
    expect(isAbsent(new ApiError("x", 404))).toBe(true);
    expect(isAbsent(new ApiError("x", 405))).toBe(true);
    expect(isAbsent(httpError(401))).toBe(false);
    expect(isAbsent(new ApiError("x", 403))).toBe(false);
    expect(isAbsent(new Error("boom"))).toBe(false);
  });
});

describe("endpoint shape leftovers (R1.3 class)", () => {
  it("fetchStatusHistory passes rows through; a non-array body throws", async () => {
    const rows = [{ id: "e1" }];
    const { client } = stubClient(() => ({ data: rows }));
    await expect(fetchStatusHistory(client, "s1")).resolves.toEqual(rows);
    const { client: bad } = stubClient(() => ({ data: {} }));
    const err = await fetchStatusHistory(bad, "s1").catch((e) => e);
    expect((err as FediError).code).toBe("errors.shape.statusHistory");
  });

  it("fetchCustomEmojis passes rows through; a non-array body throws", async () => {
    const rows = [{ shortcode: "x", url: "https://a.b/x.png" }];
    const { client } = stubClient(() => ({ data: rows }));
    await expect(fetchCustomEmojis(client)).resolves.toEqual(rows);
    const { client: bad } = stubClient(() => ({ data: {} }));
    const err = await fetchCustomEmojis(bad).catch((e) => e);
    expect((err as FediError).code).toBe("errors.shape.customEmojis");
  });

  it("historySum totals numeric strings; non-finite entries count zero", () => {
    expect(historySum([{ uses: "3" }, { uses: 2 }, { uses: "x" }, {}], "uses")).toBe(5);
    expect(historySum(null, "uses")).toBe(0);
    expect(historySum([{ accounts: [1] }], "accounts")).toBe(0);
  });

  it("buildReportBody forces violation with rule_ids; omits unset fields", () => {
    expect(buildReportBody("a1", { ruleIds: ["r1"], category: "spam" })).toEqual({
      account_id: "a1",
      rule_ids: ["r1"],
      category: "violation",
    });
    expect(buildReportBody("a1", "needs review")).toEqual({
      account_id: "a1",
      comment: "needs review",
    });
    expect(buildReportBody("a1", {})).toEqual({ account_id: "a1" });
    expect(
      buildReportBody("a1", { comment: "c", statusIds: ["s1"], forward: true }),
    ).toEqual({
      account_id: "a1",
      comment: "c",
      status_ids: ["s1"],
      forward: true,
    });
  });

  it("reportAccount posts the report body for the account", async () => {
    const { client, calls } = stubClient(() => ({}));
    await reportAccount(client, "a1", "needs review");
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/v1/reports",
      body: { account_id: "a1", comment: "needs review" },
    });
  });

  it("fetchTrendingTags filters nameless rows and sums history", async () => {
    const { client } = stubClient(() => ({
      data: [
        { name: "cats", history: [{ uses: "2", accounts: 1 }, { uses: 3, accounts: "4" }] },
        { name: "", history: [] },
        {},
      ],
    }));
    await expect(fetchTrendingTags(client)).resolves.toEqual([
      { name: "cats", uses: 5, accounts: 5 },
    ]);
  });

  it("fetchAccountListPage: mutes/blocks hit top-level paths; followers encode the id", async () => {
    const { client, calls } = stubClient(() => ({ data: [account] }));
    await fetchAccountListPage(client, "ignored", "mutes");
    await fetchAccountListPage(client, "a 1", "followers");
    expect(calls[0].path).toBe("/api/v1/mutes");
    expect(calls[0].query).toEqual({ limit: 20 });
    expect(calls[1].path).toBe("/api/v1/accounts/a%201/followers");
  });

  it("fetchTagTimelinePage encodes the tag; searchV2 blank query answers without a request", async () => {
    const { client, calls } = stubClient(() => ({ data: [status] }));
    await fetchTagTimelinePage(client, "café");
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/timelines/tag/caf%C3%A9",
      query: { limit: 20 },
    });
    const { client: search, calls: searchCalls } = stubClient(() => ({ data: {} }));
    await expect(searchV2(search, "   ")).resolves.toEqual({
      accounts: [],
      statuses: [],
      hashtags: [],
      continuation: null,
      prev: null,
    });
    expect(searchCalls).toHaveLength(0);
  });

  describe("searchV2 resolve (finding 4)", () => {
    it("shouldResolveSearch matches URLs and handle shapes only", () => {
      expect(shouldResolveSearch("https://other.example/@x/123")).toBe(true);
      expect(shouldResolveSearch("http://other.example/users/x")).toBe(true);
      expect(shouldResolveSearch("@x@other.example")).toBe(true);
      expect(shouldResolveSearch("x@other.example")).toBe(true);
      expect(shouldResolveSearch("@x")).toBe(true);
      expect(shouldResolveSearch("cats")).toBe(false);
      expect(shouldResolveSearch("#cats")).toBe(false);
      expect(shouldResolveSearch("   ")).toBe(false);
    });

    it("searchV2 sends resolve=true only when asked", async () => {
      const { client, calls } = stubClient(() => ({ data: {} }));
      await searchV2(client, "https://other.example/@x/123", {
        type: "statuses",
        resolve: true,
      });
      expect(calls[0].query).toMatchObject({
        q: "https://other.example/@x/123",
        type: "statuses",
        resolve: true,
      });
      const { client: local, calls: localCalls } = stubClient(() => ({ data: {} }));
      await searchV2(local, "cats", { type: "statuses" });
      expect(localCalls[0].query).not.toHaveProperty("resolve");
    });

    it("a url continuation replays verbatim and never adds resolve", async () => {
      const { client, calls } = stubClient(() => ({ data: {} }));
      const url = "https://mastodon.example/api/v2/search?q=cats&type=statuses&offset=20";
      await searchV2(client, "cats", {
        type: "statuses",
        resolve: true,
        continuation: { kind: "url", url },
      });
      expect(calls[0]).toEqual({ method: "GET", path: url, query: {} });
    });
  });

  it("account writes hit their verbs (following/muted/blocked)", async () => {
    const { client, calls } = stubClient(() => ({}));
    await setFollowing(client, "a1", true);
    await setMuted(client, "a1", true);
    await setBlocked(client, "a1", false);
    await answerFollowRequest(client, "a1", true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/v1/accounts/a1/follow",
      "POST /api/v1/accounts/a1/mute",
      "POST /api/v1/accounts/a1/unblock",
      "POST /api/v1/follow_requests/a1/authorize",
    ]);
  });
});
