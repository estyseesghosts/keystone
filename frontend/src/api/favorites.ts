// Personal note favorites (Misskey-family): the list (`i/favorites`) and
// removal (`notes/favorites/delete`). Adding a favorite is
// `notes/favorites/create`, called from the note menu. Scoped tokens need
// read:favorites to list and write:favorites to add or remove.
//
// Unverified against a live server (2026-10-17): wired for the owner's
// live-server test. Pinetree is not wired here.

import { apiCall } from "./client";
import type { Note } from "./types";

/** One favorite row: the favorite's own id is the paging cursor. */
export interface FavoriteRow {
  id: string;
  note: Note;
}

export const FAVORITES_PAGE = 20;

export async function listFavorites(untilId?: string): Promise<FavoriteRow[]> {
  return apiCall<FavoriteRow[]>("i/favorites", {
    limit: FAVORITES_PAGE,
    ...(untilId ? { untilId } : {}),
  });
}

export async function removeFavorite(noteId: string): Promise<void> {
  await apiCall<undefined>("notes/favorites/delete", { noteId });
}
