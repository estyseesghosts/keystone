// Translation display policy: app-side adapter over the fedi-owned
// `decideTranslation` family (`packages/fedi/src/misskey/translate.ts`).
//
// Ownership (D3.8): the comparison primitives — `normalizeForCompare`,
// `hasForeignScript`, `distanceRatio` (with its length-gap short-circuit),
// `SUBSTANTIAL_RATIO` — are imported from `@keystone/fedi`, so the
// substantial-difference rule cannot drift between the auto-translate gate
// and the display gate. What stays here is only the viewer-param adapter:
// the viewer locale is app state (`i18n.locale`), which fedi never reads
// (pure-TS rule, no `navigator`). No wire type is imported — only the pure
// comparison helpers.

import {
  distanceRatio as fediDistanceRatio,
  hasForeignScript as fediHasForeignScript,
  normalizeForCompare as fediNormalizeForCompare,
  SUBSTANTIAL_RATIO as FEDI_SUBSTANTIAL_RATIO,
} from '@keystone/fedi'

export type TranslationDecision = {show: false} | {show: true; label: string | null}

/** Comparison form: case-insensitive, all whitespace runs collapsed. */
export function normalizeForCompare(text: string): string {
  return fediNormalizeForCompare(text)
}

/** True when any letter is non-Latin. Used only to distrust a
 * same-language detection, never to assert which language text is in. */
export function hasForeignScript(prose: string): boolean {
  return fediHasForeignScript(prose)
}

/** Server normalization noise ("webdev" → "web dev") scores ~0.02 and
 * stays hidden; real rewrites score far above. The length-gap
 * short-circuit lives in the fedi implementation: a translation much
 * longer/shorter than the original is substantial by construction. */
export const SUBSTANTIAL_RATIO = FEDI_SUBSTANTIAL_RATIO

function distanceRatio(a: string, b: string): number {
  return fediDistanceRatio(a, b)
}

/** True when the server's source language is NOT the viewer's language.
 * Misskey-family servers report an English display name ("Chinese"),
 * Mastodon-family an ISO code ("zh") — accept either. Anything
 * unrecognized shows rather than hides: an extra toggle line is harmless,
 * a hidden translation is not. */
export function translationDiffers(sourceLang: string | null, viewerPrimary: string): boolean {
  if (sourceLang == null) return true
  const src = sourceLang.trim().toLowerCase()
  if (!src) return false
  const primary = viewerPrimary.trim().toLowerCase()
  if (!primary || src === primary) return false
  try {
    const name = new Intl.DisplayNames(['en'], {type: 'language'}).of(primary)
    if (typeof name === 'string' && src === name.toLowerCase()) return false
  } catch {
    // Intl unavailable: fall through to showing the translation.
  }
  return true
}

/** True when a fetched translation's `sourceLang` is already the viewer's
 * language — a same-language result the server still returns (Misskey
 * servers echo the text with e.g. sourceLang "English" for targetLang
 * "en"). Case-insensitive primary-subtag compare (`en-US` vs `en`
 * matches); the `translationDiffers` English-display-name rule
 * ("English" vs `en`) applies through reuse below. Null/empty
 * sourceLang is NOT same-language (false — proceed as today: unknown
 * source shows rather than hides). The render-side discard: callers
 * render the original when this is true. */
export function isSameLanguagePost(sourceLang: string | null, viewerPrimary: string): boolean {
  if (sourceLang == null) return false
  const src = sourceLang.trim()
  if (!src) return false
  const viewer = viewerPrimary.trim().split(/[-_]/)[0]?.toLowerCase() ?? ''
  if (!viewer) return false
  if ((src.split(/[-_]/)[0]?.toLowerCase() ?? '') === viewer) return true
  return !translationDiffers(sourceLang, viewerPrimary)
}

/** Display policy for one fetched result against the displayed original.
 * - Identical output (normalized) never shows: misdetections like an
 *   English post labeled "German" with byte-equal text stay silent.
 * - A differing sourceLang shows with its `Translated from {sourceLang}`
 *   label (the normal path).
 * - A result claiming the viewer's language while the text changed
 *   substantially shows with a generic label (no false source claim) ONLY
 *   when the original carries a foreign script — the detection
 *   demonstrably misfired. Same-script rewrites stay hidden: normalization
 *   noise or a same-language hallucination, neither helps the viewer. */
export function decideTranslation(
  original: string,
  result: {sourceLang: string | null; text: string},
  viewerPrimary: string,
): TranslationDecision {
  const a = normalizeForCompare(original)
  const b = normalizeForCompare(result.text)
  if (!a || !b || a === b) return {show: false}
  if (translationDiffers(result.sourceLang, viewerPrimary)) {
    return {show: true, label: result.sourceLang}
  }
  if (hasForeignScript(original) && distanceRatio(a, b) > SUBSTANTIAL_RATIO) {
    return {show: true, label: null}
  }
  return {show: false}
}

/** Viewer language primary subtag from a locale tag (`zh-CN` → `zh`). */
export function viewerPrimaryOf(locale: string | undefined | null): string {
  const primary = (locale ?? '').split(/[-_]/)[0]?.toLowerCase() ?? ''
  return primary || 'en'
}
