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
});
