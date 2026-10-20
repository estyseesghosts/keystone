// Quote URI helpers shared by the legacy Misskey quote path (`api/quote.ts`)
// and the Mastodon transport (`api/mastodon/quoteMarker.ts`). Pure: no
// fetching, no framework imports.

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
