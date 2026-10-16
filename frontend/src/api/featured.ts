// Pins / featured (§9). `i/pin|unpin` are own-note only (`PIN_LIMIT_EXCEEDED`
// / `ALREADY_PINNED` copy surfaces verbatim); Featured reads
// `pinnedNoteIds/pinnedNotes` from `users/show`, with `notes/featured` and
// `users/featured-notes` ranking views where the backend serves them.
// 404-gated throughout — the tab ships absent until the source exists.

import { apiCall } from "./client";
import type { Note } from "./types";

export const PIN_LIMIT = 5;

export async function pinNote(noteId: string): Promise<void> {
  await apiCall<undefined>("i/pin", { noteId });
}

export async function unpinNote(noteId: string): Promise<void> {
  await apiCall<undefined>("i/unpin", { noteId });
}

export async function listFeaturedNotes(limit = 20, untilId?: string): Promise<Note[]> {
  return apiCall<Note[]>("notes/featured", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
}

export async function listUserFeaturedNotes(
  userId: string,
  limit = 20,
  untilId?: string,
): Promise<Note[]> {
  return apiCall<Note[]>("users/featured-notes", {
    userId,
    limit,
    ...(untilId ? { untilId } : {}),
  });
}
