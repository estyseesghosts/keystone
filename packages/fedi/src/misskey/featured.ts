// Pins / featured (§9). `i/pin|unpin` are own-note only (`PIN_LIMIT_EXCEEDED`
// / `ALREADY_PINNED` copy surfaces verbatim); Featured reads
// `pinnedNoteIds/pinnedNotes` from `users/show`, with `notes/featured` and
// `users/featured-notes` ranking views where the backend serves them.
// 404-gated throughout — the tab ships absent until the source exists.

import type { WireCall } from "./client";
import type { Note } from "./wire";

export const PIN_LIMIT = 5;

export async function pinNote(call: WireCall, noteId: string): Promise<void> {
  await call<undefined>("i/pin", { noteId });
}

export async function unpinNote(call: WireCall, noteId: string): Promise<void> {
  await call<undefined>("i/unpin", { noteId });
}

export async function listFeaturedNotes(
  call: WireCall,
  limit = 20,
  untilId?: string,
): Promise<Note[]> {
  return call<Note[]>("notes/featured", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
}

export async function listUserFeaturedNotes(
  call: WireCall,
  userId: string,
  limit = 20,
  untilId?: string,
): Promise<Note[]> {
  return call<Note[]>("users/featured-notes", {
    userId,
    limit,
    ...(untilId ? { untilId } : {}),
  });
}
