// Block / mute / renote-mute helpers + relation lookups (§0 groundwork).
// Every surface reuses these; callers 404-gate (unsupported backend hides
// the control, never an inert button). All wrappers take an explicit `WireCall` —
// no local state, no optimism: state re-derives from `users/relation` or
// `users/show` after every write.

import type { WireCall } from "./client";
import { adaptAccount, adaptUserRelation } from "./adapt";
import type { UserLite, UserRelation } from "./wire";
import type { Account, Relationship } from "../core/models";

export async function fetchRelations(call: WireCall, userIds: string[]): Promise<Relationship[]> {
  if (userIds.length === 0) return [];
  const rels = await call<UserRelation[]>("users/relation", { userId: userIds });
  return (rels ?? []).map(adaptUserRelation);
}

export async function fetchRelation(call: WireCall, userId: string): Promise<Relationship | null> {
  const list = await fetchRelations(call, [userId]);
  return list.find((r) => r.id === userId) ?? null;
}

export async function blockUser(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("blocking/create", { userId });
}

export async function unblockUser(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("blocking/delete", { userId });
}

export async function muteUser(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("mute/create", { userId });
}

export async function unmuteUser(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("mute/delete", { userId });
}

export async function muteRenotes(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("renote-mute/create", { userId });
}

export async function unmuteRenotes(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("renote-mute/delete", { userId });
}

export async function listBlocks(call: WireCall, limit = 20, untilId?: string): Promise<Account[]> {
  const users = await call<UserLite[]>("blocking/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
  return (users ?? []).map(adaptAccount);
}

export async function listMutes(call: WireCall, limit = 20, untilId?: string): Promise<Account[]> {
  const users = await call<UserLite[]>("mute/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
  return (users ?? []).map(adaptAccount);
}

export async function listRenoteMutes(call: WireCall, limit = 20, untilId?: string): Promise<Account[]> {
  const users = await call<UserLite[]>("renote-mute/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
  return (users ?? []).map(adaptAccount);
}
