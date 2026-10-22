// P6.3 slice 3.1 (Misskey side) — read-only server insight, no mutations.
//
// Pins the Misskey credential path before it exists:
// - `KEYSTONE_PERMISSIONS` gains exactly the three least-privilege admin
//   READ grants the insight endpoints' `kind` fields name
//   (`read:admin:server-info`, `read:admin:meta`, `read:admin:queue` —
//   exact-match checked in upstream `ApiCallService`; `get-online-users-
//   count` is public and needs no grant). Old tokens 403 → the existing
//   0.8 `notePermissionDenied` observer path (never a session clear).
// - The admin client posts `admin/server-info`, `admin/meta`,
//   `admin/queue/stats` with `{}` and `get-online-users-count`; adapts the
//   rows to domain models (secrets never surface); 403 is the typed
//   permission error, 404 the honest unsupported state.
// - `misskeyAdminRoleOf` reads the self `i` flags (`ext.me.isAdmin` /
//   `isModerator`) — never a guess.
// - The backend wires `adminInsight` on misskey/sharkey/catodon (all three
//   serve the four endpoints); pinetree serves none and leaves it off.
//
// No network: the transport is stubbed.

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { isPermissionError, isUnsupportedError, type WireCall } from "../src/misskey/client";
import { KEYSTONE_PERMISSIONS } from "../src/misskey/auth";
import {
  fetchInstanceMeta,
  fetchOnlineUsersCount,
  fetchQueueStats,
  fetchServerInfo,
  misskeyAdminRoleOf,
} from "../src/misskey/admin";
import { ApiError } from "../src/core/errors";
import type { Account } from "../src/core/models";

function stubCall(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { call: WireCall; calls: Array<{ endpoint: string; params: Record<string, unknown> }> } {
  const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];
  const call = (async <T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> => {
    calls.push({ endpoint, params });
    const out = respond(endpoint, params);
    if (out instanceof Error) throw out;
    return out as T;
  }) as WireCall;
  return { call, calls };
}

function stubTransport(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { transport: MisskeyTransport; calls: Array<{ endpoint: string; params: Record<string, unknown> }> } {
  const { call, calls } = stubCall(respond);
  const transport: MisskeyTransport = {
    call,
    upload: async () => {
      throw new Error("no uploads in this suite");
    },
  };
  return { transport, calls };
}

function accountWithMe(me: Record<string, unknown> | undefined): Account {
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
    ext: me === undefined ? {} : { me },
  };
}

describe("misskey admin permissions (least privilege)", () => {
  it("requests exactly the three admin READ grants the insight endpoints name", () => {
    for (const scope of ["read:admin:server-info", "read:admin:meta", "read:admin:queue"]) {
      expect(KEYSTONE_PERMISSIONS).toContain(scope);
    }
    expect(KEYSTONE_PERMISSIONS).not.toContain("admin:read");
    expect(KEYSTONE_PERMISSIONS).not.toContain("write:admin:meta");
  });
});

describe("misskey/admin client (read-only)", () => {
  it("fetchServerInfo posts admin/server-info with no params and adapts the snapshot", async () => {
    const { call, calls } = stubCall(() => ({
      machine: "host1",
      os: "linux",
      node: "v22.1.0",
      psql: "15.4",
      cpu: { model: "Xeon", cores: 8 },
      mem: { total: 17179869184 },
      fs: { total: 536870912000, used: 107374182400 },
      net: { interface: "eth0" },
    }));
    const info = await fetchServerInfo(call);
    expect(calls).toEqual([{ endpoint: "admin/server-info", params: {} }]);
    expect(info).toEqual({
      machine: "host1",
      os: "linux",
      node: "v22.1.0",
      psql: "15.4",
      cpu: { model: "Xeon", cores: 8 },
      memTotal: 17179869184,
      fsTotal: 536870912000,
      fsUsed: 107374182400,
    });
  });

  it("fetchInstanceMeta posts admin/meta and keeps only the display/policy subset", async () => {
    const { call, calls } = stubCall(() => ({
      name: "Example",
      shortName: "ex",
      description: "An instance",
      maintainerName: "Admin",
      maintainerEmail: "admin@example.com",
      version: "2025.1.0",
      uri: "example.com",
      disableRegistration: false,
      emailRequiredForSignup: true,
      smtpPass: "secret-must-not-surface",
      swPrivateKey: "secret-must-not-surface",
    }));
    const meta = await fetchInstanceMeta(call);
    expect(calls).toEqual([{ endpoint: "admin/meta", params: {} }]);
    expect(meta).toEqual({
      name: "Example",
      shortName: "ex",
      description: "An instance",
      maintainerName: "Admin",
      maintainerEmail: "admin@example.com",
      version: "2025.1.0",
      uri: "example.com",
      disableRegistration: false,
      emailRequiredForSignup: true,
    });
    expect(JSON.stringify(meta)).not.toContain("secret-must-not-surface");
  });

  it("fetchQueueStats posts admin/queue/stats and adapts the four queues", async () => {
    const { call, calls } = stubCall(() => ({
      deliver: { waiting: 3, active: 1, completed: 100, failed: 2, delayed: 0, paused: 0 },
      inbox: { waiting: 0, active: 0, completed: 50, failed: 0, delayed: 0, paused: 0 },
      db: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0, paused: 0 },
      objectStorage: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
    }));
    const stats = await fetchQueueStats(call);
    expect(calls).toEqual([{ endpoint: "admin/queue/stats", params: {} }]);
    expect(stats.deliver).toMatchObject({ waiting: 3, active: 1, failed: 2 });
    expect(stats.inbox).toMatchObject({ waiting: 0, completed: 50 });
    expect(Object.keys(stats).sort()).toEqual(["db", "deliver", "inbox", "objectStorage"]);
  });

  it("fetchOnlineUsersCount posts get-online-users-count and returns the count", async () => {
    const { call, calls } = stubCall(() => ({ count: 42 }));
    await expect(fetchOnlineUsersCount(call)).resolves.toBe(42);
    expect(calls).toEqual([{ endpoint: "get-online-users-count", params: {} }]);
  });

  it("a 403 on an admin call is the typed permission error (never a session clear)", async () => {
    const denied = new ApiError("Your app does not have the necessary permissions.", 403, "PERMISSION_DENIED");
    const { call } = stubCall(() => {
      throw denied;
    });
    const err = await fetchServerInfo(call).catch((e) => e);
    expect(isPermissionError(err)).toBe(true);
  });

  it("a 404 reads as unsupported (forks without the admin endpoints)", async () => {
    const missing = new ApiError("No such endpoint.", 404);
    const { call } = stubCall(() => {
      throw missing;
    });
    const err = await fetchQueueStats(call).catch((e) => e);
    expect(isUnsupportedError(err)).toBe(true);
    expect(isPermissionError(err)).toBe(false);
  });
});

describe("misskeyAdminRoleOf (self i flags, never a guess)", () => {
  it("reads isAdmin/isModerator from ext.me", () => {
    expect(misskeyAdminRoleOf(accountWithMe({ isAdmin: true, isModerator: false }))).toBe("admin");
    expect(misskeyAdminRoleOf(accountWithMe({ isAdmin: false, isModerator: true }))).toBe("moderator");
    expect(misskeyAdminRoleOf(accountWithMe({ isAdmin: false, isModerator: false }))).toBeNull();
  });

  it("admin wins when both flags are set; absent flags read null", () => {
    expect(misskeyAdminRoleOf(accountWithMe({ isAdmin: true, isModerator: true }))).toBe("admin");
    expect(misskeyAdminRoleOf(accountWithMe({}))).toBeNull();
    expect(misskeyAdminRoleOf(accountWithMe(undefined))).toBeNull();
    expect(misskeyAdminRoleOf(null)).toBeNull();
  });
});

describe("misskey backend adminInsight wiring", () => {
  const respond = (endpoint: string) => {
    switch (endpoint) {
      case "admin/server-info":
        return { machine: "m", os: "linux", node: "v22", psql: "15", cpu: { model: "c", cores: 1 }, mem: { total: 1 }, fs: { total: 2, used: 1 } };
      case "admin/meta":
        return { name: "n", version: "v", uri: "u" };
      case "admin/queue/stats":
        return { deliver: {}, inbox: {}, db: {}, objectStorage: {} };
      case "get-online-users-count":
        return { count: 7 };
      default:
        throw new ApiError("No such endpoint.", 404);
    }
  };

  it.each(["misskey", "sharkey", "catodon"] as const)("wires adminInsight on %s", async (flavor) => {
    const { transport } = stubTransport(respond);
    const backend = createMisskeyBackend(transport, flavor);
    expect(backend.adminInsight).toBeDefined();
    await expect(backend.adminInsight!.serverInfo!()).resolves.toMatchObject({ machine: "m" });
    await expect(backend.adminInsight!.instanceMeta!()).resolves.toMatchObject({ name: "n" });
    await expect(backend.adminInsight!.queueStats!()).resolves.toMatchObject({ deliver: expect.anything() });
    await expect(backend.adminInsight!.onlineUsersCount!()).resolves.toBe(7);
  });

  it("leaves adminInsight off on pinetree (no admin endpoints there)", () => {
    const { transport } = stubTransport(respond);
    const backend = createMisskeyBackend(transport, "pinetree");
    expect(backend.adminInsight).toBeUndefined();
  });
});
