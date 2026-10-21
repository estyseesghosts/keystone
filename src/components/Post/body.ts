// Shared post-body helpers: AST selection + packed emoji maps.
// The renderer is chosen PER POST from what is actually present
// (Akkoma can carry MFM source) — never assumed from the server.
import {
  contentFromHtml,
  contentFromMfm,
  findTextualQuoteMarker,
  parseTextualQuotes,
  stripQuoteMarker,
  structuredUrisOf,
  t,
  urisMatch,
  type ContentNode,
  type Post,
} from '@keystone/fedi'

/** Drop `RE: <url>` markers that duplicate the structured quote card
 * (v1 `NoteBody` pipeline: parse → find marker → strip → fold). Only
 * markers naming a *covered* target go — a textual marker with no
 * structured target stays visible (never a faked card, never hidden
 * text). Pure.
 *
 * Coverage is render state, owned by the card: pass the URIs whose card
 * (or honest unavailable fallback) this render shows. Omit the option
 * for the legacy default (every structured URI — packed cards always
 * render); pass an empty list to keep every marker (embeds render no
 * nested card, so a nested marker must stay visible). */
function stripDuplicateMfmMarkers(mfm: string, covered: readonly string[]): string {
  if (covered.length === 0) return mfm
  const dupes = parseTextualQuotes(mfm).filter(m => covered.some(uri => urisMatch(uri, m.uri)))
  if (dupes.length === 0) return mfm
  let out = mfm
  for (const m of [...dupes].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, m.start) + out.slice(m.end)
  }
  return out
}

export function postBodyNodes(
  post: Post,
  opts?: {coveredQuoteUris?: readonly string[]},
): ContentNode[] {
  const covered = opts?.coveredQuoteUris ?? structuredUrisOf(post)
  const c = post.content
  if (c.mfm) {
    const stripped = stripDuplicateMfmMarkers(c.mfm, covered)
    if (stripped.trim() === '') return []
    return contentFromMfm(stripped)
  }
  if (c.html) {
    const nodes = contentFromHtml(c.html)
    if (covered.length === 0) return nodes
    const marker = findTextualQuoteMarker(nodes)
    if (!marker || !covered.some(uri => urisMatch(uri, marker.uri))) return nodes
    return stripQuoteMarker(nodes, marker)
  }
  return c.plain ? [t(c.plain)] : []
}

/** Packed custom-emoji sources for one post: the post map first,
// then the author's map. Lookup order is enforced by
// `lookupPackedEmojis`; this only unions the sources. */
export function postEmojis(post: Post): Record<string, string> {
  return {...post.author.emojis, ...post.emojis}
}
