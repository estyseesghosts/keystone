// Note-body building (Misskey family) — the single place `notes/create`,
// `notes/edit`, `notes/schedule/create` and `notes/drafts/*` bodies are
// built (D3.1: the four inline copies in `backend.ts` collapsed here).
//
// Omit-but-never-null (Sharkey 400s on null/empty fields): absent optionals
// stay off the wire. The one exception is edit, where cleared text/cw are
// sent as EXPLICIT nulls so the server clears them, `noQuote: false`
// is sent so an earlier per-note quote refusal can be lifted, and a
// KNOWN-empty `fileIds: []` / `poll: null` clears attachments/polls
// (unknown/unchanged stays omitted — explicit nulls only for known state).
//
// `replyId` / `renoteId` / `reactionAcceptance` are create-only: the edit
// endpoint never received them, so the edit builder leaves them off.

import type { PollDraft, PostDraft } from "../core/backend";
import type { EditNoteParams } from "./noteEdit";

/** Drop null/undefined entries from a body bag. Used by the moved Misskey
 * body builders only — not a repo-wide convention (the ~40 hand-rolled
 * omit sites elsewhere stay as they are). */
export function pickDefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (entry !== undefined && entry !== null) out[key] = entry;
  }
  return out;
}

/** Wire visibility for a draft: `raw` round-trips (an edited `home` post
 * is written back as `home`); a fresh compose maps `kind` (`quiet` →
 * `home`, `direct` → `specified`). */
export function wireVisibility(draft: PostDraft): string {
  if (draft.visibility?.raw) return draft.visibility.raw;
  switch (draft.visibility?.kind) {
    case "quiet":
      return "home";
    case "followers":
      return "followers";
    case "direct":
      return "specified";
    default:
      return "public";
  }
}

/** The exact create-shaped poll (`choices`, `multiple`, `expiredAfter`,
 * `expiresAt`). Absent optionals are omitted, never nulled. */
function pollBody(poll: PollDraft): PollDraft {
  return {
    choices: poll.choices,
    ...(poll.multiple != null ? { multiple: poll.multiple } : {}),
    ...(poll.expiredAfter != null ? { expiredAfter: poll.expiredAfter } : {}),
    ...(poll.expiresAt != null ? { expiresAt: poll.expiresAt } : {}),
  };
}

/** `notes/create` body (also `notes/schedule/create` and
 * `notes/drafts/*`, which add `scheduledAt` at the call site) — built
 * exactly as the Composer built it, including the empty-selection → null
 * reaction-acceptance mapping (never `""`). */
export function createNoteBody(draft: PostDraft): Record<string, unknown> {
  const visibility = wireVisibility(draft);
  const text = draft.text && draft.text.trim() ? draft.text.trim() : null;
  const cw = draft.cw && draft.cw.trim() ? draft.cw.trim() : null;
  return {
    visibility,
    ...pickDefined({ text, cw }),
    ...(visibility === "specified" && draft.visibleUserIds
      ? { visibleUserIds: draft.visibleUserIds }
      : {}),
    ...(draft.visibility?.localOnly ? { localOnly: true } : {}),
    ...(draft.replyId ? { replyId: draft.replyId } : {}),
    ...(draft.renoteId ? { renoteId: draft.renoteId } : {}),
    ...(draft.mediaIds && draft.mediaIds.length > 0 ? { fileIds: draft.mediaIds } : {}),
    // The Composer maps its empty selection to null (never ""); a value is
    // sent verbatim, unknown values included.
    ...(draft.reactionAcceptance != null ? { reactionAcceptance: draft.reactionAcceptance } : {}),
    ...(draft.noQuote ? { noQuote: true } : {}),
    ...(draft.poll ? { poll: pollBody(draft.poll) } : {}),
  };
}

/** `notes/edit` body: blank text/cw clear (explicit nulls); `noQuote`
 * forwards whatever the caller passes so `false` lifts a refusal.
 *
 * Explicit-null rule, consistent with text/cw: a field the caller KNOWS
 * is empty travels explicitly (`fileIds: []`, `poll: null`) so the server
 * clears attachments/polls instead of treating omission as "unchanged".
 * A field the caller does not know (`undefined` — unchanged/unknown) is
 * omitted, never nulled. A server-side rejection (notably a 4xx on a
 * poll edit) propagates from `editNote` — never silently dropped. */
export function createEditNoteBody(draft: PostDraft): EditNoteParams {
  const visibility = wireVisibility(draft);
  return {
    text: draft.text && draft.text.trim() ? draft.text.trim() : null,
    cw: draft.cw && draft.cw.trim() ? draft.cw.trim() : null,
    visibility,
    ...(visibility === "specified" && draft.visibleUserIds
      ? { visibleUserIds: draft.visibleUserIds }
      : {}),
    ...(draft.visibility?.localOnly ? { localOnly: true } : {}),
    // Known-empty (cleared media) sends `[]`; unknown/unchanged omits.
    ...(draft.mediaIds !== undefined ? { fileIds: draft.mediaIds } : {}),
    // Per-note quote refusal (create parity). Edit forwards the value the
    // caller carries, so `false` can lift an earlier refusal.
    ...(draft.noQuote !== undefined ? { noQuote: draft.noQuote } : {}),
    // Poll edits use the exact create shape. Explicit null clears the
    // poll; undefined (unknown/unchanged) omits it.
    ...(draft.poll !== undefined ? { poll: draft.poll == null ? null : pollBody(draft.poll) } : {}),
  };
}
