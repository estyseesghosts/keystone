// X4.5: filtered notification requests + filter policy (Mastodon 4.3+).
//
// Fixtures are SYNTHESISED from the documented NotificationRequest /
// NotificationPolicy entity shapes (see fixtures/manifest.json) — they
// prove the mapping handles the documented shape, not that a live server
// emits it (no 4.3+ server on the rig; live checks go to X12.1).

import { readFileSync } from "node:fs";
import { join } from "node:path";
// Jest port: `describe/it/expect` are globals (no vitest import).
import { FediError } from "../src/core/errors";
import { createMastodonBackend } from "../src/mastodon/backend";
import type { MastoClient, QueryValue, RequestResult } from "../src/mastodon/client";
import { MastoHttpError } from "../src/mastodon/client";
import {
  acceptNotificationRequest,
  adaptNotificationPolicy,
  adaptNotificationRequest,
  createNotificationRequestsApi,
  dismissNotificationRequest,
  fetchNotificationPolicy,
  fetchNotificationRequestsPage,
  notificationRequestsSupportFor,
  probeNotificationRequests,
  resetNotificationRequestsSupportCache,
  setNotificationRequestsSupportFor,
  updateNotificationPolicy,
} from "../src/mastodon/notificationRequests";
import { clearSkippedRowCounts, skippedRowCount } from "../src/mastodon/adapt";

const ORIGIN = "https://mastodon.example";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "mastodon", name), "utf8"),
  ) as T;
}

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

function httpError(statusCode: number): MastoHttpError {
  return new MastoHttpError({
    message: `HTTP ${statusCode}`,
    status: statusCode,
    kind: "http",
    origin: ORIGIN,
  });
}

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
    origin: ORIGIN,
    token: "t",
    get: (path, query, _o) => run("GET", path, query),
    post: (path, body, _o) => run("POST", path, body),
    put: (path, body, _o) => run("PUT", path, body),
    patch: (path, body, _o) => run("PATCH", path, body),
    delete: (path, body, _o) => run("DELETE", path, body),
    postForm: (path, body, _o) => run("POST", path, body),
    postFormData: (path, body, _o) => run("POST", path, body),
    patchFormData: (path, body, _o) => run("PATCH", path, body),
  };
  return { client, calls };
}

const NEXT_LINK =
  '<https://mastodon.example/api/v1/notifications/requests?max_id=700>; rel="next"';

beforeEach(() => {
  resetNotificationRequestsSupportCache();
  clearSkippedRowCounts();
});

describe("adaptNotificationRequest", () => {
  it("adapts a packed row: id, account, timestamp", () => {
    const rows = fixture<Array<Record<string, unknown>>>("notification-requests.json");
    const n = adaptNotificationRequest(rows[0]);
    expect(n?.id).toBe("701");
    expect(n?.createdAt).toBe("2026-10-20T10:00:00.000Z");
    expect(n?.account?.username).toBe("alice");
    expect(n?.account?.host).toBeNull();
  });

  it("keeps a remote account with its host, never a bare handle", () => {
    const rows = fixture<Array<Record<string, unknown>>>("notification-requests.json");
    const n = adaptNotificationRequest(rows[1]);
    expect(n?.account?.username).toBe("stranger");
    expect(n?.account?.host).toBe("remote.example");
  });

  it("reads a null account as null, never an invented profile", () => {
    const rows = fixture<Array<Record<string, unknown>>>("notification-requests.json");
    const n = adaptNotificationRequest(rows[2]);
    expect(n?.id).toBe("703");
    expect(n?.account).toBeNull();
  });

  it("reads a row without a string id as unlistable (null)", () => {
    const rows = fixture<Array<Record<string, unknown>>>("notification-requests.json");
    expect(adaptNotificationRequest(rows[3])).toBeNull();
    expect(adaptNotificationRequest(null)).toBeNull();
    expect(adaptNotificationRequest({ id: "", account: null })).toBeNull();
  });

  it("reads a missing timestamp as null, never now", () => {
    const n = adaptNotificationRequest({ id: "800" });
    expect(n?.createdAt).toBeNull();
    expect(n?.account).toBeNull();
  });
});

describe("adaptNotificationPolicy", () => {
  it("adapts the full policy body including the summary", () => {
    const policy = adaptNotificationPolicy(fixture("notification-policy.json"));
    expect(policy).toEqual({
      filterNotFollowing: true,
      filterNotFollowers: false,
      filterNewAccounts: true,
      filterPrivateMentions: false,
      pendingRequestsCount: 2,
      pendingNotificationsCount: 5,
    });
  });

  it("reads absent switches and counters as null, never a guess", () => {
    expect(adaptNotificationPolicy({})).toEqual({
      filterNotFollowing: null,
      filterNotFollowers: null,
      filterNewAccounts: null,
      filterPrivateMentions: null,
      pendingRequestsCount: null,
      pendingNotificationsCount: null,
    });
  });

  it("rejects a non-object body as a malformed answer", () => {
    expect(() => adaptNotificationPolicy([])).toThrow(FediError);
    expect(() => adaptNotificationPolicy(null)).toThrow(
      expect.objectContaining({ code: "errors.shape.notificationPolicy" }),
    );
  });
});

describe("fetchNotificationRequestsPage", () => {
  it("first page sends limit 20 and skips the id-less row", async () => {
    const { client, calls } = stubClient(() => ({
      data: fixture("notification-requests.json"),
    }));
    const page = await fetchNotificationRequestsPage(client);
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/notifications/requests",
      query: { limit: 20 },
    });
    expect(page.items.map((i) => i.id)).toEqual(["701", "702", "703"]);
    expect(skippedRowCount("notification-requests")).toBe(1);
    // No next link: end, even though the page is non-empty.
    expect(page.end).toBe(true);
    expect(page.continuation).toBeNull();
  });

  it("a next Link drives real paging (same end rule as feeds)", async () => {
    const { client, calls } = stubClient(() => ({
      data: fixture("notification-requests.json"),
      headers: new Headers({ Link: NEXT_LINK }),
    }));
    const page = await fetchNotificationRequestsPage(client);
    expect(page.end).toBe(false);
    expect(page.continuation).toEqual({
      kind: "url",
      url: "https://mastodon.example/api/v1/notifications/requests?max_id=700",
    });
    await fetchNotificationRequestsPage(client, { continuation: page.continuation });
    expect(calls[1].path).toBe(
      "https://mastodon.example/api/v1/notifications/requests?max_id=700",
    );
    expect(calls[1].query).toEqual({});
  });

  it("rejects a non-array body as a malformed answer, never an empty inbox", async () => {
    const { client } = stubClient(() => ({ data: {} }));
    await expect(fetchNotificationRequestsPage(client)).rejects.toThrow(FediError);
  });

  it("a 404 caches unsupported and rethrows", async () => {
    const { client } = stubClient(() => {
      throw httpError(404);
    });
    await expect(fetchNotificationRequestsPage(client)).rejects.toMatchObject({ status: 404 });
    expect(notificationRequestsSupportFor(ORIGIN)).toBe(false);
  });

  it("a 401 rethrows and caches nothing (auth is never absence)", async () => {
    const { client } = stubClient(() => {
      throw httpError(401);
    });
    await expect(fetchNotificationRequestsPage(client)).rejects.toMatchObject({ status: 401 });
    expect(notificationRequestsSupportFor(ORIGIN)).toBeNull();
  });
});

describe("accept/dismissNotificationRequest", () => {
  it("accept posts to the row's accept route with the encoded id", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    await acceptNotificationRequest(client, "701/a b");
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/notifications/requests/701%2Fa%20b/accept", body: undefined },
    ]);
    expect(notificationRequestsSupportFor(ORIGIN)).toBe(true);
  });

  it("dismiss posts to the row's dismiss route", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    await dismissNotificationRequest(client, "702");
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/notifications/requests/702/dismiss", body: undefined },
    ]);
  });

  it("never caches on server errors (500 rethrows, no verdict)", async () => {
    const { client } = stubClient(() => {
      throw httpError(500);
    });
    await expect(dismissNotificationRequest(client, "702")).rejects.toMatchObject({ status: 500 });
    expect(notificationRequestsSupportFor(ORIGIN)).toBeNull();
  });
});

describe("fetch/updateNotificationPolicy", () => {
  it("GETs the v2 policy route", async () => {
    const { client, calls } = stubClient(() => ({
      data: fixture("notification-policy.json"),
    }));
    const policy = await fetchNotificationPolicy(client);
    expect(calls).toEqual([
      { method: "GET", path: "/api/v2/notifications/policy", query: undefined },
    ]);
    expect(policy.pendingRequestsCount).toBe(2);
    expect(notificationRequestsSupportFor(ORIGIN)).toBe(true);
  });

  it("PATCH sends only defined fields and answers the stored policy", async () => {
    const { client, calls } = stubClient(() => ({
      data: fixture("notification-policy.json"),
    }));
    await updateNotificationPolicy(client, { filterNotFollowers: true });
    expect(calls[0]).toEqual({
      method: "PATCH",
      path: "/api/v2/notifications/policy",
      body: { filter_not_followers: true },
    });
  });

  it("a policy 404 caches unsupported (the inbox hides with a reason)", async () => {
    const { client } = stubClient(() => {
      throw httpError(404);
    });
    await expect(fetchNotificationPolicy(client)).rejects.toMatchObject({ status: 404 });
    expect(notificationRequestsSupportFor(ORIGIN)).toBe(false);
  });
});

describe("probeNotificationRequests", () => {
  it("true on any 2xx (even empty), cached per origin", async () => {
    const { client, calls } = stubClient(() => ({ data: [] }));
    await expect(probeNotificationRequests(client)).resolves.toBe(true);
    await expect(probeNotificationRequests(client)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("false on 404/405, cached (one 404 per origin per launch at most)", async () => {
    const { client, calls } = stubClient(() => {
      throw httpError(405);
    });
    await expect(probeNotificationRequests(client)).resolves.toBe(false);
    await expect(probeNotificationRequests(client)).resolves.toBe(false);
    expect(calls).toHaveLength(1);
    expect(notificationRequestsSupportFor(ORIGIN)).toBe(false);
  });

  it("rethrows auth and server errors without caching", async () => {
    const { client } = stubClient(() => {
      throw httpError(403);
    });
    await expect(probeNotificationRequests(client)).rejects.toMatchObject({ status: 403 });
    expect(notificationRequestsSupportFor(ORIGIN)).toBeNull();
  });
});

describe("backend wiring (probe-backed capability, never flavor-guessed)", () => {
  it("exposes the inbox member on every Mastodon-family flavor", () => {
    for (const flavor of ["mastodon", "akkoma", "pleroma", "unknown"] as const) {
      const { client } = stubClient(() => ({ data: [] }));
      const backend = createMastodonBackend(client, { flavor });
      expect(typeof backend.notificationRequests?.list).toBe("function");
      expect(typeof backend.notificationRequests?.policy).toBe("function");
      expect(backend.notificationRequests?.isSupported()).toBeNull();
    }
  });

  it("capability reads unknown until a verdict lands, then the verdict", async () => {
    const { client } = stubClient(() => ({ data: fixture("notification-policy.json") }));
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    expect(backend.capabilities.notification_requests).toBe("unknown");
    await backend.notificationRequests?.policy();
    expect(backend.capabilities.notification_requests).toBe("supported");
  });

  it("capability reads unsupported after a probed absence", async () => {
    const { client } = stubClient(() => {
      throw httpError(404);
    });
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    await expect(backend.notificationRequests?.policy()).rejects.toMatchObject({ status: 404 });
    expect(backend.capabilities.notification_requests).toBe("unsupported");
  });

  it("a seeded verdict flows to both isSupported and the capability", () => {
    const { client } = stubClient(() => ({ data: [] }));
    setNotificationRequestsSupportFor(ORIGIN, true);
    const backend = createMastodonBackend(client, { flavor: "akkoma" });
    expect(backend.notificationRequests?.isSupported()).toBe(true);
    expect(backend.capabilities.notification_requests).toBe("supported");
  });

  it("lists through the backend with adapted rows", async () => {
    const { client } = stubClient(() => ({
      data: fixture("notification-requests.json"),
    }));
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    const page = await backend.notificationRequests?.list();
    expect(page?.items.map((i) => i.id)).toEqual(["701", "702", "703"]);
    expect(page?.end).toBe(true);
  });

  it("accept/dismiss through the backend hit the row routes", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    await backend.notificationRequests?.accept("701");
    await backend.notificationRequests?.dismiss("702");
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v1/notifications/requests/701/accept",
      "/api/v1/notifications/requests/702/dismiss",
    ]);
  });
});

describe("createNotificationRequestsApi (direct)", () => {
  it("isSupported is null before any call", () => {
    const { client } = stubClient(() => ({ data: [] }));
    expect(createNotificationRequestsApi(client).isSupported()).toBeNull();
  });
});
