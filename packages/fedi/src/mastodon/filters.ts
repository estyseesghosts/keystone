// Mastodon-family filter adaptation (v2 groups vs v1 keywords).
//
// Extracted verbatim from `backend.ts` (D3.3 decomposition —
// behavior-preserving move, no semantic change). `backend.ts` owns the
// `Backend.filters` method table; this module owns the wire↔core mapping
// plus the v2-first-with-v1-fallback runner the table calls.

import type { Filter, FilterKeyword } from "../core/backend";
import { isAbsent } from "./endpoints";

// --- Server-filter mapping (v2 groups vs v1 keywords) -----------------------
//
// Mastodon v2 (`/api/v2/filters`) speaks filter GROUPS — `{id, title,
// context[], expires_at, filter_action, keywords: [{id, keyword,
// whole_word}]}` — while v1 (`/api/v1/filters`, still present on
// Mastodon and the ONLY shape on Akkoma/Pleroma) speaks single keywords
// — `{id, phrase, context[], expires_at, irreversible, whole_word}`.
// The core `Filter` keeps the phrase-shaped v1 fields (`phrase` is the
// first keyword, what the UI edits) AND the full `keywords` list, so a
// multi-keyword v2 group is neither hidden nor destroyed on edit:
// `filter_action: "hide"` is the v2 irreversible. v1 has no
// `filter_action` — it stays absent, never fabricated.

/** Wire keyword row → core keyword. Missing text becomes "" (the adapter
 * never invents a phrase) and `whole_word` defaults to false. */
export function adaptFilterKeyword(k: Record<string, unknown>, fallbackId: string): FilterKeyword {
  return {
    id: k.id != null ? String(k.id) : fallbackId,
    keyword: typeof k.keyword === "string" ? k.keyword : "",
    wholeWord: k.whole_word === true,
  };
}

export function adaptV1FilterRow(f: Record<string, unknown>, phraseFallback: string): Filter {
  const id = String(f.id ?? "");
  const phrase = typeof f.phrase === "string" ? f.phrase : phraseFallback;
  const wholeWord = f.whole_word === true;
  return {
    id,
    phrase,
    context: Array.isArray(f.context) ? f.context.map(String) : [],
    expiresAt: typeof f.expires_at === "string" ? f.expires_at : null,
    irreversible: f.irreversible === true,
    wholeWord,
    // v1: the row and its single keyword are the same object.
    keywords: [{ id, keyword: phrase, wholeWord }],
  };
}

export function adaptV2FilterRow(f: Record<string, unknown>): Filter {
  const raw = Array.isArray(f.keywords) ? f.keywords : [];
  const id = String(f.id ?? "");
  const keywords = raw
    .filter((k): k is Record<string, unknown> => !!k && typeof k === "object")
    .map((k) => adaptFilterKeyword(k, id));
  const first = keywords[0];
  const title = typeof f.title === "string" ? f.title : null;
  const phrase = first && first.keyword.length > 0 ? first.keyword : (title ?? "");
  // A compliant server always sends >= 1 keyword; a keyword-less payload
  // (fork quirk) still reads as the single phrase the group is named
  // after — the list is never empty while a phrase exists.
  if (keywords.length === 0 && phrase.length > 0) {
    keywords.push({ id, keyword: phrase, wholeWord: false });
  }
  return {
    id,
    // Every keyword is carried in `keywords`; `phrase`/`wholeWord` are the
    // first one (the row the UI edits), never the whole group.
    phrase,
    context: Array.isArray(f.context) ? f.context.map(String) : [],
    expiresAt: typeof f.expires_at === "string" ? f.expires_at : null,
    irreversible: f.filter_action === "hide",
    wholeWord: first?.wholeWord === true,
    keywords,
  };
}

/** Core `expiresAt` (ISO) → wire `expires_in` (seconds from now): BOTH
 * filter versions take seconds, never a date. Null/undefined stays
 * absent — clearing an expiry is not portable, so it is never sent. */
export function filterExpiresIn(expiresAt: string | null | undefined): number | undefined {
  if (typeof expiresAt !== "string" || expiresAt.length === 0) return undefined;
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return undefined;
  return Math.max(0, Math.round((ms - Date.now()) / 1000));
}

/** v2-first with v1-fallback: only 404/405 (no such endpoint here —
 * Akkoma/Pleroma) fall back; anything else rethrows. When BOTH are
 * absent the v1 error propagates as the honest unsupported state. */
export async function withFilterFallback<T>(
  runV2: () => Promise<T>,
  runV1: () => Promise<T>,
): Promise<T> {
  try {
    return await runV2();
  } catch (err) {
    if (!isAbsent(err)) throw err;
    return runV1();
  }
}
