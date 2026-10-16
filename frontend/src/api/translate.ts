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
// by note id (cf. `mentionCache` in MfmRenderer, quote lookups in
// `./quote`), and 404-remembered-per-session (cf. `isUnsupportedError`
// probing in `./client`).

import { BACKEND_ID } from "./backend";
import { apiCall, isUnsupportedError } from "./client";
import { getActiveExternal } from "./external";

export interface TranslateResult {
  /** English display name as returned by the server ("Chinese", ...). */
  sourceLang: string;
  text: string;
}

// --- Capability flag (once per session) ------------------------------------

// Keyed by whatever serves this session: the active external host, or the
// configured internal backend. Switching accounts re-probes for the new
// target instead of trusting a stale flag.
let capabilityKey: string | null = null;
let capabilityValue = false;
let capabilityPromise: Promise<boolean> | null = null;

function sessionKey(): string {
  return getActiveExternal()?.host ?? BACKEND_ID;
}

interface MetaProbe {
  translatorAvailable?: unknown;
}

/** True when this session's server offers translation. Probed once per
 * session via `meta`; servers without translation report a falsy flag, and
 * a 404 on `notes/translate` later flips this off permanently too. Uses
 * `apiCall` (not the public helper) so an active external account probes
 * its own host; logged-out sessions send no credential, which is fine —
 * both endpoints are public. */
export function translatorAvailable(): Promise<boolean> {
  const key = sessionKey();
  if (capabilityPromise && capabilityKey === key) return capabilityPromise;
  capabilityKey = key;
  capabilityPromise = apiCall<MetaProbe>("meta", {})
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

export function isTranslationAvailable(): boolean {
  return capabilityValue;
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
const CACHE_MAX = 300;

function evict(): void {
  while (completed.size > CACHE_MAX) {
    const oldest = completed.keys().next();
    if (oldest.done) break;
    completed.delete(oldest.value);
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

/** Fetch (or reuse the cached) translation of one note. Resolves null when
 * translation is unavailable, unsupported, failed, or not worth showing —
 * callers always fall back to the original text. Failures are cached like
 * successes so feeds never spin retry loops; the toggle only switches
 * between the cached translation and the original, it never refetches. */
export function requestTranslation(
  noteId: string,
  targetLang: string,
): Promise<TranslateResult | null> {
  if (!capabilityValue) return Promise.resolve(null);
  const done = completed.get(noteId);
  if (done !== undefined) return Promise.resolve(done);
  const pending = inflight.get(noteId);
  if (pending) return pending;

  const task = apiCall<unknown>("notes/translate", { noteId, targetLang }).then(
    (res) => {
      const result = isTranslateResult(res) ? res : null;
      completed.set(noteId, result);
      evict();
      inflight.delete(noteId);
      return result;
    },
    (err) => {
      // A server without the endpoint 404s: never try again this session.
      if (isUnsupportedError(err)) markUnsupported();
      completed.set(noteId, null);
      evict();
      inflight.delete(noteId);
      return null;
    },
  );
  inflight.set(noteId, task);
  return task;
}
