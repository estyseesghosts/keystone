// Descriptor-arg sanitizer shared by Explore and Tag (R2.4).
//
// Feed descriptors split segments on `|` (`tag|<tag>`, `search|<q>`), so a
// raw route param or query containing `|` would parse as extra segments.
// Replacing the separator (never dropping the query) keeps Tag and the
// Explore search tabs on one rule.

/** `|` is the descriptor segment separator — never content. */
export function safeDescriptorArg(value: string): string {
  return value.replace(/\|/g, ' ').trim()
}
