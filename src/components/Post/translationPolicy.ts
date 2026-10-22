// Translation display policy (v1 `decideTranslation` behavior, own code).
// Decides whether a fetched translation is worth showing instead of the
// original body. Pure: the viewer's language arrives as a BCP47 primary
// subtag (`viewerPrimary`), never read from the locale here.

export type TranslationDecision = {show: false} | {show: true; label: string | null}

/** Comparison form: case-insensitive, all whitespace runs collapsed. */
export function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** True when any letter is non-Latin. Used only to distrust a
 * same-language detection, never to assert which language text is in. */
export function hasForeignScript(prose: string): boolean {
  const letters = prose.match(/\p{L}/gu)
  return !!letters && letters.some(ch => !/\p{Script=Latin}/u.test(ch))
}

/** Edit distance capped at `cap + 1`: full precision is pointless past the
 * substantial-difference threshold, and notes can be 3,000 chars. */
function editDistanceCapped(a: string, b: string, cap: number): number {
  if (a.length > b.length) [a, b] = [b, a]
  let prev: number[] = Array.from({length: a.length + 1}, (_, i) => i)
  for (let j = 1; j <= b.length; j++) {
    const curr: number[] = [j]
    let rowMin = j
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost)
      curr.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > cap) return cap + 1
    prev = curr
  }
  return prev[a.length]
}

/** Server normalization noise ("webdev" → "web dev") scores ~0.02 and
 * stays hidden; real rewrites score far above. */
export const SUBSTANTIAL_RATIO = 0.25

function distanceRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 0
  return editDistanceCapped(a, b, Math.ceil(longest * SUBSTANTIAL_RATIO)) / longest
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
