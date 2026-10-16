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

import { apiCall } from "./client";
import { isPureRenote, type Note } from "./types";

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

/** Trailing punctuation stripped from a candidate fallback URL: these are
 * sentence delimiters, never significant URL characters in this position. */
const TRAILING_PUNCT = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  ")",
  "]",
  "}",
  "'",
  '"',
]);

/** Clean and validate one candidate fallback URL. Returns null for
 * malformed URLs, credentials in URLs, and non-web schemes. Relative URLs
 * fail the `URL` constructor with no base and are rejected too. */
export function cleanQuoteUrl(raw: string): string | null {
  let candidate = raw.trim();
  while (candidate.length > 0 && TRAILING_PUNCT.has(candidate.slice(-1))) {
    candidate = candidate.slice(0, -1);
  }
  if (candidate.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;
  return candidate;
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

/** True when two quote URIs identify the same target: exact match first,
 * then normalized URL comparison (host case, default ports, encoding). */
export function urisMatch(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

/** Candidate URIs for the structured target: used only to detect an exact
 * duplicate `RE:` suffix, never for fetching. */
export function structuredUrisOf(note: Note): string[] {
  const out: string[] = [];
  if (note.renote?.uri) out.push(note.renote.uri);
  if (note.renote?.url && !out.includes(note.renote.url)) out.push(note.renote.url);
  const targetUri = asString(note.quoteTargetUri);
  if (targetUri && !out.includes(targetUri)) out.push(targetUri);
  return out;
}

// --- Structured normalization ----------------------------------------------

/** Map a packed note into one frontend quote-target shape. Pure reposts
 * are not quotes (they keep the retweet presentation), so they normalize
 * to null even though they carry `renoteId`. */
export function getQuoteTarget(note: Note): QuoteTarget | null {
  if (isPureRenote(note)) return null;
  const authorizationStatus = normalizeStatus(note.quoteAuthorizationStatus);

  if (note.renoteId != null || note.renote != null) {
    const target: QuoteTarget = { source: "structured" };
    const noteId = note.renoteId ?? note.renote?.id;
    if (noteId) target.noteId = noteId;
    const uri =
      note.renote?.uri ?? note.renote?.url ?? asString(note.quoteTargetUri);
    if (uri) target.uri = uri;
    if (asBool(note.quoteTargetUnavailable)) target.targetUnavailable = true;
    if (authorizationStatus) target.authorizationStatus = authorizationStatus;
    return target;
  }

  const quoteTargetUri = asString(note.quoteTargetUri);
  const targetUnavailable = asBool(note.quoteTargetUnavailable);
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
  const textual = parseTextualQuote(note.text) ?? parseLeadingQuote(note.text);
  if (textual) {
    return { uri: textual.uri, source: "textual-fallback" };
  }
  return null;
}

/** Neutral display label for an explicitly provided authorization status.
 * Returns null for `approved` and for a missing status: the UI must never
 * claim approval on the basis of a missing stamp or a text fallback. */
export function statusLabelFor(
  status: QuoteAuthorizationStatus | undefined,
): string | null {
  switch (status) {
    case "pending":
      return "Quote request pending";
    case "rejected":
      return "Quote request rejected";
    case "revoked":
      return "Quote authorization revoked";
    case "unapproved":
    case "unknown":
      return "Quote authorization unverified";
    default:
      return null;
  }
}

// --- Fallback resolution ----------------------------------------------------

// Notes already loaded through the visibility-enforcing note API in this
// session, indexed for reuse before calling `ap/show`. Showing one as a
// quote card reveals nothing the viewer could not already see.
const seenByUri = new Map<string, Note>();
const seenById = new Map<string, Note>();
const SEEN_MAX = 500;

function evictOldest(map: Map<string, Note>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

export function registerSeenNote(note: Note): void {
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
const completedLookups = new Map<string, Note | null>();
const inflightLookups = new Map<string, Promise<Note | null>>();
const LOOKUP_MAX = 200;

/** Resolve a fallback URI into a Note via the configured backend's
 * `ap/show` endpoint. Only a `Note` result renders a card — a User,
 * invalid object, failed/inaccessible target, or deleted target resolves
 * to null. Visibility stays with the server: `ap/show` requires a
 * credential, so logged-out or unauthorized resolutions fail closed and
 * the UI keeps the original `RE:` text. */
export function resolveQuoteUri(uri: string): Promise<Note | null> {
  const key = uri.trim();
  const seen = seenByUri.get(key);
  if (seen) return Promise.resolve(seen);
  const completed = completedLookups.get(key);
  if (completed !== undefined) return Promise.resolve(completed);
  const inflight = inflightLookups.get(key);
  if (inflight) return inflight;

  const task = apiCall<ApShowResponse>("ap/show", { uri: key }).then(
    (res) => {
      const note =
        res && res.type === "Note" && isNoteLike(res.object)
          ? (res.object as Note)
          : null;
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
