// Personal note favorites (Misskey-family): the list (`i/favorites`) and
// removal (`notes/favorites/delete`). Adding a favorite is
// `notes/favorites/create`, called from the note menu. Scoped tokens need
// read:favorites to list and write:favorites to add or remove.
//
// Unverified against a live server (2026-10-17): wired for the owner's
// live-server test. Pinetree is not wired here.

import type { BookmarksApi } from "../core/backend";
import type { WireCall } from "./client";
import type { Note } from "./wire";
import { adaptNote, decodeCursor, pageOf } from "./adapt";

/** One favorite row: the favorite's own id is the paging cursor. */
export interface FavoriteRow {
  id: string;
  note: Note;
}

export const FAVORITES_PAGE = 20;

export async function listFavorites(
  call: WireCall,
  limit = FAVORITES_PAGE,
  untilId?: string,
): Promise<FavoriteRow[]> {
  return call<FavoriteRow[]>("i/favorites", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
}

export async function removeFavorite(call: WireCall, noteId: string): Promise<void> {
  await call<undefined>("notes/favorites/delete", { noteId });
}

export function createBookmarksApi(call: WireCall): BookmarksApi {
  const DEFAULT_LIMIT = 20;
  return {
    async list(opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const cursor = decodeCursor(opts.cursor ?? null);
      const rows = await listFavorites(call, limit, cursor.untilId);
      // Deleted/gone favorites pack no usable note: skip the row rather
      // than crashing in `adaptNote` (same `typeof id` guard as
      // `noteReactions`; the row itself carries no account). The cursor
      // stays the ROW id (`untilId` pages on the row, so `pageOf` runs on
      // the rows and the map happens after).
      const valid = (rows ?? []).filter((row) => typeof row?.note?.id === "string");
      return pageOf(valid, limit, (row) => ({
        id: row.id,
        post: adaptNote(row.note),
      }));
    },
    async add(noteId) {
      await call<undefined>("notes/favorites/create", { noteId });
    },
    async remove(noteId) {
      await removeFavorite(call, noteId);
    },
  };
}
