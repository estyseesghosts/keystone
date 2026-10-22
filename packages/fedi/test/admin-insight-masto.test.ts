// P6.3 slice 3.1 — Mastodon server insight (read-only, no mutations).
//
// Pins the Wave 3 credential path before it exists:
// - `admin_read`/`admin_write` capability keys exist with "unknown"
//   defaults everywhere; `buildCapabilities` never infers a role (role
//   comes from verify_credentials at the backend/session layer).
// - `admin:read`/`admin:write` are NOW scopes (the umbrella triple does NOT
//   satisfy the admin endpoints — source-verified in the session log, not
//   here: reads need `admin:read` since slice 3.1, the reports-queue
//   mutations need `admin:write` since slice 3.2). `read:conversations` is
//   still never requested (not a real scope).
// - The admin client posts measures/dimensions with `{keys}`, adapts the
//   rows to domain models, and surfaces 403 as the typed permission error
//   (section disables with a reason — never a session clear) and 404 as
//   the honest unsupported state (Akkoma has no `/api/v1/admin/*`).
// - Public fallbacks (peers/extended description/activity) parse; the
//   backend wires `adminInsight` on every Mastodon-family flavor.
//
// No network: the transport is stubbed.

import { createMastodonBackend } from "../src/mastodon/backend";
import { MastoHttpError, type MastoClient, type RequestOptions, type RequestResult } from "../src/mastodon/client";
import { ApiError } from "../src/core/errors";
import { isPermissionError, isUnsupportedError } from "../src/misskey/client";
import { buildCapabilities, FEATURE_KEYS, type ServerFlavor } from "../src/core/detect";
import { SCOPES_LATER, SCOPES_MASTODON, SCOPES_NOW, scopesForFlavor } from "../src/mastodon/oauth";
import {
  adminRoleOf,
  fetchAdminDimensions,
  fetchAdminMeasures,
  fetchInstanceActivity,
  fetchInstanceExtendedDescription,
  fetchInstancePeers,
} from "../src/mastodon/admin";
import type { Account } from "../src/core/models";

const FLAVORS: readonly ServerFlavor[] = [
  "misskey",
  "sharkey",
  "catodon",
  "pinetree",
  "mastodon",
  "akkoma",
  "pleroma",
  "unknown",
];

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

function httpError(status: number): never {
  throw new MastoHttpError({
    message: `HTTP ${status}`,
    status,
    kind: "http",
    body: status === 403 ? { error: "Insufficient scope." } : `HTTP ${status}`,
    origin: "https://mastodon.example",
    method: "GET",
    path: "/api/v1/admin/measures",
  });
}

function accountWith(extras: Record<string, unknown>): Account {
  return {
    id: "1",
    username: "admin",
    acct: "admin",
    host: null,
    name: null,
    displayName: "admin",
    bio: { plain: "" },
    url: null,
    uri: null,
    avatarUrl: null,
    avatarBlurhash: null,
    headerUrl: null,
    headerBlurhash: null,
    followersCount: 0,
    followingCount: 0,
    statusesCount: 0,
    locked: false,
    bot: false,
    cat: false,
    silenced: false,
    suspended: false,
    onlineStatus: null,
    location: null,
    birthday: null,
    createdAt: null,
    updatedAt: null,
    lastFetchedAt: null,
    emojis: {},
    fields: [],
    movedTo: null,
    ffVisibility: null,
    pinnedPostIds: null,
    pinnedPosts: null,
    ext: { mastodon: extras },
  };
}

describe("admin capability keys (detect.ts)", () => {
  it("admin_read/admin_write are registered feature keys", () => {
    expect(FEATURE_KEYS).toContain("admin_read");
    expect(FEATURE_KEYS).toContain("admin_write");
  });

  it("every flavor defaults both admin flags to unknown (no role inference)", () => {
    for (const flavor of FLAVORS) {
      const caps = buildCapabilities(flavor);
      expect(caps.admin_read).toBe("unknown");
      expect(caps.admin_write).toBe("unknown");
    }
  });

  it("probe evidence never raises the admin flags (passthrough only)", () => {
    const caps = buildCapabilities("mastodon", {
      version: "4.4.0",
      pleromaBody: false,
      pleromaFeatures: ["quote_posting", "editing", "akkoma:machine_translation"],
      mastodonBody: true,
      translationAdvertised: true,
    });
    expect(caps.admin_read).toBe("unknown");
    expect(caps.admin_write).toBe("unknown");
    // …while genuine feature evidence still raises its own flags.
    expect(caps.translation).toBe("supported");
  });
});

describe("admin:read is a NOW scope (the read surface ships)", () => {
  it("SCOPES_NOW carries admin:read + admin:write (insight reads + queue mutations)", () => {
    expect(SCOPES_NOW).toContain("admin:read");
    expect(SCOPES_NOW).toContain("admin:write");
    expect(SCOPES_LATER).not.toContain("admin:read");
    expect(SCOPES_LATER).not.toContain("admin:write");
    expect(new Set(SCOPES_NOW).size).toBe(SCOPES_NOW.length);
    expect(new Set(SCOPES_LATER).size).toBe(SCOPES_LATER.length);
    for (const later of SCOPES_LATER) expect(SCOPES_NOW).not.toContain(later);
  });

  it("never requests read:conversations (not a real scope)", () => {
    expect(SCOPES_NOW).not.toContain("read:conversations");
    expect(SCOPES_LATER).toContain("read:conversations");
  });

  it("the Mastodon flavor string is the triple plus admin:read + admin:write (umbrella alone 403s admin endpoints)", () => {
    expect(SCOPES_MASTODON).toEqual(["read", "write", "follow"]);
    expect(scopesForFlavor("mastodon")).toEqual([
      "read",
      "write",
      "follow",
      "admin:read",
      "admin:write",
    ]);
    expect(scopesForFlavor("akkoma")).toEqual(SCOPES_NOW);
    expect(scopesForFlavor("pleroma")).toEqual(SCOPES_NOW);
    expect(scopesForFlavor("unknown")).toEqual(SCOPES_NOW);
  });
});

describe("admin measures/dimensions client", () => {
  it("posts {keys} to /api/v1/admin/measures and adapts the rows", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (method === "POST" && path === "/api/v1/admin/measures") {
        return {
          data: [
            {
              key: "active_users",
              unit: null,
              total: "120",
              human_value: "120",
              previous_total: "100",
              data: [{ date: "2026-10-21", value: "118" }],
            },
          ],
        };
      }
      throw new ApiError("unexpected", 500);
    });
    const measures = await fetchAdminMeasures(client, ["active_users"]);
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/admin/measures", body: { keys: ["active_users"] }, opts: undefined },
    ]);
    expect(measures).toEqual([
      {
        key: "active_users",
        unit: null,
        total: "120",
        humanValue: "120",
        previousTotal: "100",
        data: [{ date: "2026-10-21", value: "118" }],
      },
    ]);
  });

  it("posts {keys} to /api/v1/admin/dimensions and adapts the rows", async () => {
    const { client, calls } = stubClient(() => ({
      data: [{ key: "sources", data: [{ key: "web", human_key: "Website", value: "42" }] }],
    }));
    const dimensions = await fetchAdminDimensions(client, ["sources"]);
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/v1/admin/dimensions",
      body: { keys: ["sources"] },
      opts: undefined,
    });
    expect(dimensions).toEqual([
      { key: "sources", rows: [{ key: "web", label: "Website", value: "42" }] },
    ]);
  });

  it("a 403 surfaces as the typed permission error (disables the section, never clears the session)", async () => {
    const { client } = stubClient(() => httpError(403));
    const err = await fetchAdminMeasures(client, ["active_users"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect(isPermissionError(err)).toBe(true);
  });

  it("a 404 surfaces as the honest unsupported state (Akkoma has no /api/v1/admin/*)", async () => {
    const { client } = stubClient(() => httpError(404));
    const err = await fetchAdminDimensions(client, ["sources"]).catch((e: unknown) => e);
    expect(isUnsupportedError(err)).toBe(true);
    expect(isPermissionError(err)).toBe(false);
  });
});

describe("public fallbacks (no admin scope needed)", () => {
  it("peers parses the domain list, dropping non-strings", async () => {
    const { client, calls } = stubClient(() => ({ data: ["a.example", "b.example", 7, ""] }));
    await expect(fetchInstancePeers(client)).resolves.toEqual(["a.example", "b.example"]);
    expect(calls[0]?.path).toBe("/api/v1/instance/peers");
  });

  it("extended description parses updated_at + HTML content", async () => {
    const { client } = stubClient(() => ({
      data: { updated_at: "2026-10-01T00:00:00.000Z", content: "<p>Hello</p>" },
    }));
    await expect(fetchInstanceExtendedDescription(client)).resolves.toEqual({
      updatedAt: "2026-10-01T00:00:00.000Z",
      html: "<p>Hello</p>",
    });
  });

  it("activity parses the weekly rows", async () => {
    const { client } = stubClient(() => ({
      data: [{ week: "1729468800", statuses: "12", logins: "3", registrations: "1" }],
    }));
    await expect(fetchInstanceActivity(client)).resolves.toEqual([
      { week: "1729468800", statuses: "12", logins: "3", registrations: "1" },
    ]);
  });
});

describe("adminRoleOf (verify_credentials role at the backend/session layer)", () => {
  it("reads the Mastodon role verbatim", () => {
    expect(adminRoleOf(accountWith({ role: "admin" }))).toBe("admin");
    expect(adminRoleOf(accountWith({ role: "moderator" }))).toBe("moderator");
    expect(adminRoleOf(accountWith({ role: "user" }))).toBeNull();
  });

  it("reads Akkoma/Pleroma is_admin/is_moderator extras", () => {
    expect(adminRoleOf(accountWith({ pleroma: { is_admin: true } }))).toBe("admin");
    expect(adminRoleOf(accountWith({ pleroma: { is_admin: false, is_moderator: true } }))).toBe(
      "moderator",
    );
    expect(adminRoleOf(accountWith({ pleroma: {} }))).toBeNull();
  });

  it("null account (signed out) is null, never a guessed role", () => {
    expect(adminRoleOf(null)).toBeNull();
  });
});

describe("backend wires adminInsight", () => {
  it("every Mastodon-family flavor exposes the read-only module", () => {
    for (const flavor of ["mastodon", "akkoma", "pleroma", "unknown"] as const) {
      const { client } = stubClient(() => ({ data: [] }));
      const backend = createMastodonBackend(client, { flavor });
      expect(backend.adminInsight).toBeDefined();
      expect(typeof backend.adminInsight?.measures).toBe("function");
      expect(typeof backend.adminInsight?.dimensions).toBe("function");
      expect(typeof backend.adminInsight?.peers).toBe("function");
      expect(typeof backend.adminInsight?.extendedDescription).toBe("function");
      expect(typeof backend.adminInsight?.activity).toBe("function");
    }
  });

  it("measures through the backend surfaces 403 as the permission error", async () => {
    const { client } = stubClient(() => httpError(403));
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    const err = await backend.adminInsight!.measures(["active_users"]).catch((e: unknown) => e);
    expect(isPermissionError(err)).toBe(true);
  });
});
