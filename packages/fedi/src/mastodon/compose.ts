// Text-only status composition on the Mastodon transport (Phase 4 Slice 2).
// The pure parts live here so the offline smoke can check them without a
// server: body building (Mastodon-documented fields only), the audience rules,
// the per-attempt Idempotency-Key, and mapping of legacy drafts. The network
// call is `createStatus` in statusActions.ts.
//
// Not offered in this slice: media (Slice 3), polls, scheduling and edits
// (Slice 4), Akkoma's `local` audience (detected-only, never chosen here).

import type { Visibility } from "../core/models";

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

export interface StatusBodyInput {
  text: string;
  cw: string;
  visibility: ComposeVisibility;
  inReplyToId?: string | null;
  quotedStatusId?: string | null;
  /** The instance's advertised limit, or FALLBACK_CHAR_LIMIT. */
  maxChars: number;
}

/** The JSON body for `POST /api/v1/statuses` (contract §1) and `PUT
 * /api/v1/statuses/:id` (contract §4). `spoiler_text` alone carries a
 * content warning (Mastodon treats a non-empty spoiler as sensitive).
 * `visibility` is the WIRE value (see `wireVisibilityOf` — raw
 * round-trips). */
export interface StatusBody {
  status: string;
  visibility: string;
  spoiler_text?: string;
  in_reply_to_id?: string;
  quoted_status_id?: string;
  media_ids?: string[];
  poll?: { options: string[]; multiple?: boolean; expires_in?: number; hide_totals?: boolean };
}

export type StatusBodyResult = { ok: true; body: StatusBody } | { ok: false; reason: string };

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
  if (draft.poll && draft.poll.choices.length > 0) {
    const expires =
      draft.poll.expiredAfter ??
      (draft.poll.expiresAt != null
        ? Math.max(0, Math.round((draft.poll.expiresAt - Date.now()) / 1000))
        : undefined);
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

export function buildStatusBody(input: StatusBodyInput): StatusBodyResult {
  const status = input.text.trim();
  if (status.length === 0) return { ok: false, reason: "Write something first." };
  const count = [...status].length;
  if (count > input.maxChars) {
    return {
      ok: false,
      reason: `Too long: ${count} of ${input.maxChars} characters. Shorten the post to post it.`,
    };
  }
  const body: StatusBody = { status, visibility: input.visibility };
  const spoiler = input.cw.trim();
  if (spoiler.length > 0) body.spoiler_text = spoiler;
  if (input.inReplyToId) body.in_reply_to_id = input.inReplyToId;
  if (input.quotedStatusId) body.quoted_status_id = input.quotedStatusId;
  return { ok: true, body };
}

/** 32 lowercase hex characters from the platform CSPRNG. `crypto.randomUUID`
 * is avoided on purpose: it is missing in some insecure (LAN http) contexts,
 * while `getRandomValues` is available in all of them. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
