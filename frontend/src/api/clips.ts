// Clips (Misskey-family): a user's named note collections. The note menu's
// Clip row lists the viewer's clips and adds the note to one
// (`clips/list`, `clips/add-note`). Scoped tokens need read:clips to list
// and write:clips to add.
//
// Unverified against a live server (2026-10-17): wired for the owner's
// live-server test. Pinetree is not wired here.

import { apiCall } from "./client";

export interface ClipSummary {
  id: string;
  name: string;
  isPublic?: boolean;
}

export async function listClips(): Promise<ClipSummary[]> {
  return apiCall<ClipSummary[]>("clips/list", { limit: 100 });
}

export async function addNoteToClip(clipId: string, noteId: string): Promise<void> {
  await apiCall<undefined>("clips/add-note", { clipId, noteId });
}
