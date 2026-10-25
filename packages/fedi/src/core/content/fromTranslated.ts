// Translated post bodies → content AST (pure, framework-free).
//
// Split out of `core/content/ast.ts` (D3.5): the third parser alongside
// `fromMfm` / `fromHtml` / `fields`, hidden inside the "types" module until
// now. Match rules are unchanged (R2.1 widened the username classes for
// dotted bridged handles — the widened classes moved here verbatim, never
// reimplemented).
//
// Translated post bodies arrive as plain strings (no server AST), so
// mentions and bare URLs would render dead — and in v1 they are live.
// Scan them back out: `@user` / `@user@host` (same classes `parseAcct`
// accepts, tap-time resolution stays authoritative) and http(s) URLs.
// Newlines survive as `br`, like every other path.
//
// Core finding: Misskey-family translation is server-side BY NOTE ID
// (`POST /api/notes/translate {noteId, targetLang}` — see
// `misskey/translate.ts`): the client cannot scope WHAT the server
// translates, so structured-token protection is decision-side (skip the
// request via `hasTranslatableText` / `hasTranslatableNodes`) +
// render-side (this post-process). Hashtags arrive translated, and a
// translated tag is not a routable tag — so without `originalTags` the
// hashtag constructs below collapse to plain `#tag` text instead of
// rendering a chip that shows the author's instance hashtag URL.
//
// With `originalTags`: when its length equals the number of hashtag
// constructs in the translated text, each construct emits a real
// clickable `hashtag` node `{tag: original[i], href: null, children:
// [text #translated-as-written]}` paired POSITIONALLY — the tap routes
// to the ORIGINAL tag (e.g. #fotografia), never the translated
// #photography, while the label stays verbatim as translated. Count
// mismatch (or absent) keeps the plain-text behavior exactly.
// Mentions/links stay as-is: translators preserve handles/URLs.

import {
  br,
  hashtag,
  link,
  matrix,
  mention,
  safeUrl,
  splitMatrixMatch,
  stripTokenPunctuation,
  t,
  validTranslatedHandle,
  type ContentNode,
} from "./ast";

const TRANSLATED_TOKEN_PATTERN =
  /(\[#[^\s#\]]{1,128}\]\([^)\s]+\))|((?:^|[\s>(])@[A-Za-z0-9._=\-/+]+:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?)|(^|[\s>(])@([\w-]+(?:\.[\w-]+)*(?:@[\w.-]+)?)|(https?:\/\/[^\s<]+)/g;

/** Plain `#tag` text for a translated hashtag construct, else null:
// markdown `[#tag](url)`, or a bare hashtag URL (`/tags/<tag>`,
// `/hashtag/<tag>`, `?q=<tag>` / `?tag=<tag>` pixelfed-style). The tag
// is percent-decoded and validated; junk stays a link or literal. Pure. */
export function translatedHashtagOf(token: string): string | null {
  const markdown = /^\[#([^\s#\]]{1,128})\]\(([^)\s]+)\)$/.exec(token);
  if (markdown) return `#${markdown[1]}`;
  let url: URL;
  try {
    url = new URL(token);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const tailOf = (segments: string[]): string | null => {
    if (segments.length === 0) return null;
    let tail: string;
    try {
      tail = decodeURIComponent(segments[segments.length - 1] ?? "");
    } catch {
      return null;
    }
    return /^[^\s/#?]{1,128}$/.test(tail) ? tail : null;
  };
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const prev = segments.length > 1 ? (segments[segments.length - 2] ?? "").toLowerCase() : "";
  if (prev === "tags" || prev === "hashtag") {
    const tail = tailOf(segments);
    if (tail !== null) return `#${tail}`;
    return null;
  }
  const query = url.searchParams.get("q") ?? url.searchParams.get("tag");
  if (query !== null) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(query);
    } catch {
      return null;
    }
    if (/^[^\s/#?]{1,128}$/.test(decoded)) return `#${decoded}`;
  }
  return null;
}

/** Plain translated text → content nodes with live mentions and links.
 * When `originalTags` is provided AND its length equals the number of
 * hashtag constructs in the translated text, hashtag constructs become
 * clickable `hashtag` nodes paired positionally to the ORIGINAL tags
 * (tap routes to the original tag; the label stays verbatim as
 * translated). Count mismatch or absent `originalTags` keeps the
 * long-standing plain-text behavior exactly. Pure. */
export function contentFromTranslatedText(
  text: string | null | undefined,
  originalTags?: string[],
): ContentNode[] {
  if (!text) return [];
  const out: ContentNode[] = [];
  // Hashtag slots in document order: index into `out` + the translated
  // label as written. Filled with plain text during the scan, rewritten
  // to hashtag nodes afterwards only when the counts line up — a single
  // scan, never two divergent ones.
  const tagSlots: { index: number; label: string }[] = [];
  const pushText = (s: string): void => {
    if (s.length > 0) out.push(t(s));
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (out.length > 0) out.push(br());
    TRANSLATED_TOKEN_PATTERN.lastIndex = 0;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = TRANSLATED_TOKEN_PATTERN.exec(line)) !== null) {
      const full = match[0];
      // A markdown hashtag link is the tag, full stop — never a chip
      // showing the author's instance URL.
      if (match[1] !== undefined) {
        pushText(line.slice(last, match.index));
        const tag = translatedHashtagOf(full);
        if (tag !== null) tagSlots.push({ index: out.length, label: tag });
        pushText(tag ?? full);
        last = match.index + full.length;
        continue;
      }
      // A Matrix ID is colonial, never a webfinger mention: the matrix
      // alternative wins the position, so `@local` can never match here
      // with `:server` trailing.
      if (match[2] !== undefined) {
        const split = splitMatrixMatch(full);
        if (split !== null) {
          pushText(line.slice(last, match.index) + split.lead);
          out.push(matrix(split.id, [t(split.id)]));
          pushText(split.trail);
          last = match.index + full.length;
          continue;
        }
        pushText(line.slice(last, match.index) + full);
        last = match.index + full.length;
        continue;
      }
      const lead = match[3] ?? "";
      const token = stripTokenPunctuation(full.slice(lead.length));
      const trail = full.slice(lead.length + token.length);
      pushText(line.slice(last, match.index) + lead);
      if (token.startsWith("@")) {
        const ref = validTranslatedHandle(token.slice(1));
        if (ref !== null) {
          out.push(
            mention(null, [t(`@${ref.username}${ref.host ? `@${ref.host}` : ""}`)]),
          );
          pushText(trail);
          last = match.index + full.length;
          continue;
        }
      } else {
        // A bare hashtag URL is its tag as plain text, not a link.
        const tag = translatedHashtagOf(token);
        if (tag !== null) {
          tagSlots.push({ index: out.length, label: tag });
          out.push(t(tag));
          pushText(trail);
          last = match.index + full.length;
          continue;
        }
        const href = safeUrl(token);
        if (href !== null && /^https?:\/\//.test(href)) {
          out.push(link(href, [t(token)]));
          pushText(trail);
          last = match.index + full.length;
          continue;
        }
      }
      pushText(full);
      last = match.index + full.length;
    }
    pushText(line.slice(last));
  }
  // Render-side post-process (see the section comment): the server
  // translated by id, so its tags are translations — re-anchor them to
  // the ORIGINAL tags positionally. Strict count equality, else the
  // plain-text nodes above stand exactly as before.
  if (originalTags !== undefined && originalTags.length === tagSlots.length) {
    tagSlots.forEach((slot, i) => {
      out[slot.index] = hashtag(originalTags[i] as string, null, [t(slot.label)]);
    });
  }
  return out;
}
