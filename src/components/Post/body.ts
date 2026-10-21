// Shared post-body helpers: AST selection + packed emoji maps.
// The renderer is chosen PER POST from what is actually present
// (Akkoma can carry MFM source) — never assumed from the server.
import {
  contentFromHtml,
  contentFromMfm,
  findTextualQuoteMarker,
  parseTagBlocks as parseMfmTagBlockText,
  parseTextualQuotes,
  pruneTagBlocks as pruneHtmlTagBlockTree,
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
    // WS-B (F10): tag blocks prune after the quote strip (v1 order).
    const pruned = pruneMfmTagBlocks(stripped)
    if (pruned.trim() === '') return []
    return contentFromMfm(pruned)
  }
  if (c.html) {
    // WS-B (F10): tag blocks prune before the marker scan (v1 order).
    const nodes = pruneHtmlTagBlocks(contentFromHtml(c.html))
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

// --- WS-B (F10): tag-block pruning -------------------------------------------
// v1 `NoteCard`/`NoteBody` parity: tag blocks leave the body and surface in
// the header bubble (`TagBubble`). MFM text prunes through the MFM parser
// (`parseTagBlocks`); server HTML prunes through the AST (`pruneTagBlocks`).
// Both are view transformations — persisted/server text is never mutated.
// Order per pipeline: MFM quote-strip → tag-prune → fold; HTML parse →
// tag-prune → marker-strip → fold. Pure.

/** Tag-bubble view model for one post (v1 `NoteCard.tagView` parity):
 * MFM posts bubble the pruned block tags; HTML posts bubble every tag when
 * a block was pruned (owner requirement). `hasBlocks` false means no
 * bubble — lone hashtags stay inline only. Pure. */
export interface TagBubbleView {
  tags: string[]
  hasBlocks: boolean
}

export function postTagBubble(post: Post): TagBubbleView {
  const c = post.content
  if (c.html) {
    const pruned = pruneHtmlTagBlockTree(contentFromHtml(c.html))
    return {tags: pruned.allTags, hasBlocks: pruned.blocks.length > 0}
  }
  if (c.mfm) {
    const parsed = parseMfmTagBlockText(c.mfm)
    return {tags: parsed.blockedTags, hasBlocks: parsed.blocks.length > 0}
  }
  return {tags: [], hasBlocks: false}
}

/** MFM body text with tag blocks pruned (v1 `NoteBody` text-pipeline
 * order: quote-strip → tag-prune). Pure. */
export function pruneMfmTagBlocks(mfm: string): string {
  return parseMfmTagBlockText(mfm).prunedText
}

/** HTML body tree with tag blocks pruned (v1 `NoteBody` HTML-pipeline
 * order: parse → tag-prune → marker-strip). Pure. */
export function pruneHtmlTagBlocks(nodes: readonly ContentNode[]): ContentNode[] {
  return pruneHtmlTagBlockTree(nodes).nodes
}
