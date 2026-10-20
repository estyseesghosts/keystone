// Auto translation via the Misskey-family `notes/translate` endpoint.
//
// Verified live 2026-10-16 against dvd.chat (Sharkey 2025.4.7):
// - `POST /api/notes/translate` is PUBLIC (no credential): a bogus noteId
//   returns 400 NO_SUCH_NOTE, not 401. Params `{noteId, targetLang}`
//   (targetLang required — omitting it is 400 INVALID_PARAM). Result
//   `{sourceLang, text}` where sourceLang is an English display name
//   ("Chinese", "English"), NOT an ISO code.
// - `POST /api/meta` exposes `translatorAvailable: true` — read once per
//   session as the capability flag.
// - The server is lenient about targetLang codes: `en`, `en-US`, `zh-CN`,
//   `zh`, `ja` all translate; even bogus `xx` answers (English fallback).
//   The client therefore sends the viewer's primary subtag and never
//   maintains an allow-list.
// - Requesting a note already in the target language still returns a result
//   (same text, sourceLang "English" for targetLang "en"). Same-language
//   suppression is the CLIENT's job (see `translationDiffers`).
//
// House patterns followed: module-level completed + in-flight caches keyed
// by note id (cf. quote lookups in `./quote`), and 404-remembered-per-session
// (cf. `isUnsupportedError` probing in `./client`).
//
// Pure-TS rule: the old Solid store became plain maps + an `eventemitter3`
// change event; the old global active-backend routing became an explicit
// translator instance per session (`createTranslator`).

import EventEmitter from "eventemitter3";
import type { ServerFamily } from "../core/detect";
import { isUnsupportedError, type WireCall } from "./client";
import { parse, type MfmNode } from "mfm-js";

export interface TranslateResult {
  /** English display name as returned by the server ("Chinese", ...). */
  sourceLang: string;
  text: string;
}

// --- Capability flag (once per translator) ----------------------------------
//
// Misskey family: probed once per session via `meta`; servers without
// translation report a falsy flag, and a 404 on `notes/translate` later
// flips this off permanently too. Mastodon family: the capability table is
// the authority (contract §9 — `configuration.translation.enabled` /
// `akkoma:machine_translation` raised the flag at detection; an unknown
// flag unlocks nothing).

export interface TranslatorDeps {
  call: WireCall;
  family: ServerFamily;
  /** Mastodon-family capability-table flag (ignored on Misskey). */
  translationSupported?: boolean;
}

export interface Translator {
  /** True when this session's server offers translation. */
  translatorAvailable(): Promise<boolean>;
  /** Last probed value (false until `translatorAvailable` resolves). */
  isTranslationAvailable(): boolean;
  /** Fetch (or reuse the cached) translation of one note. Resolves null
   * when translation is unavailable, unsupported, recently failed, or not
   * worth showing — callers always fall back to the original text.
   * Successes settle permanently; failures suppress retries for
   * FAILURE_TTL_MS so transient errors recover without hammering a
   * persistently failing endpoint. The toggle only switches between the
   * cached translation and the original, it never refetches. */
  requestTranslation(noteId: string, targetLang: string): Promise<TranslateResult | null>;
}

interface MetaProbe {
  translatorAvailable?: unknown;
}

export function createTranslator(deps: TranslatorDeps): Translator {
  const { call, family } = deps;
  let capabilityValue =
    family === "mastodon" ? (deps.translationSupported ?? false) : false;
  let capabilityPromise: Promise<boolean> | null = null;

  function translatorAvailable(): Promise<boolean> {
    if (capabilityPromise) return capabilityPromise;
    if (family === "mastodon") {
      capabilityPromise = Promise.resolve(capabilityValue);
      return capabilityPromise;
    }
    capabilityPromise = call<MetaProbe>("meta", {})
      .then((meta) => {
        capabilityValue = meta.translatorAvailable === true;
        return capabilityValue;
      })
      .catch(() => {
        capabilityValue = false;
        return false;
      });
    return capabilityPromise;
  }

  /** Permanently disable translation for this session (server 404s the
   * endpoint): in-flight callers resolve null and no further attempts fire. */
  function markUnsupported(): void {
    capabilityValue = false;
  }

  async function requestTranslation(
    noteId: string,
    targetLang: string,
  ): Promise<TranslateResult | null> {
    if (!capabilityValue) return null;
    const done = completed.get(noteId);
    if (done !== undefined) return done;
    const failed = failedAt.get(noteId);
    if (failed !== undefined && Date.now() - failed < FAILURE_TTL_MS) {
      return null;
    }
    const pending = inflight.get(noteId);
    if (pending) return pending;

    // Misskey family here: `notes/translate` by note id. (The Mastodon
    // family translates through the Backend's `translate`, which routes to
    // `POST /api/v1/statuses/:id/translate` — same cache, same display
    // policy; see `backend.ts`.)
    const task = call<{ sourceLang?: unknown; text?: unknown }>("notes/translate", {
      noteId,
      targetLang,
    }).then(
      (t) => {
        const result: TranslateResult | null =
          t && typeof t.text === "string" && t.text.length > 0
            ? { sourceLang: typeof t.sourceLang === "string" ? t.sourceLang : "", text: t.text }
            : null;
        completed.set(noteId, result);
        evict(completed);
        failedAt.delete(noteId);
        inflight.delete(noteId);
        return result;
      },
      (err) => {
        // A server without the endpoint 404s: never try again this session.
        if (isUnsupportedError(err)) markUnsupported();
        else {
          failedAt.set(noteId, Date.now());
          evict(failedAt);
        }
        inflight.delete(noteId);
        return null;
      },
    );
    inflight.set(noteId, task);
    return task;
  }

  return {
    translatorAvailable,
    isTranslationAvailable: () => capabilityValue,
    requestTranslation,
  };
}

// --- Viewer language ---------------------------------------------------------

function viewerPrimary(): string {
  try {
    const lang =
      typeof navigator !== "undefined" && navigator.language
        ? navigator.language
        : "en";
    return lang.split(/[-_]/)[0].toLowerCase() || "en";
  } catch {
    return "en";
  }
}

/** The targetLang code sent to the server: the viewer's primary subtag
 * (`en-US` -> `en`). The server is lenient (verified live), so no mapping
 * table is maintained. */
export function viewerTargetLang(): string {
  return viewerPrimary();
}

/** True when a translation is worth showing: the server's `sourceLang` is
 * an English display name ("Chinese"), so it is compared against the
 * English name of the viewer's language (`Intl.DisplayNames`) as well as
 * the raw primary subtag. Same-language results (which the server still
 * returns) are suppressed; anything unrecognized is shown — an extra
 * toggle line is harmless, a hidden translation is not. */
export function translationDiffers(sourceLang: string): boolean {
  const src = sourceLang.trim().toLowerCase();
  if (!src) return false;
  const primary = viewerPrimary();
  if (src === primary) return false;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(primary);
    if (typeof name === "string" && src === name.toLowerCase()) return false;
  } catch {
    // Intl unavailable: fall through to showing the translation.
  }
  return true;
}

// --- Translation cache -------------------------------------------------------

const completed = new Map<string, TranslateResult | null>();
const inflight = new Map<string, Promise<TranslateResult | null>>();
// Failures are NOT permanent: a transient error (rate limit, translator
// hiccup) must not hide a translation for the rest of the session. A
// failed noteId simply stops retrying for FAILURE_TTL_MS; remounts after
// that try again. Only successes, invalid shapes, and session-wide 404s
// settle permanently.
const failedAt = new Map<string, number>();
const FAILURE_TTL_MS = 90_000;
const CACHE_MAX = 300;

function evict(map: Map<string, unknown>): void {
  while (map.size > CACHE_MAX) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function isTranslateResult(value: unknown): value is TranslateResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sourceLang === "string" &&
    v.sourceLang.length > 0 &&
    typeof v.text === "string" &&
    v.text.length > 0
  );
}

// --- Translatable text, display policy ---------------------------------------
//
// The server translates the raw note text by id (mentions, hashtags, URLs,
// link labels, and emoji included — verified live: a `#tag` came back
// translated, URLs verbatim). The client cannot scope what the server
// translates, so it decides instead (a) whether a request is worthwhile at
// all and (b) whether a returned result is worth showing.

/** Collect the human prose of a note: every text-bearing node except the
 * structured tokens — mentions, hashtags, bare URLs, whole link nodes
 * (URL and label alike), and unicode/custom emoji. Code, math, and search
 * text counts as prose: it rarely justifies a request on its own, but the
 * identical-output rule below suppresses those results anyway. */
function collectProse(nodes: MfmNode[], out: string[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case "mention":
      case "hashtag":
      case "url":
      case "link":
      case "emojiCode":
      case "unicodeEmoji":
        break;
      case "text":
        out.push(node.props.text);
        break;
      case "inlineCode":
      case "blockCode":
        out.push(node.props.code);
        break;
      case "mathInline":
      case "mathBlock":
        out.push(node.props.formula);
        break;
      case "search":
        out.push(node.props.content);
        break;
      case "bold":
      case "small":
      case "italic":
      case "strike":
      case "center":
      case "quote":
      case "fn":
      case "plain":
        collectProse(node.children, out);
        break;
    }
  }
}

/** The note's prose with all structured tokens removed. Unparseable text
 * falls back to the raw string (request, let the server decide). */
export function translatableText(text: string | null): string {
  if (!text) return "";
  let nodes: MfmNode[];
  try {
    nodes = parse(text);
  } catch {
    return text;
  }
  const parts: string[] = [];
  collectProse(nodes, parts);
  return parts.join("");
}

/** True when the note has human prose worth translating: at least one
 * unicode letter outside mentions/hashtags/URLs/links/emoji. Emoji-only,
 * tag-only, link-only, and mention-only posts never fire a request. */
export function hasTranslatableText(text: string | null): boolean {
  return /\p{L}/u.test(translatableText(text));
}

/** True when the prose carries letters outside the Latin script (Cyrillic,
 * Han, Arabic, ...). Used only to distrust a same-language detection, never
 * to assert which language the text is in. */
export function hasForeignScript(prose: string): boolean {
  const letters = prose.match(/\p{L}/gu);
  return !!letters && letters.some((ch) => !/\p{Script=Latin}/u.test(ch));
}

/** Comparison form: case-insensitive, all whitespace runs collapsed. */
export function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Edit distance capped at `cap + 1`: full precision is pointless past the
 * substantial-difference threshold, and notes can be 3,000 chars. */
function editDistanceCapped(a: string, b: string, cap: number): number {
  if (a.length > b.length) [a, b] = [b, a];
  let prev: number[] = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let rowMin = j;
    const curr: number[] = [j];
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
      curr.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev = curr;
  }
  return prev[a.length];
}

/** Normalized edit distance in [0, 1]. Pure length gaps short-circuit the
 * DP: a translation much longer/shorter than the original is substantial
 * by construction. */
export function distanceRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  const gap = Math.abs(a.length - b.length) / longest;
  if (gap > SUBSTANTIAL_RATIO) return gap;
  return editDistanceCapped(a, b, Math.ceil(SUBSTANTIAL_RATIO * longest)) / longest;
}

/** Past this normalized distance a changed text counts as a real
 * translation rather than server normalization noise ("webdev" → "web
 * dev" scores ~0.02 and stays hidden). */
export const SUBSTANTIAL_RATIO = 0.25;

export type TranslationDecision =
  | { show: false }
  | { show: true; label: string | null };

/** Display policy for one fetched result against the displayed original.
 * - Identical output (normalized) never shows: misdetections like an
 *   English post labeled "German" with byte-equal text stay silent.
 * - A differing sourceLang shows with its `Translated from {sourceLang}`
 *   label (the normal path).
 * - A result claiming the viewer's language while the text changed
 *   substantially is shown with a generic `Translated` label (no false
 *   source claim) ONLY when the original carries a foreign script — the
 *   detection demonstrably misfired (e.g. a Ukrainian post labeled
 *   English). Same-script rewrites stay hidden: they are normalization
 *   noise, or an LLM-backend hallucination on a short same-language post
 *   (observed live), neither of which helps the viewer. */
export function decideTranslation(
  original: string,
  result: TranslateResult,
): TranslationDecision {
  const a = normalizeForCompare(original);
  const b = normalizeForCompare(result.text);
  if (!a || !b || a === b) return { show: false };
  if (translationDiffers(result.sourceLang)) {
    return { show: true, label: result.sourceLang };
  }
  if (
    hasForeignScript(translatableText(original)) &&
    distanceRatio(a, b) > SUBSTANTIAL_RATIO
  ) {
    return { show: true, label: null };
  }
  return { show: false };
}

// --- Shared per-note outcome + retry (TranslatableText and NoteMenu) ---------
//
// The display component reports what it shows; the post menu reads it to
// hide "Translate" once a translation is on screen, and asks for a retry
// after a failure. Both live in plain module maps (shared like before) so
// either side updates the other without a prop chain; an `eventemitter3`
// event notifies subscribers of changes.

export type TranslationOutcome = "loaded" | "unchanged";

const outcomes = new Map<string, TranslationOutcome>();
const retries = new Map<string, number>();
const metaEvents = new EventEmitter();

/** Subscribe to outcome/retry changes. Returns an unsubscribe function. */
export function onTranslationMetaChange(handler: (noteId: string) => void): () => void {
  metaEvents.on("meta", handler);
  return () => {
    metaEvents.off("meta", handler);
  };
}

/** "loaded": a translation is shown. "unchanged": the server answered but
 * the result is not worth showing (same language). Undefined otherwise. */
export function translationOutcome(noteId: string): TranslationOutcome | undefined {
  return outcomes.get(noteId);
}

export function reportTranslationOutcome(noteId: string, outcome: TranslationOutcome): void {
  if (outcomes.get(noteId) !== outcome) {
    outcomes.set(noteId, outcome);
    metaEvents.emit("meta", noteId);
  }
}

/** Read by the display's request memo so a retry refetches. */
export function translationRetryCount(noteId: string): number {
  return retries.get(noteId) ?? 0;
}

/** Clear a remembered failure and make the display refetch. */
export function retryTranslation(noteId: string): void {
  failedAt.delete(noteId);
  retries.set(noteId, (retries.get(noteId) ?? 0) + 1);
  metaEvents.emit("meta", noteId);
}
