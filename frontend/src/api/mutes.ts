// Block / mute / renote-mute helpers + relation lookups (§0 groundwork).
// Every surface reuses these; callers 404-gate (unsupported backend hides
// the control, never an inert button). All wrappers are thin `apiCall`s —
// no local state, no optimism: state re-derives from `users/relation` or
// `users/show` after every write.

import { apiCall } from "./client";
import type { UserLite, UserRelation } from "./types";

export async function fetchRelations(userIds: string[]): Promise<UserRelation[]> {
  if (userIds.length === 0) return [];
  return apiCall<UserRelation[]>("users/relation", { userId: userIds });
}

export async function fetchRelation(userId: string): Promise<UserRelation | null> {
  const list = await fetchRelations([userId]);
  return list.find((r) => r.id === userId) ?? null;
}

export async function blockUser(userId: string): Promise<void> {
  await apiCall<undefined>("blocking/create", { userId });
}

export async function unblockUser(userId: string): Promise<void> {
  await apiCall<undefined>("blocking/delete", { userId });
}

export async function muteUser(userId: string): Promise<void> {
  await apiCall<undefined>("mute/create", { userId });
}

export async function unmuteUser(userId: string): Promise<void> {
  await apiCall<undefined>("mute/delete", { userId });
}

export async function muteRenotes(userId: string): Promise<void> {
  await apiCall<undefined>("renote-mute/create", { userId });
}

export async function unmuteRenotes(userId: string): Promise<void> {
  await apiCall<undefined>("renote-mute/delete", { userId });
}

export async function listBlocks(limit = 20, untilId?: string): Promise<UserLite[]> {
  return apiCall<UserLite[]>("blocking/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
}

export async function listMutes(limit = 20, untilId?: string): Promise<UserLite[]> {
  return apiCall<UserLite[]>("mute/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
}

export async function listRenoteMutes(limit = 20, untilId?: string): Promise<UserLite[]> {
  return apiCall<UserLite[]>("renote-mute/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
}
