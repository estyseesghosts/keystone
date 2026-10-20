// List membership (slice 4.4), Misskey family. `users/lists/list` packs each
// list's `userIds`; push/pull take `{listId, userId}`. 404-gated by callers.

import type { WireCall } from "./client";

interface ListRow {
  id: string;
  userIds?: string[];
}

export async function listsContaining(call: WireCall, userId: string): Promise<string[]> {
  const rows = await call<ListRow[]>("users/lists/list", {});
  return (rows ?? []).filter((l) => Array.isArray(l.userIds) && l.userIds.includes(userId)).map((l) => l.id);
}

export async function addToList(call: WireCall, listId: string, userId: string): Promise<void> {
  await call<undefined>("users/lists/push", { listId, userId });
}

export async function removeFromList(call: WireCall, listId: string, userId: string): Promise<void> {
  await call<undefined>("users/lists/pull", { listId, userId });
}
