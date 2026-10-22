// Note edit + delete-and-redraft (§10). Delete exists; true edit waits on
// backend `notes/edit` (Sharkey shape + federated Update(Note)). This module
// owns both paths: `editNote` attempts the server edit (throws 404 when the
// backend has no edit — the UI then offers redraft instead), and
// `redraftPayload` copies a note into composer state (reply/renote context
// preserved) for the delete-and-edit flow with its data-loss warning.

import type { Note } from "./wire";
import type { PollDraft } from "../core/backend";
import type { Post } from "../core/models";
import { adaptNote } from "./adapt";
import type { WireCall } from "./client";

/** The edit body mirrors `notes/create` for the fields the composer can
 * change: text/cw (explicit nulls clear), visibility, recipients,
 * local-only, attachments, per-note quote refusal and the poll shape.
 *
 * `noQuote`: unlike create (which omits the field when false), edit sends
 * whatever the caller passes, so an explicit `false` can un-refuse quotes.
 *
 * `poll`: the exact create shape (`choices`, `multiple`, `expiredAfter`,
 * `expiresAt`). Upstream 4xx responses for poll edits are NOT swallowed
 * here — the typed `ApiError` reaches the caller so the UI can say the
 * poll could not be changed instead of pretending the edit landed. */
export interface EditNoteParams {
  text?: string | null;
  cw?: string | null;
  /** Wire visibility verbatim (`public`/`home`/`followers`/`specified`). */
  visibility?: string;
  visibleUserIds?: string[];
  localOnly?: boolean;
  fileIds?: string[];
  noQuote?: boolean;
  poll?: PollDraft | null;
}

/** Server-side edit (`notes/edit`). Throws 404 where the backend has no
 * edit — the UI then offers delete-and-redraft instead. Every other
 * rejection (notably a 4xx on a poll edit) propagates untouched. */
export async function editNote(
  call: WireCall,
  noteId: string,
  params: EditNoteParams,
): Promise<Post> {
  return adaptNote(await call<Note>("notes/edit", { noteId, ...params }));
}

export interface RedraftSeed {
  text: string;
  cw: string;
  /** Wire visibility verbatim — round-trips `home` unchanged. */
  visibility: string;
  localOnly: boolean;
  replyId?: string;
  renoteId?: string;
  fileIds: string[];
}

/** Copy a post into composer seed state (reply/renote context preserved).
 * Pure — the caller posts via the normal composer, then deletes. */
export function redraftPayload(post: Post): RedraftSeed {
  return {
    text: post.content.mfm ?? "",
    cw: post.cw ?? "",
    visibility: post.visibility.raw,
    localOnly: post.visibility.localOnly,
    ...(post.replyToId ? { replyId: post.replyToId } : {}),
    ...(post.renoteId ? { renoteId: post.renoteId } : {}),
    fileIds: [...(post.mediaIds ?? [])],
  };
}

export const REDRAFT_WARNING =
  "Deleting removes its reactions, reposts, and replies. They cannot be restored.";

/** Stable key for the delete-and-redraft data-loss warning, resolved at
 * render time by the UI. The English `REDRAFT_WARNING` const stays as the
 * fallback. */
export const REDRAFT_WARNING_KEY = "notice.redraftWarning";
