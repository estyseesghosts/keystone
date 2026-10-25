// List membership (slice 4.4), Misskey family. `users/lists/list` packs each
// list's `userIds`; push/pull take `{listId, userId}`. 404-gated by callers.

import type { ListsApi } from "../core/backend";
import type { Page, Post } from "../core/models";
import type { WireCall } from "./client";
import { decodeCursor } from "./adapt";

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

export function createListsApi(
  call: WireCall,
  callNotes: (endpoint: string, params: Record<string, unknown>) => Promise<Page<Post>>,
): ListsApi {
  const DEFAULT_LIMIT = 20;
  return {
    membership: {
      containing: (accountId) => listsContaining(call, accountId),
      add: (listId, accountId) => addToList(call, listId, accountId),
      remove: (listId, accountId) => removeFromList(call, listId, accountId),
    },
    async list() {
      const items = await call<Array<{ id: string; name: string }>>("lists/list", {});
      return items ?? [];
    },
    async timeline(listId, opts = {}) {
      return callNotes("notes/user-list-timeline", {
        listId,
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
    },
    // List CRUD (C15-data): `users/lists/create|update|delete` — the
    // packed UserList answers `{id, name, ...}`; only id+name surface.
    // `fields` (Mastodon replies_policy/exclusive) is intentionally
    // ignored: Misskey user lists have neither, and the capabilities table
    // reports both unsupported so the UI never offers them. Sending an
    // unknown param to Misskey is a 400 — never send it.
    async create(name, _fields = {}) {
      const row = await call<{ id: string; name: string }>("users/lists/create", { name });
      return { id: row.id, name: row.name ?? name };
    },
    async update(id, patch) {
      const row = await call<{ id: string; name: string }>("users/lists/update", {
        listId: id,
        name: patch.name,
      });
      return { id: row.id ?? id, name: row.name ?? patch.name };
    },
    async delete(id) {
      await call<undefined>("users/lists/delete", { listId: id });
    },
  };
}
