// WS-F MD1: real `notification_groups` envelopes adapt to grouped core
// rows. The fixture is SYNTHESISED from the Mastodon NotificationGroup
// entity shape (see fixtures/manifest.json) — it proves the mapping
// handles the documented shape, not that a live server emits it (no
// grouped-capable server on the rig; live Akkoma 404s the v2 endpoint
// and takes the flat fallback).

import { readFileSync } from "node:fs";
import { join } from "node:path";
// Jest port: `describe/it/expect` are globals (no vitest import).
import { adaptV2Notification } from "../src/mastodon/adapt";
import { createMastodonBackend } from "../src/mastodon/backend";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import { MastoHttpError } from "../src/mastodon/client";

function groupedEnvelope(): {
  accounts: Array<Record<string, unknown>>;
  statuses: Array<Record<string, unknown>>;
  notification_groups: Array<Record<string, unknown>>;
} {
  const raw = readFileSync(
    join(__dirname, "fixtures", "mastodon", "notification-grouped-v2.json"),
    "utf8",
  );
  return JSON.parse(raw) as {
    accounts: Array<Record<string, unknown>>;
    statuses: Array<Record<string, unknown>>;
    notification_groups: Array<Record<string, unknown>>;
  };
}

function maps(env: ReturnType<typeof groupedEnvelope>): {
  accounts: Map<string, Record<string, unknown>>;
  statuses: Map<string, Record<string, unknown>>;
} {
  const accounts = new Map<string, Record<string, unknown>>();
  for (const a of env.accounts) accounts.set(String(a.id), a);
  const statuses = new Map<string, Record<string, unknown>>();
  for (const s of env.statuses) statuses.set(String(s.id), s);
  return { accounts, statuses };
}

describe("adaptV2Notification (grouped envelopes)", () => {
  it("adapts a favourite group: key id, sampled actors, count, packed post", () => {
    const env = groupedEnvelope();
    const { accounts, statuses } = maps(env);
    const n = adaptV2Notification(env.notification_groups[0], accounts, statuses);
    expect(n.id).toBe("favourite-100");
    expect(n.kind).toBe("favourite");
    expect(n.rawType).toBe("favourite");
    expect(n.createdAt).toBe("2026-10-12T12:30:00.000Z");
    expect(n.actors.map((a) => a.id)).toEqual(["2", "3", "4"]);
    expect(n.actors.map((a) => a.account?.username)).toEqual(["alice", "bob", "carol"]);
    // The server count (12) exceeds the packed samples (3): preserved in
    // ext, never rounded into the actor list.
    expect(n.ext.groupedCount).toBe(12);
    expect(n.actors).toHaveLength(3);
    expect(n.post?.id).toBe("100");
    expect(n.read).toBeNull();
  });

  it("keeps unpacked samples as id-only actors, never invented profiles", () => {
    const env = groupedEnvelope();
    const { accounts, statuses } = maps(env);
    const n = adaptV2Notification(env.notification_groups[1], accounts, statuses);
    expect(n.id).toBe("follow-5");
    expect(n.kind).toBe("follow");
    expect(n.actors).toHaveLength(2);
    expect(n.actors[0].account?.username).toBe("dave");
    expect(n.actors[1]).toEqual({ id: "9", account: null, reaction: null });
    expect(n.post).toBeNull();
    expect(n.ext.groupedCount).toBe(2);
  });

  it("fans a group-packed uniform emoji out to every actor + the row", () => {
    const env = groupedEnvelope();
    const { accounts, statuses } = maps(env);
    const n = adaptV2Notification(env.notification_groups[2], accounts, statuses);
    expect(n.kind).toBe("reaction");
    expect(n.reaction).toBe("⭐");
    expect(n.actors.map((a) => a.reaction)).toEqual(["⭐", "⭐"]);
  });

  it("never fabricates reactions on core groups (no group emoji → null)", () => {
    const env = groupedEnvelope();
    const { accounts, statuses } = maps(env);
    const n = adaptV2Notification(env.notification_groups[0], accounts, statuses);
    expect(n.kind).toBe("favourite");
    expect(n.reaction).toBeNull();
    expect(n.actors.every((a) => a.reaction === null)).toBe(true);
  });

  it("maps unknown group types to kind unknown with rawType kept", () => {
    const env = groupedEnvelope();
    const { accounts, statuses } = maps(env);
    const n = adaptV2Notification(
      { ...env.notification_groups[0], type: "severed_relationships" },
      accounts,
      statuses,
    );
    expect(n.kind).toBe("unknown");
    expect(n.rawType).toBe("severed_relationships");
  });

  it("keeps a group row with no samples and no count (never dropped)", () => {
    const env = groupedEnvelope();
    const { accounts, statuses } = maps(env);
    const n = adaptV2Notification(
      {
        group_key: "mention-x",
        type: "mention",
        latest_page_notification_at: "2026-10-12T12:00:00.000Z",
      },
      accounts,
      statuses,
    );
    expect(n.id).toBe("mention-x");
    expect(n.kind).toBe("mention");
    expect(n.actors).toEqual([]);
    expect(n.post).toBeNull();
    expect(n.ext).toEqual({});
  });

  it("still adapts legacy flat rows (account_id + packed status)", () => {
    const env = groupedEnvelope();
    const { accounts } = maps(env);
    const n = adaptV2Notification(
      {
        id: "301",
        type: "pleroma:emoji_reaction",
        created_at: "2026-10-12T12:31:00.000Z",
        account_id: "2",
        emoji: "❤",
        status: env.statuses[0],
      },
      accounts,
    );
    expect(n.id).toBe("301");
    expect(n.kind).toBe("reaction");
    expect(n.reaction).toBe("❤");
    expect(n.actors.map((a) => a.id)).toEqual(["2"]);
    expect(n.post?.id).toBe("100");
  });

  it("flat rows without a packed account carry no actor (existing rule)", () => {
    const n = adaptV2Notification(
      { id: "302", type: "follow", created_at: "2026-10-12T12:32:00.000Z" },
      new Map(),
    );
    expect(n.actors).toEqual([]);
    expect(n.id).toBe("302");
  });

  it("a flat row without created_at reads null, never a fresh timestamp", () => {
    // Against the old `new Date().toISOString()` fallback this is a string
    // stamped "now"; honest absence is null (ADR 0007).
    const n = adaptV2Notification({ id: "303", type: "follow", account_id: "2" }, new Map());
    expect(n.createdAt).toBeNull();
  });

  it("a group row without latest_page_notification_at reads null, never now", () => {
    const n = adaptV2Notification(
      { group_key: "mention-y", type: "mention", sample_account_ids: [] },
      new Map(),
      new Map(),
    );
    expect(n.id).toBe("mention-y");
    expect(n.createdAt).toBeNull();
  });

  it("malformed envelope rows degrade like absent rows, never throw", () => {
    const env = groupedEnvelope();
    const { accounts, statuses } = maps(env);
    // Packed but unusable: an account row without `acct`, a status row
    // without a packed `account`. Both degrade exactly like rows the
    // envelope never packed (id-only actor, null post).
    accounts.set("8", { id: "8" });
    statuses.set("101", { id: "101" });
    const n = adaptV2Notification(
      {
        group_key: "mention-z",
        type: "mention",
        sample_account_ids: ["8"],
        status_id: "101",
      },
      accounts,
      statuses,
    );
    expect(n.actors).toEqual([{ id: "8", account: null, reaction: null }]);
    expect(n.post).toBeNull();
    // Same rule on the flat path: the packed account still adapts, the
    // account-less status reads null instead of throwing.
    const flat = adaptV2Notification(
      { id: "304", type: "mention", account_id: "2", status: { id: "broken" } },
      accounts,
    );
    expect(flat.actors.map((a) => a.id)).toEqual(["2"]);
    expect(flat.post).toBeNull();
  });
});

function httpError(status: number): MastoHttpError {
  return new MastoHttpError({
    message: `HTTP ${status}`,
    status,
    kind: "http",
    origin: "https://mastodon.example",
  });
}

interface DismissCall {
  method: string;
  path: string;
  body?: unknown;
}

// X4.1: grouped dismiss routing. The backend tries the v1 dismiss first
// (flat rows succeed there and never touch v2) and falls through to the
// v2 group DELETE only on absence (404/405) — the grouped rows the v1
// route cannot dismiss. Auth, timeout and 5xx errors never fall through.
function dismissStub(respond: (method: string, path: string) => { data?: unknown } | void): {
  client: MastoClient;
  calls: DismissCall[];
} {
  const calls: DismissCall[] = [];
  const run = async <T>(method: string, path: string, body?: unknown): Promise<RequestResult<T>> => {
    calls.push({ method, path, body });
    const out = respond(method, path);
    return { status: 200, data: out?.data as T | undefined, headers: new Headers() };
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
    patchFormData: (path, body, _o) => run("PATCH", path, body),
  };
  return { client, calls };
}

describe("dismissNotification (v1 for flat rows, v2 fallback for groups)", () => {
  it("dismisses a flat row with the v1 route only (no v2 call)", async () => {
    const { client, calls } = dismissStub(() => ({ data: {} }));
    const backend = createMastodonBackend(client);
    await backend.dismissNotification!("301");
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/notifications/301/dismiss", body: undefined },
    ]);
  });

  it("dismisses a grouped row through the v2 group route after the v1 404", async () => {
    const { client, calls } = dismissStub((method) => {
      if (method === "POST") throw httpError(404);
      return { data: {} };
    });
    const backend = createMastodonBackend(client);
    await backend.dismissNotification!("favourite-100");
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/notifications/favourite-100/dismiss", body: undefined },
      { method: "DELETE", path: "/api/v2/notifications/favourite-100", body: undefined },
    ]);
  });

  it("encodes the group key on both routes instead of parsing it", async () => {
    const { client, calls } = dismissStub((method) => {
      if (method === "POST") throw httpError(404);
      return { data: {} };
    });
    const backend = createMastodonBackend(client);
    await backend.dismissNotification!("favourite-100/200 c");
    expect(calls[0].path).toBe("/api/v1/notifications/favourite-100%2F200%20c/dismiss");
    expect(calls[1]).toEqual({
      method: "DELETE",
      path: "/api/v2/notifications/favourite-100%2F200%20c",
      body: undefined,
    });
  });

  it("a 404 from both routes surfaces already-gone (never silent success)", async () => {
    const { client, calls } = dismissStub(() => {
      throw httpError(404);
    });
    const backend = createMastodonBackend(client);
    await expect(backend.dismissNotification!("favourite-100")).rejects.toMatchObject({
      status: 404,
    });
    expect(calls).toHaveLength(2);
  });

  it("never falls back on auth failures (401 rethrows, no v2 call)", async () => {
    const { client, calls } = dismissStub(() => {
      throw httpError(401);
    });
    const backend = createMastodonBackend(client);
    await expect(backend.dismissNotification!("301")).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });

  it("never falls back on server errors (500 rethrows, no v2 call)", async () => {
    const { client, calls } = dismissStub(() => {
      throw httpError(500);
    });
    const backend = createMastodonBackend(client);
    await expect(backend.dismissNotification!("301")).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
  });
});

describe("adaptV2Notification (X4.1 wire types)", () => {
  it("maps `status` to the existing `note` kind (actor + new post kept)", () => {
    const env = groupedEnvelope();
    const { accounts } = maps(env);
    const n = adaptV2Notification(
      {
        id: "401",
        type: "status",
        created_at: "2026-10-12T12:40:00.000Z",
        account_id: "2",
        status: env.statuses[0],
      },
      accounts,
    );
    expect(n.kind).toBe("note");
    expect(n.rawType).toBe("status");
    expect(n.actors.map((a) => a.id)).toEqual(["2"]);
    expect(n.post?.id).toBe("100");
  });

  it("leaves newer/account-less wire types as unknown with rawType kept (no invented kind)", () => {
    for (const type of [
      "update",
      "quoted_update",
      "admin.sign_up",
      "admin.report",
      "severed_relationships",
      "moderation_warning",
      "move",
    ]) {
      const n = adaptV2Notification(
        {
          group_key: "g-1",
          type,
          latest_page_notification_at: "2026-10-12T12:00:00.000Z",
        },
        new Map(),
        new Map(),
      );
      expect(n.kind).toBe("unknown");
      expect(n.rawType).toBe(type);
      expect(n.actors).toEqual([]);
    }
  });
});
