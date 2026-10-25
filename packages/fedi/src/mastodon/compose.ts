// Text-only status composition on the Mastodon transport (Phase 4 Slice 2).
// The pure parts live here so the offline smoke can check them without a
// server: body building (Mastodon-documented fields only), the audience rules,
// the per-attempt Idempotency-Key, and mapping of legacy drafts. The network
// call is `createStatus` in statusActions.ts.
//
// Not offered in this slice: media (Slice 3), polls, scheduling and edits
// (Slice 4), Akkoma's `local` audience (detected-only, never chosen here).

import type { Visibility } from "../core/models";
import { randomBytes } from "../core/random";

/** The audiences this composer offers. `local` is Akkoma-only and is never
 * sent; a reply to a `local` post defaults to `unlisted` (see below). */
export type ComposeVisibility = "public" | "unlisted" | "private" | "direct";

export const COMPOSE_VISIBILITIES: readonly ComposeVisibility[] = [
  "public",
  "unlisted",
  "private",
  "direct",
];

/** Used when the instance does not advertise its own limit. */
export const FALLBACK_CHAR_LIMIT = 3000;

export function isComposeVisibility(value: string): value is ComposeVisibility {
  return (COMPOSE_VISIBILITIES as readonly string[]).includes(value);
}

/** A reply starts at the parent's audience, so a reply never widens it.
 * Akkoma's `local` has no offered equivalent, so it narrows to `unlisted`.
 * The wire `raw` is the source of truth; the normalized kind is the
 * fallback when `raw` is not one of this composer's audiences. */
export function replyVisibilityFor(parent: Visibility): ComposeVisibility {
  if (parent.raw === "local") return "unlisted";
  if (isComposeVisibility(parent.raw)) return parent.raw;
  switch (parent.kind) {
    case "public":
      return "public";
    case "quiet":
      return "unlisted";
    case "followers":
      return "private";
    default:
      return "direct";
  }
}

/** Mastodon and Akkoma refuse to quote private or direct posts. */
export function canQuoteVisibility(value: Visibility): boolean {
  return (
    value.raw === "public" || value.raw === "unlisted" || value.raw === "local"
  );
}

/** Old Misskey drafts stored `home`, `followers`, `specified`. Map them to the
 * nearest Mastodon audience, never wider. Unknown values become `private`. */
export function legacyVisibility(raw: string): ComposeVisibility {
  if (isComposeVisibility(raw)) return raw;
  switch (raw) {
    case "local":
    case "home":
      return "unlisted";
    case "followers":
      return "private";
    case "specified":
      return "direct";
    default:
      return "private";
  }
}

/** The JSON body for `POST /api/v1/statuses` (contract §1) and `PUT
 * /api/v1/statuses/:id` (contract §4). `spoiler_text` alone carries a
 * content warning (Mastodon treats a non-empty spoiler as sensitive).
 * `visibility` is the WIRE value (see `wireVisibilityOf` — raw
 * round-trips). `sensitive`/`language` ride only when the draft set them
 * (repair X4.4 finding 11; the composer toggle is X6.2). */
export interface StatusBody {
  status: string;
  visibility: string;
  spoiler_text?: string;
  in_reply_to_id?: string;
  quoted_status_id?: string;
  media_ids?: string[];
  sensitive?: boolean;
  language?: string;
  poll?: { options: string[]; multiple?: boolean; expires_in?: number; hide_totals?: boolean };
}

// --- Unified-draft → wire body (Phase 3: the MastodonBackend compose path) --

/** MastoAPI visibility values this transport round-trips (contract §6 —
 * `local` is Akkoma's extra and is only ever written back, never chosen
 * fresh). */
export const KNOWN_WIRE_VISIBILITIES: readonly string[] = [
  "public",
  "unlisted",
  "local",
  "private",
  "direct",
];

/** Core `PostDraft.visibility` → the wire value. `raw` round-trips when it
 * is a known MastoAPI value (plan §2.1 — a `local` post is edited as
 * `local`); otherwise the normalized kind maps and is never wider:
 * quiet → unlisted, followers → private, direct → direct. */
export function wireVisibilityOf(draft: {
  visibility?: { kind: string; localOnly: boolean; raw?: string };
}): string {
  const raw = draft.visibility?.raw;
  if (raw && (KNOWN_WIRE_VISIBILITIES as readonly string[]).includes(raw)) return raw;
  switch (draft.visibility?.kind) {
    case "quiet":
      return "unlisted";
    case "followers":
      return "private";
    case "direct":
      return "direct";
    default:
      return "public";
  }
}

/** The `POST/PUT /api/v1/statuses` body from a core `PostDraft` (contract
 * §7 field map: text→status, cw→spoiler_text, replyId→in_reply_to_id,
 * renoteId→quoted_status_id, mediaIds→media_ids). `visibleUserIds`/
 * `specified` has NO drop-in mapping (contract §7) and is never sent.
 * Built exactly like the Misskey family's `createNoteBody`: only fields
 * with values ride along. */
export function statusBodyOf(draft: {
  text?: string | null;
  cw?: string | null;
  visibility?: { kind: string; localOnly: boolean; raw?: string };
  replyId?: string;
  renoteId?: string;
  mediaIds?: string[];
  sensitive?: boolean;
  language?: string;
  poll?: { choices: string[]; multiple?: boolean; expiresAt?: number; expiredAfter?: number; hideTotals?: boolean } | null;
}): StatusBody {
  const body: StatusBody = {
    status: (draft.text ?? "").trim(),
    visibility: wireVisibilityOf(draft),
  };
  const cw = (draft.cw ?? "").trim();
  if (cw.length > 0) body.spoiler_text = cw;
  if (draft.replyId) body.in_reply_to_id = draft.replyId;
  if (draft.renoteId) body.quoted_status_id = draft.renoteId;
  if (draft.mediaIds && draft.mediaIds.length > 0) body.media_ids = draft.mediaIds;
  // Status-level sensitivity/language (finding 11): only when the draft
  // set them — absent keeps the server default, never a guess.
  if (draft.sensitive !== undefined) body.sensitive = draft.sensitive;
  if (draft.language !== undefined && draft.language.length > 0) body.language = draft.language;
  if (draft.poll && draft.poll.choices.length > 0) {
    // Mastodon rejects `poll[expires_in]` below 300 s, and 0 is never
    // valid — clamp at the wire layer (finding 22). The domain layer
    // (`buildPostDraft`) clamps first and the composer UI validates with
    // a translated message; this is the backstop for any other caller,
    // whichever expiry shape the draft carries.
    const raw =
      draft.poll.expiredAfter ??
      (draft.poll.expiresAt != null
        ? Math.max(0, Math.round((draft.poll.expiresAt - Date.now()) / 1000))
        : undefined);
    const expires = raw != null ? Math.max(300, raw) : undefined;
    body.poll = {
      options: draft.poll.choices,
      ...(draft.poll.multiple != null ? { multiple: draft.poll.multiple } : {}),
      ...(expires != null ? { expires_in: expires } : {}),
      // `true` only (clickstone §1.6): an omitted field keeps the server
      // default, and the composer gate decides whether it may be sent.
      ...(draft.poll.hideTotals === true ? { hide_totals: true } : {}),
    };
  }
  return body;
}

/** 32 lowercase hex characters from the platform CSPRNG. `crypto.randomUUID`
 * is avoided on purpose: it is missing in some insecure (LAN http) contexts,
 * while `getRandomValues` is available in all of them. Throws a typed
 * `FediError('errors.crypto.unavailable')` when no CSPRNG exists — never
 * `Math.random`. */
export function newIdempotencyKey(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** One Idempotency-Key per logical post attempt (contract §1). A retry of the
 * same body (after a dropped response, say) reuses the key so the server can
 * dedupe; any change to the body starts a new attempt. */
export interface AttemptKey {
  fingerprint: string;
  key: string;
}

export function attemptKeyFor(
  prev: AttemptKey | null,
  body: StatusBody,
  makeKey: () => string = newIdempotencyKey,
): AttemptKey {
  const fingerprint = JSON.stringify(body);
  if (prev !== null && prev.fingerprint === fingerprint) return prev;
  return { fingerprint, key: makeKey() };
}

/** Retry stability without touching the backend (X2.1): one key per body
 * fingerprint for five minutes. The backend still mints per call today;
 * the composer-side caller (X6.2) resolves the key through here so a
 * timeout followed by a retry sends the SAME `Idempotency-Key` and the
 * server dedupes instead of double-posting. */
export const STABLE_ATTEMPT_KEY_TTL_MS = 5 * 60 * 1000;

const stableAttemptKeys = new Map<string, { key: string; expiresAt: number }>();

/** Key for `fingerprint` (usually `JSON.stringify(body)`): the cached key
 * when the same fingerprint recurs inside the TTL, a fresh key otherwise.
 * Any change to the body is a new fingerprint, hence a new attempt. Throws
 * without a CSPRNG. Callers spanning sessions prefix the session id into
 * the fingerprint. */
export function stableIdempotencyKey(fingerprint: string, now: number = Date.now()): string {
  const hit = stableAttemptKeys.get(fingerprint);
  if (hit && hit.expiresAt > now) return hit.key;
  if (stableAttemptKeys.size > 500) {
    for (const [k, v] of stableAttemptKeys) {
      if (v.expiresAt <= now) stableAttemptKeys.delete(k);
    }
  }
  const key = newIdempotencyKey();
  stableAttemptKeys.set(fingerprint, { key, expiresAt: now + STABLE_ATTEMPT_KEY_TTL_MS });
  return key;
}

/** `AttemptKey` for a wire body: same body within the TTL reuses its key;
 * any change mints a new attempt. */
export function attemptKeyForBody(body: StatusBody, now?: number): AttemptKey {
  const fingerprint = JSON.stringify(body);
  return { fingerprint, key: stableIdempotencyKey(fingerprint, now) };
}

/** Test-only: drop the stable-key cache. */
export function clearStableIdempotencyKeys(): void {
  stableAttemptKeys.clear();
}

/** Fields a legacy Misskey draft can carry that this composer cannot send.
 * Restoring such a draft keeps it in the list instead of deleting it. */
export interface LegacyDraftFields {
  fileIds?: string[];
  attachedFiles?: unknown[];
  poll?: unknown;
  scheduledAt?: string | null;
  recipientIds?: string[];
  recipients?: unknown[];
  localOnly?: boolean;
  reactionAcceptance?: unknown;
  noQuote?: boolean;
  replyId?: string;
  renoteId?: string;
}

export function unsupportedDraftParts(draft: LegacyDraftFields): string[] {
  const parts: string[] = [];
  if ((draft.fileIds?.length ?? 0) > 0 || (draft.attachedFiles?.length ?? 0) > 0) {
    parts.push("attachments");
  }
  if (draft.poll) parts.push("poll");
  if (draft.scheduledAt) parts.push("schedule");
  if ((draft.recipientIds?.length ?? 0) > 0 || (draft.recipients?.length ?? 0) > 0) {
    parts.push("recipients");
  }
  if (draft.localOnly) parts.push("local-only");
  if (draft.reactionAcceptance) parts.push("reaction settings");
  if (draft.noQuote) parts.push("quote refusal");
  if (draft.replyId || draft.renoteId) parts.push("Misskey reply or quote link");
  return parts;
}
