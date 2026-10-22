// P6.3 slice 3.2 — reports queue (both families, failing-then-passing).
//
// The daily moderation surface (clickstone §3.2):
// - Mastodon: `GET /api/v1/admin/reports` (Link-paged, `resolved`/
//   `unresolved` filters — the verified `FILTER_PARAMS`) + `GET /:id` +
//   `POST /:id/assign_to_self|unassign|reopen|resolve` + `PATCH /:id`
//   (category/rule_ids only). There is NO notes API in the `api/v1`
//   namespace (verified in the local checkout's routes: the web admin
//   owns notes/history; the API serializer carries only the action
//   outcome) — so this layer exposes no notes methods, never fake ones.
// - Misskey: `admin/abuse-user-reports` (limit/sinceId/untilId/state) +
//   `admin/resolve-abuse-user-report {reportId, resolvedAs?}` +
//   `admin/update-abuse-user-report {reportId, moderationNote}` +
//   `admin/forward-abuse-user-report {reportId}` (all three mutations share
//   the single kind `write:admin:resolve-abuse-user-report`, verified in
//   the Misskey + Sharkey + Catodon checkouts; the list reads
//   `read:admin:abuse-user-reports`). Misskey has no show/unresolve
//   endpoint — detail renders the list row, reopen stays Mastodon-only.
//
// Same boundaries as slice 3.1: the `toApiError` seam (403 = typed
// permission error that disables the section, never clears the session;
// 404 = honest unsupported). No network: transports are stubbed.

import { createMastodonBackend } from "../src/mastodon/backend";
import {
  MastoHttpError,
  type MastoClient,
  type RequestOptions,
  type RequestResult,
} from "../src/mastodon/client";
import {
  assignAdminReportToSelf,
  fetchAdminReport,
  fetchAdminReportsPage,
  reopenAdminReport,
  resolveAdminReport,
  unassignAdminReport,
  updateAdminReport,
} from "../src/mastodon/admin";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { KEYSTONE_PERMISSIONS } from "../src/misskey/auth";
import { ApiError, FediError } from "../src/core/errors";
import { isPermissionError, isUnsupportedError } from "../src/misskey/client";

// --- Mastodon stub -----------------------------------------------------------

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
) => { data?: unknown; headers?: Headers } | never;

function stubMasto(respond: Responder): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run = async (
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<RequestResult<never>> => {
    calls.push({ method, path, body, opts });
    const out = respond(method, path, body);
    return { status: 200, data: out.data as never, headers: out.headers ?? new Headers() };
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

function mastoHttpError(status: number): never {
  throw new MastoHttpError({
    message: `HTTP ${status}`,
    status,
    kind: "http",
    body: `HTTP ${status}`,
    origin: "https://mastodon.example",
    method: "GET",
    path: "/api/v1/admin/reports",
  });
}

/** An `Admin::AccountSerializer` wrapper: `{id, ..., account: <plain>}`. */
function adminAccountWrapper(id: string, username: string) {
  return {
    id,
    username: `admin-${username}`,
    domain: null,
    account: {
      id,
      username,
      acct: username,
      display_name: username,
      locked: false,
      bot: false,
      created_at: "2026-01-01T00:00:00.000Z",
      note: "",
      url: `https://mastodon.example/@${username}`,
      avatar: null,
      avatar_static: null,
      header: null,
      header_static: null,
      followers_count: 0,
      following_count: 0,
      statuses_count: 0,
      fields: [],
    },
  };
}

function wireReport(over: Record<string, unknown> = {}) {
  return {
    id: "1",
    action_taken: false,
    action_taken_at: null,
    category: "spam",
    comment: "spam bot",
    forwarded: false,
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:00.000Z",
    account: adminAccountWrapper("10", "reporter"),
    target_account: adminAccountWrapper("11", "spammer"),
    assigned_account: null,
    action_taken_by_account: null,
    statuses: [{ id: "101" }, { id: "102" }],
    rules: [{ id: 7, text: "No spam" }],
    ...over,
  };
}

// --- Misskey stub ------------------------------------------------------------

interface MisskeyCall {
  endpoint: string;
  params: Record<string, unknown>;
}

function stubMisskey(respond?: (endpoint: string, params: Record<string, unknown>) => unknown): {
  transport: MisskeyTransport;
  calls: MisskeyCall[];
} {
  const calls: MisskeyCall[] = [];
  const transport = {
    call: async (endpoint: string, params: Record<string, unknown> = {}) => {
      calls.push({ endpoint, params });
      return respond?.(endpoint, params);
    },
    upload: async () => {
      throw new Error("not used");
    },
  } as unknown as MisskeyTransport;
  return { transport, calls };
}

function misskeyError(status: number, code = "PERMISSION_DENIED"): never {
  throw new ApiError(`HTTP ${status}`, status, code);
}

function wireAbuseReport(over: Record<string, unknown> = {}) {
  const user = (id: string, username: string) => ({
    id,
    name: null,
    username,
    host: null,
    avatarUrl: null,
    avatarBlurhash: null,
    isBot: false,
    isCat: false,
    emojis: {},
    onlineStatus: "unknown",
  });
  return {
    id: "r1",
    createdAt: "2026-10-20T00:00:00.000Z",
    comment: "impersonation",
    resolved: false,
    reporterId: "u1",
    targetUserId: "u2",
    assigneeId: null,
    reporter: user("u1", "reporter"),
    targetUser: user("u2", "spammer"),
    assignee: null,
    forwarded: false,
    resolvedAs: null,
    moderationNote: "",
    ...over,
  };
}

// --- Mastodon queue ----------------------------------------------------------

describe("P6.3 reports queue — Mastodon list", () => {
  it("GETs /api/v1/admin/reports with unresolved=true and adapts the rows", async () => {
    const { client, calls } = stubMasto(() => ({ data: [wireReport()] }));
    const page = await fetchAdminReportsPage(client, { state: "open" });
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.path).toBe("/api/v1/admin/reports");
    const query = calls[0]?.body as Record<string, unknown>;
    expect(query.unresolved).toBe(true);
    expect(query.resolved).toBeUndefined();
    expect(page.items).toHaveLength(1);
    const row = page.items[0]!;
    expect(row.id).toBe("1");
    expect(row.comment).toBe("spam bot");
    expect(row.reporter?.username).toBe("reporter");
    expect(row.target?.username).toBe("spammer");
    expect(row.statusIds).toEqual(["101", "102"]);
    expect(row.ruleIds).toEqual(["7"]);
    expect(row.category).toBe("spam");
    expect(row.forwarded).toBe(false);
    expect(row.state).toBe("open");
    expect(row.assignee).toBeNull();
    expect(row.resolution).toBeNull();
    expect(page.end).toBe(true);
  });

  it("maps state resolved to resolved=true and reads the action outcome", async () => {
    const { client, calls } = stubMasto(() => ({
      data: [
        wireReport({
          action_taken: true,
          action_taken_at: "2026-10-21T00:00:00.000Z",
          action_taken_by_account: adminAccountWrapper("12", "mod"),
          assigned_account: adminAccountWrapper("12", "mod"),
          category: "violation",
        }),
      ],
    }));
    const page = await fetchAdminReportsPage(client, { state: "resolved" });
    expect((calls[0]?.body as Record<string, unknown>).resolved).toBe(true);
    const row = page.items[0]!;
    expect(row.state).toBe("resolved");
    expect(row.actionTakenAt).toBe("2026-10-21T00:00:00.000Z");
    expect(row.actionTakenBy?.username).toBe("mod");
    expect(row.assignee?.username).toBe("mod");
    expect(row.resolution).toBeNull();
  });

  it("drops an unknown category instead of forwarding it blindly", async () => {
    const { client } = stubMasto(() => ({ data: [wireReport({ category: "harassment" })] }));
    const page = await fetchAdminReportsPage(client, {});
    expect(page.items[0]!.category).toBeNull();
  });

  it("a 403 is the typed permission error; a 404 is honest unsupported", async () => {
    const denied = stubMasto(() => mastoHttpError(403));
    await expect(fetchAdminReportsPage(denied.client, {})).rejects.toMatchObject({ status: 403 });
    const err403 = await fetchAdminReportsPage(denied.client, {}).catch((e: unknown) => e);
    expect(isPermissionError(err403)).toBe(true);

    const absent = stubMasto(() => mastoHttpError(404));
    const err404 = await fetchAdminReportsPage(absent.client, {}).catch((e: unknown) => e);
    expect(isUnsupportedError(err404)).toBe(true);
  });
});

describe("P6.3 reports queue — Mastodon detail + mutations", () => {
  it("GETs one report by id", async () => {
    const { client, calls } = stubMasto(() => ({ data: wireReport() }));
    const row = await fetchAdminReport(client, "1");
    expect(calls).toEqual([
      { method: "GET", path: "/api/v1/admin/reports/1", body: undefined, opts: undefined },
    ]);
    expect(row.id).toBe("1");
  });

  it("posts assign/unassign/reopen/resolve to the member routes", async () => {
    const { client, calls } = stubMasto(() => ({ data: wireReport() }));
    await assignAdminReportToSelf(client, "1");
    await unassignAdminReport(client, "1");
    await reopenAdminReport(client, "1");
    await resolveAdminReport(client, "1");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/v1/admin/reports/1/assign_to_self",
      "POST /api/v1/admin/reports/1/unassign",
      "POST /api/v1/admin/reports/1/reopen",
      "POST /api/v1/admin/reports/1/resolve",
    ]);
  });

  it("refuses a resolve decision on Mastodon without any network I/O", async () => {
    const { client, calls } = stubMasto(() => ({ data: wireReport() }));
    const err = await resolveAdminReport(client, "1", { decision: "accept" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FediError);
    expect(calls).toEqual([]);
  });

  it("PATCHes category + rule_ids only when chosen", async () => {
    const { client, calls } = stubMasto(() => ({ data: wireReport() }));
    await updateAdminReport(client, "1", { category: "legal", ruleIds: ["3"] });
    expect(calls[0]).toEqual({
      method: "PATCH",
      path: "/api/v1/admin/reports/1",
      body: { category: "legal", rule_ids: ["3"] },
      opts: undefined,
    });
  });
});

describe("P6.3 reports queue — Mastodon backend wiring", () => {
  it("every Mastodon-family flavor exposes the queue module", () => {
    for (const flavor of ["mastodon", "akkoma", "pleroma", "unknown"] as const) {
      const { client } = stubMasto(() => ({ data: [] }));
      const backend = createMastodonBackend(client, { flavor });
      expect(backend.reportsQueue).toBeDefined();
      expect(typeof backend.reportsQueue?.list).toBe("function");
      expect(typeof backend.reportsQueue?.resolve).toBe("function");
      expect(backend.reportsQueue?.forward).toBeUndefined();
      expect(backend.reportsQueue?.updateNote).toBeUndefined();
    }
  });

  it("list through the backend surfaces 403 as the permission error", async () => {
    const { client } = stubMasto(() => mastoHttpError(403));
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    const err = await backend.reportsQueue!.list().catch((e: unknown) => e);
    expect(isPermissionError(err)).toBe(true);
  });
});

// --- Misskey queue -----------------------------------------------------------

describe("P6.3 reports queue — Misskey list", () => {
  it("calls admin/abuse-user-reports with limit + state and adapts the rows", async () => {
    const { transport, calls } = stubMisskey(() => [wireAbuseReport()]);
    const backend = createMisskeyBackend(transport, "misskey");
    const page = await backend.reportsQueue!.list({ state: "open" });
    expect(calls).toEqual([
      { endpoint: "admin/abuse-user-reports", params: { limit: 20, state: "unresolved" } },
    ]);
    const row = page.items[0]!;
    expect(row.id).toBe("r1");
    expect(row.comment).toBe("impersonation");
    expect(row.reporter?.username).toBe("reporter");
    expect(row.target?.username).toBe("spammer");
    expect(row.assignee).toBeNull();
    expect(row.statusIds).toEqual([]);
    expect(row.ruleIds).toEqual([]);
    expect(row.category).toBeNull();
    expect(row.forwarded).toBe(false);
    expect(row.state).toBe("open");
    expect(row.resolution).toBeNull();
    expect(row.moderationNote).toBe("");
  });

  it("maps state resolved and reads assignee + resolution + note", async () => {
    const { transport, calls } = stubMisskey(() => [
      wireAbuseReport({
        resolved: true,
        resolvedAs: "accept",
        moderationNote: "handled",
        forwarded: true,
        assigneeId: "u9",
        assignee: {
          id: "u9",
          name: null,
          username: "mod",
          host: null,
          avatarUrl: null,
          avatarBlurhash: null,
          isBot: false,
          isCat: false,
          emojis: {},
          onlineStatus: "unknown",
        },
      }),
    ]);
    const page = await createMisskeyBackend(transport, "misskey").reportsQueue!.list({
      state: "resolved",
    });
    expect(calls[0]?.params.state).toBe("resolved");
    const row = page.items[0]!;
    expect(row.state).toBe("resolved");
    expect(row.resolution).toBe("accept");
    expect(row.moderationNote).toBe("handled");
    expect(row.forwarded).toBe(true);
    expect(row.assignee?.username).toBe("mod");
  });

  it("a 403 PERMISSION_DENIED is the permission error; a 404 is unsupported", async () => {
    const { transport } = stubMisskey(() => misskeyError(403));
    const err = await createMisskeyBackend(transport, "misskey")
      .reportsQueue!.list()
      .catch((e: unknown) => e);
    expect(isPermissionError(err)).toBe(true);

    const missing = stubMisskey(() => misskeyError(404, "NO_SUCH_ENDPOINT"));
    const err404 = await createMisskeyBackend(missing.transport, "misskey")
      .reportsQueue!.list()
      .catch((e: unknown) => e);
    expect(isUnsupportedError(err404)).toBe(true);
  });
});

describe("P6.3 reports queue — Misskey mutations", () => {
  it("resolve sends reportId + resolvedAs (null when no verdict)", async () => {
    const { transport, calls } = stubMisskey(() => undefined);
    const backend = createMisskeyBackend(transport, "misskey");
    await backend.reportsQueue!.resolve("r1", { decision: "reject" });
    await backend.reportsQueue!.resolve("r2");
    expect(calls).toEqual([
      {
        endpoint: "admin/resolve-abuse-user-report",
        params: { reportId: "r1", resolvedAs: "reject" },
      },
      {
        endpoint: "admin/resolve-abuse-user-report",
        params: { reportId: "r2", resolvedAs: null },
      },
    ]);
  });

  it("updateNote sends reportId + moderationNote verbatim", async () => {
    const { transport, calls } = stubMisskey(() => undefined);
    await createMisskeyBackend(transport, "misskey").reportsQueue!.updateNote!("r1", "note");
    expect(calls).toEqual([
      { endpoint: "admin/update-abuse-user-report", params: { reportId: "r1", moderationNote: "note" } },
    ]);
  });

  it("forward sends reportId only", async () => {
    const { transport, calls } = stubMisskey(() => undefined);
    await createMisskeyBackend(transport, "misskey").reportsQueue!.forward!("r1");
    expect(calls).toEqual([
      { endpoint: "admin/forward-abuse-user-report", params: { reportId: "r1" } },
    ]);
  });

  it("has no get/reopen/recategorize (no such endpoints upstream)", () => {
    const { transport } = stubMisskey(() => undefined);
    const queue = createMisskeyBackend(transport, "misskey").reportsQueue!;
    expect(queue.get).toBeUndefined();
    expect(queue.reopen).toBeUndefined();
    expect(queue.recategorize).toBeUndefined();
    expect(queue.assignToSelf).toBeUndefined();
    expect(queue.unassign).toBeUndefined();
  });
});

describe("P6.3 reports queue — Misskey wiring + permissions", () => {
  it("ships on misskey/sharkey/catodon, stays off on pinetree", () => {
    for (const flavor of ["misskey", "sharkey", "catodon"] as const) {
      const { transport } = stubMisskey(() => []);
      expect(createMisskeyBackend(transport, flavor).reportsQueue).toBeDefined();
    }
    const { transport } = stubMisskey(() => []);
    expect(createMisskeyBackend(transport, "pinetree").reportsQueue).toBeUndefined();
  });

  it("requests the exact abuse-report permission kinds (resolve kind covers all three mutations)", () => {
    expect(KEYSTONE_PERMISSIONS).toContain("read:admin:abuse-user-reports");
    expect(KEYSTONE_PERMISSIONS).toContain("write:admin:resolve-abuse-user-report");
  });
});
