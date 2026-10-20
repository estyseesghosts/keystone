// Quote-post normalization and fallback resolution for Keystone.
//
// Boundary between backend response shapes and the UI: every supported
// structured quote representation the selected backend exposes (Misskey
// `renote`/`renoteId`, plus Pinetree's optional `quoteTargetUri`,
// `quoteTargetUnavailable`, `quoteAuthorizationStatus`) plus the recognized
// textual `RE:` fallback maps into one `QuoteTarget`. Rendering components
// consume only that normalized shape and never parse raw ActivityPub.
//
// Product rules (see docs/quote-posts.md):
// - Render structured quotes regardless of authorization. `pending`,
//   `unapproved`, `rejected`, `revoked` (and a missing status, which is
//   normal for Misskey/Sharkey) are never render filters.
// - A terminal `RE: <http(s) URL>` suffix is a display heuristic only —
//   never proof of a formal quote, never an authorization claim, and never
//   a reason to mutate the note sent to the backend.
// - Structured metadata always wins over the textual fallback.

import type { WireCall } from "./client";
import { isPureRenote, type Post } from "../core/models";
import { cleanQuoteUrl, urisMatch } from "../core/quoteUri";
import { adaptNote } from "./adapt";
import type { Note } from "./wire";

export { cleanQuoteUrl, urisMatch };

export type QuoteSource = "structured" | "textual-fallback";

export type QuoteAuthorizationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revoked"
  | "unapproved"
  | "unknown";

export interface QuoteTarget {
  noteId?: string;
  uri?: string;
  targetUnavailable?: boolean;
  source: QuoteSource;
  /** Display metadata only. Absent on Misskey/Sharkey and on legacy
   * quotes; absence never means rejection. */
  authorizationStatus?: QuoteAuthorizationStatus;
}

const KNOWN_STATUSES: readonly string[] = [
  "pending",
  "approved",
  "rejected",
  "revoked",
  "unapproved",
  "unknown",
];

function normalizeStatus(raw: unknown): QuoteAuthorizationStatus | undefined {
  return typeof raw === "string" &&
    (KNOWN_STATUSES as readonly string[]).includes(raw)
    ? (raw as QuoteAuthorizationStatus)
    : undefined;
}

function asString(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function asBool(raw: unknown): boolean {
  return raw === true;
}

// --- Textual `RE:` fallback -----------------------------------------------
//
// URL cleaning/matching live in `core/quoteUri.ts` (single source — the
// copies that were here were identical); re-exported so existing
// `misskey/quote` importers keep working.

export interface TextualQuoteMatch {
  /** Cleaned absolute http(s) URL. */
  uri: string;
  /** Removable range. The suffix range starts at the separator
   * whitespace/newline before `RE:` and always runs to the end of the
   * original text; the prefix range starts at 0 and runs past the
   * marker's line break — suppressing either leaves no blank line. */
  start: number;
  end: number;
  position: "prefix" | "suffix";
}

/** Match a terminal `RE: <URL>` suffix: `RE:` (case-sensitive) preceded by
 * the start of the text or whitespace, followed by exactly one absolute
 * URL, then only trailing whitespace to the end of the text. Mid-sentence
 * links, multi-token suffixes, and non-terminal `RE:` never match. When
 * several suffixes could apply, the end anchor selects the final one. */
const RE_SUFFIX_PATTERN = /(?:^|\s)RE:[ \t]*(\S+)[ \t]*$/;

/** Match a leading `RE: <URL>` marker: the text opens with `RE:`
 * (case-sensitive) followed by exactly one absolute URL on that line.
 * Same narrow rules as the suffix (trailing punctuation trimmed,
 * credentials/non-web/relative rejected); `RE: <url> plus commentary on
 * the same line` never matches — one URL per marker line. */
const RE_PREFIX_PATTERN = /^RE:[ \t]*(\S+)[ \t]*(?:\r?\n|$)/;

function toSuffixMatch(text: string, match: RegExpExecArray): TextualQuoteMatch | null {
  const uri = cleanQuoteUrl(match[1]);
  if (!uri) return null;
  return { uri, start: match.index, end: text.length, position: "suffix" };
}

export function parseTextualQuote(text: string | null): TextualQuoteMatch | null {
  if (!text) return null;
  const trimmedEnd = text.replace(/[ \t\r\n]+$/, "");
  if (trimmedEnd.length === 0) return null;
  const match = RE_SUFFIX_PATTERN.exec(trimmedEnd);
  if (!match || match[1] === undefined) return null;
  return toSuffixMatch(text, match);
}

/** The leading `RE:` marker, if any. Null unless the text opens with a
 * single clean absolute http(s) URL on the marker line. */
export function parseLeadingQuote(text: string | null): TextualQuoteMatch | null {
  if (!text) return null;
  const match = RE_PREFIX_PATTERN.exec(text);
  if (!match || match[1] === undefined) return null;
  const uri = cleanQuoteUrl(match[1]);
  if (!uri) return null;
  return { uri, start: 0, end: match.index + match[0].length, position: "prefix" };
}

/** Every textual marker in the text, occurrence order: 0–2 matches. A
 * lone `RE: <url>` whole text matches BOTH patterns — when the URIs agree
 * (normalized) that collapses to one match over the union range, so
 * render-time stripping never applies two overlapping ranges. Two
 * different URIs return both markers; each is evaluated independently at
 * render (structured-wins per marker), never guessed into two cards. */
export function parseTextualQuotes(text: string | null): TextualQuoteMatch[] {
  if (!text) return [];
  const prefix = parseLeadingQuote(text);
  const suffix = parseTextualQuote(text);
  if (!prefix) return suffix ? [suffix] : [];
  if (!suffix) return [prefix];
  if (prefix.end > suffix.start && urisMatch(prefix.uri, suffix.uri)) {
    return [
      {
        uri: suffix.uri,
        start: Math.min(prefix.start, suffix.start),
        end: Math.max(prefix.end, suffix.end),
        position: "suffix",
      },
    ];
  }
  return [prefix, suffix];
}

/** Candidate URIs for the structured target: used only to detect an exact
 * duplicate `RE:` suffix, never for fetching. Covers the Misskey packed
 * renote, the Pinetree `quoteTargetUri` extension, and the Mastodon-family
 * structured quote (same branch `getQuoteTarget` renders). */
export function structuredUrisOf(post: Post): string[] {
  const out: string[] = [];
  if (post.renote?.uri) out.push(post.renote.uri);
  if (post.renote?.url && !out.includes(post.renote.url)) out.push(post.renote.url);
  if (post.quote?.uri && !out.includes(post.quote.uri)) out.push(post.quote.uri);
  if (post.quote?.url && !out.includes(post.quote.url)) out.push(post.quote.url);
  const targetUri = asString(post.ext.quoteTargetUri);
  if (targetUri && !out.includes(targetUri)) out.push(targetUri);
  return out;
}

// --- Structured normalization ----------------------------------------------

/** Map a packed post into one frontend quote-target shape. Pure reposts
 * are not quotes (they keep the retweet presentation), so they normalize
 * to null even though they carry `renoteId`. */
export function getQuoteTarget(post: Post): QuoteTarget | null {
  if (isPureRenote(post)) return null;
  const authorizationStatus = normalizeStatus(post.ext.quoteAuthorizationStatus);

  if (post.renoteId != null || post.renote != null) {
    const target: QuoteTarget = { source: "structured" };
    const noteId = post.renoteId ?? post.renote?.id;
    if (noteId) target.noteId = noteId;
    const uri =
      post.renote?.uri ?? post.renote?.url ?? asString(post.ext.quoteTargetUri);
    if (uri) target.uri = uri;
    if (asBool(post.ext.quoteTargetUnavailable)) target.targetUnavailable = true;
    if (authorizationStatus) target.authorizationStatus = authorizationStatus;
    return target;
  }

  // Mastodon-family structured quote (core `quote`/`quoteState`/
  // `quoteUnavailable` — plan §2.1, Phase 3): the target renders
  // regardless of the approval state, exactly like the Misskey branch
  // above; `quoteState` is display metadata only (normalizeStatus maps it
  // into the same label vocabulary, `accepted`/missing → no label).
  if (post.quote != null || post.quoteUnavailable) {
    const target: QuoteTarget = { source: "structured" };
    const noteId = post.quote?.id;
    if (noteId) target.noteId = noteId;
    const uri = post.quote?.uri ?? post.quote?.url ?? undefined;
    if (uri) target.uri = uri;
    if (post.quoteUnavailable) target.targetUnavailable = true;
    const state = normalizeStatus(post.quoteState) ?? authorizationStatus;
    if (state) target.authorizationStatus = state;
    return target;
  }

  const quoteTargetUri = asString(post.ext.quoteTargetUri);
  const targetUnavailable = asBool(post.ext.quoteTargetUnavailable);
  if (quoteTargetUri || targetUnavailable) {
    const target: QuoteTarget = { source: "structured" };
    if (quoteTargetUri) target.uri = quoteTargetUri;
    if (targetUnavailable) target.targetUnavailable = true;
    if (authorizationStatus) target.authorizationStatus = authorizationStatus;
    return target;
  }

  // Textual fallback only when no structured relationship exists. It has
  // no ActivityPub authorization semantics, so it never carries a status.
  // The terminal suffix is preferred (legacy); a leading marker feeds the
  // same fallback source when no suffix matches.
  const textual =
    parseTextualQuote(post.content.mfm ?? null) ??
    parseLeadingQuote(post.content.mfm ?? null);
  if (textual) {
    return { uri: textual.uri, source: "textual-fallback" };
  }
  return null;
}

/** Neutral display label for an explicitly provided authorization status.
 * Returns null for `approved` and for a missing status: the UI must never
 * claim approval on the basis of a missing stamp or a text fallback.
 * English fallback strings; `QUOTE_STATUS_LABEL_KEYS` carries the stable
 * codes the UI resolves at render time. Pure. */
export const QUOTE_STATUS_LABEL_KEYS: Record<
  Exclude<QuoteAuthorizationStatus, "approved">,
  string
> = {
  pending: "quote.pending",
  rejected: "quote.rejected",
  revoked: "quote.revoked",
  unapproved: "quote.unverified",
  unknown: "quote.unverified",
};

const QUOTE_STATUS_LABELS: Record<string, string> = {
  pending: "Quote request pending",
  rejected: "Quote request rejected",
  revoked: "Quote authorization revoked",
  unapproved: "Quote authorization unverified",
  unknown: "Quote authorization unverified",
};

export function statusLabelFor(status: QuoteAuthorizationStatus | undefined): string | null {
  switch (status) {
    case "pending":
    case "rejected":
    case "revoked":
    case "unapproved":
    case "unknown":
      return QUOTE_STATUS_LABELS[status];
    default:
      return null;
  }
}

// --- Fallback resolution ----------------------------------------------------

// Notes already loaded through the visibility-enforcing note API in this
// session, indexed for reuse before calling `ap/show`. Showing one as a
// quote card reveals nothing the viewer could not already see.
const seenByUri = new Map<string, Post>();
const seenById = new Map<string, Post>();
const SEEN_MAX = 500;

function evictOldest(map: Map<string, Post>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

export function registerSeenNote(note: Post): void {
  if (!note || typeof note.id !== "string") return;
  seenById.set(note.id, note);
  if (note.uri) seenByUri.set(note.uri, note);
  if (note.url && !seenByUri.has(note.url)) seenByUri.set(note.url, note);
  evictOldest(seenById, SEEN_MAX);
  evictOldest(seenByUri, SEEN_MAX);
}

function isNoteLike(value: unknown): value is Note {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

interface ApShowResponse {
  type: "User" | "Note";
  object: unknown;
}

// Completed lookups (successes and failures alike — a cached failure is
// never retried implicitly, so repeated cards cannot cause retry loops)
// plus in-flight lookups shared across cards and timeline updates.
const completedLookups = new Map<string, Post | null>();
const inflightLookups = new Map<string, Promise<Post | null>>();
const LOOKUP_MAX = 200;

/** Resolve a fallback URI into a Note via the session backend's
 * `ap/show` endpoint. Only a `Note` result renders a card — a User,
 * invalid object, failed/inaccessible target, or deleted target resolves
 * to null. Visibility stays with the server: `ap/show` requires a
 * credential, so logged-out or unauthorized resolutions fail closed and
 * the UI keeps the original `RE:` text. The transport is an explicit
 * parameter (no global routing facade in this package). */
export function resolveQuoteUri(call: WireCall, uri: string): Promise<Post | null> {
  const key = uri.trim();
  const seen = seenByUri.get(key);
  if (seen) return Promise.resolve(seen);
  const completed = completedLookups.get(key);
  if (completed !== undefined) return Promise.resolve(completed);
  const inflight = inflightLookups.get(key);
  if (inflight) return inflight;

  const task = call<ApShowResponse>("ap/show", { uri: key }).then(
    (res) => {
      const raw =
        res && res.type === "Note" && isNoteLike(res.object)
          ? (res.object as Note)
          : null;
      const note = raw ? adaptNote(raw) : null;
      if (note) registerSeenNote(note);
      completedLookups.set(key, note);
      evictLookups();
      inflightLookups.delete(key);
      return note;
    },
    () => {
      completedLookups.set(key, null);
      evictLookups();
      inflightLookups.delete(key);
      return null;
    },
  );
  inflightLookups.set(key, task);
  return task;
}

function evictLookups(): void {
  while (completedLookups.size > LOOKUP_MAX) {
    const oldest = completedLookups.keys().next();
    if (oldest.done) break;
    completedLookups.delete(oldest.value);
  }
}
