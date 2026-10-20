// Shared post-body helpers: AST selection + packed emoji maps.
// The renderer is chosen PER POST from what is actually present
// (Akkoma can carry MFM source) — never assumed from the server.
import {contentFromHtml, contentFromMfm, t, type ContentNode, type Post} from '@keystone/fedi'

export function postBodyNodes(post: Post): ContentNode[] {
  const c = post.content
  if (c.mfm) return contentFromMfm(c.mfm)
  if (c.html) return contentFromHtml(c.html)
  return c.plain ? [t(c.plain)] : []
}

/** Packed custom-emoji sources for one post: the post map first,
// then the author's map. Lookup order is enforced by
// `lookupPackedEmojis`; this only unions the sources. */
export function postEmojis(post: Post): Record<string, string> {
  return {...post.author.emojis, ...post.emojis}
}
