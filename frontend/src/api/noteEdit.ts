// Note edit + delete-and-redraft (§10). Delete exists; true edit waits on
// backend `notes/edit` (Sharkey shape + federated Update(Note)). This module
// owns both paths: `editNote` attempts the server edit (throws 404 when the
// backend has no edit — the UI then offers redraft instead), and
// `redraftPayload` copies a note into composer state (reply/renote context
// preserved) for the delete-and-edit flow with its data-loss warning.

import { apiCall } from "./client";
import type { CreateNoteParams, Note } from "./types";

export interface EditNoteParams {
  text?: string | null;
  cw?: string | null;
  visibility?: CreateNoteParams["visibility"];
  visibleUserIds?: string[];
  localOnly?: boolean;
  fileIds?: string[];
}

export async function editNote(noteId: string, params: EditNoteParams): Promise<Note> {
  return apiCall<Note>("notes/edit", { noteId, ...params });
}

export interface RedraftSeed {
  text: string;
  cw: string;
  visibility: NonNullable<CreateNoteParams["visibility"]>;
  localOnly: boolean;
  replyId?: string;
  renoteId?: string;
  fileIds: string[];
}

/** Copy a note into composer seed state (reply/renote context preserved).
 * Pure — the caller posts via the normal composer, then deletes. */
export function redraftPayload(note: Note): RedraftSeed {
  return {
    text: note.text ?? "",
    cw: note.cw ?? "",
    visibility: note.visibility,
    localOnly: note.localOnly,
    ...(note.replyId ? { replyId: note.replyId } : {}),
    ...(note.renoteId ? { renoteId: note.renoteId } : {}),
    fileIds: [...(note.fileIds ?? [])],
  };
}

export const REDRAFT_WARNING =
  "Deleting removes its reactions, reposts, and replies. They cannot be restored.";
