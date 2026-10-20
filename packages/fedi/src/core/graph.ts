// Social-graph pure logic (slice 4.4): optimistic relationship reducers,
// follow-button state, capability/relationship gates, and the client-side
// soft-mute list (per session, over an injected KeyValueStore).

import type { Relationship, Account } from "./models";
import type { Capabilities } from "./detect";
import type { KeyValueStore } from "./sessions";

export type GraphKind = "follow" | "mute" | "block";

/** Desired follow state: what the viewer wants the edge to be. */
export type FollowDesired = "following" | "none";

/** Apply the optimistic effect of a desired value to a relationship.
 * Following a locked account becomes a pending request, not a follow. */
export function applyFollowDesired(
  rel: Relationship,
  desired: FollowDesired,
  accountLocked: boolean,
): Relationship {
  if (desired === "following") {
    return accountLocked
      ? { ...rel, isFollowing: false, hasPendingFollowRequestFromYou: true }
      : { ...rel, isFollowing: true, hasPendingFollowRequestFromYou: false };
  }
  return { ...rel, isFollowing: false, hasPendingFollowRequestFromYou: false };
}

export function followDesiredOf(rel: Relationship): FollowDesired {
  return rel.isFollowing || rel.hasPendingFollowRequestFromYou ? "following" : "none";
}

export function applyMuted(rel: Relationship, muted: boolean): Relationship {
  return { ...rel, isMuted: muted };
}

/** Blocking severs the follow edges in both directions' viewer side. */
export function applyBlocked(rel: Relationship, blocked: boolean): Relationship {
  return blocked
    ? { ...rel, isBlocking: true, isFollowing: false, hasPendingFollowRequestFromYou: false }
    : { ...rel, isBlocking: false };
}

export type FollowButtonState =
  | "follow"
  | "following"
  | "requested"
  | "follow_back"
  | "blocked"
  | "unblock";

export function followButtonState(rel: Relationship | null): FollowButtonState {
  if (rel?.isBlocking) return "unblock";
  if (rel?.isBlocked) return "blocked";
  if (rel?.isFollowing) return "following";
  if (rel?.hasPendingFollowRequestFromYou) return "requested";
  if (rel?.isFollowed) return "follow_back";
  return "follow";
}

export type GraphGate =
  | { enabled: true }
  | { enabled: false; reason: string; reasonCode: string };

const off = (reasonCode: string, reason: string): GraphGate => ({ enabled: false, reason, reasonCode });

export interface GraphGateInput {
  capabilities: Capabilities | null | undefined;
  /** The viewer's own account id, to refuse acting on yourself. */
  selfId?: string | null;
  targetId: string;
  /** The target blocks the viewer (follow is impossible). */
  blockedByTarget?: boolean;
}

export type GraphActionKind = GraphKind | "list" | "soft_mute" | "follow_request";

export function gateGraph(kind: GraphActionKind, input: GraphGateInput): GraphGate {
  if (!input.capabilities) return off("gate.noSession", "Sign in to do this.");
  if (input.selfId && input.selfId === input.targetId && kind !== "soft_mute") {
    return off("gate.self", "You cannot do this to your own account.");
  }
  switch (kind) {
    case "follow":
      return input.blockedByTarget ? off("gate.blockedByTarget", "This account has blocked you.") : { enabled: true };
    case "list":
      return input.capabilities.lists === "supported"
        ? { enabled: true }
        : off("gate.noLists", "This server does not support lists.");
    default:
      return { enabled: true };
  }
}

// --- Soft mute (client-side) ----------------------------------------------

export const SOFT_MUTE_KEY_PREFIX = "keystone.softmute.";

export function softMuteKeyFor(sessionId: string): string {
  if (!sessionId) throw new Error("softMuteKeyFor requires a sessionId");
  return `${SOFT_MUTE_KEY_PREFIX}${sessionId}`;
}

export function readSoftMutes(store: KeyValueStore, sessionId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(softMuteKeyFor(sessionId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((x): x is string => typeof x === "string" && x.length > 0))];
  } catch {
    return [];
  }
}

export function writeSoftMute(store: KeyValueStore, sessionId: string, accountId: string, muted: boolean): string[] {
  const current = readSoftMutes(store, sessionId).filter((id) => id !== accountId);
  const next = muted ? [...current, accountId] : current;
  store.setItem(softMuteKeyFor(sessionId), JSON.stringify(next));
  return next;
}

export function isSoftMuted(store: KeyValueStore, sessionId: string, account: Pick<Account, "id">): boolean {
  return readSoftMutes(store, sessionId).includes(account.id);
}
