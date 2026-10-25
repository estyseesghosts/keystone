// Profile field values → content AST (pure, framework-free).
//
// Mastodon-family values arrive as HTML, Misskey-family values as plain
// text that often carries markdown links (`[label](url)` for personal
// sites and contact methods), bare URLs, and bare `@handle` mentions —
// all dead unless scanned back out. This module parses HTML first (both
// families' anchors keep working), then expands eligible text runs
// (never inside link / mention / hashtag / code — labels already
// decided there). Hashtags stay text: a field tag is not a routable
// tag. A link labelled exactly one handle becomes a mention chip (same
// rule as both content parsers); a lone-hashtag label becomes the tag
// with the href dropped (same phishing rule).

import {
  hashtag,
  hashtagLabelOf,
  link,
  matrix,
  matrixLabelOf,
  mention,
  mentionLabelOf,
  mergeMatrixMentions,
  mismatchForLink,
  safeUrl,
  splitMatrixMatch,
  stripTokenPunctuation,
  t,
  validTranslatedHandle,
  type ContentNode,
} from "./ast";
import { coalesceText, contentFromHtml } from "./fromHtml";

const FIELD_MARKDOWN_PATTERN = /\[([^\[\]\n]+)\]\(([^)\s]+)\)/g;
const FIELD_TOKEN_PATTERN =
  /((?:^|[\s>(])@[A-Za-z0-9._=\-/+]+:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?)|(^|[\s>(])@([\w-]+(?:\.[\w-]+)*(?:@[\w.-]+)?)|(https?:\/\/[^\s<]+)/g;

/** Text runs that must not be re-scanned (their labels already
 * decided): links, mentions, hashtags, and opaque code. */
const FIELD_OPAQUE: ReadonlySet<ContentNode["kind"]> = new Set([
  "link",
  "mention",
  "hashtag",
  "code",
  "codeBlock",
]);

function pushFieldText(out: ContentNode[], s: string): void {
  if (s.length === 0) return;
  out.push(t(s));
}

/** One non-markdown run: bare URLs linkify, bare handles chip. Newlines
 * stay literal text (field rendering today, never `br`). */
function scanFieldSegment(seg: string, out: ContentNode[]): void {
  FIELD_TOKEN_PATTERN.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = FIELD_TOKEN_PATTERN.exec(seg)) !== null) {
    const full = match[0];
    // Matrix IDs first: `@local:server` must never read as a local
    // `@local` mention with trailing text.
    if (match[1] !== undefined) {
      const split = splitMatrixMatch(full);
      if (split !== null) {
        pushFieldText(out, seg.slice(last, match.index) + split.lead);
        out.push(matrix(split.id, [t(split.id)]));
        pushFieldText(out, split.trail);
        last = match.index + full.length;
        continue;
      }
      pushFieldText(out, seg.slice(last, match.index) + full);
      last = match.index + full.length;
      continue;
    }
    const lead = match[2] ?? "";
    const token = stripTokenPunctuation(full.slice(lead.length));
    const trail = full.slice(lead.length + token.length);
    pushFieldText(out, seg.slice(last, match.index) + lead);
    if (token.startsWith("@")) {
      const ref = validTranslatedHandle(token.slice(1));
      if (ref !== null) {
        out.push(mention(null, [t(`@${ref.username}${ref.host ? `@${ref.host}` : ""}`)]));
        pushFieldText(out, trail);
        last = match.index + full.length;
        continue;
      }
    } else {
      const href = safeUrl(token);
      if (href !== null && /^https?:\/\//.test(href)) {
        out.push(link(href, [t(token)]));
        pushFieldText(out, trail);
        last = match.index + full.length;
        continue;
      }
    }
    pushFieldText(out, full);
    last = match.index + full.length;
  }
  pushFieldText(out, seg.slice(last));
}

/** Expand markdown links, bare URLs, and bare mentions in one text run. */
function expandFieldText(text: string, out: ContentNode[]): void {
  FIELD_MARKDOWN_PATTERN.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = FIELD_MARKDOWN_PATTERN.exec(text)) !== null) {
    scanFieldSegment(text.slice(last, match.index), out);
    const label = match[1];
    const rawHref = match[2];
    // A Matrix-ID label is the Matrix user, href dropped (a web URL is
    // meaningless for Matrix and the chip never navigates).
    const mx = matrixLabelOf([t(label)]);
    if (mx !== null) {
      out.push(matrix(mx, [t(mx)]));
    } else {
      const handle = mentionLabelOf([t(label)]);
      if (handle !== null) {
        // The href is kept: a bare `@user` label still needs the profile
        // URL to resolve remotely (a null href resolves locally only).
        // Taps resolve the label first, so a mismatched URL can never
        // hijack the chip into a browser.
        out.push(mention(safeUrl(rawHref), [t(handle)]));
      } else {
        const tag = hashtagLabelOf([t(label)]);
        if (tag !== null) {
          out.push(hashtag(tag, null, [t(`#${tag}`)]));
        } else {
          const href = safeUrl(rawHref);
          // F6: a URL/host-shaped label on a different host is marked
          // for the renderer to disclose + confirm.
          if (href !== null && /^https?:\/\//.test(href))
            out.push(link(href, [t(label)], mismatchForLink(label, href)));
          else pushFieldText(out, match[0]);
        }
      }
    }
    last = match.index + match[0].length;
  }
  scanFieldSegment(text.slice(last), out);
}

/** Expand eligible text nodes in a parsed tree (transparent containers
 * recurse; opaque labels pass through untouched). */
function expandFieldNodes(nodes: ContentNode[]): ContentNode[] {
  const out: ContentNode[] = [];
  for (const node of nodes) {
    if (node.kind === "text") {
      expandFieldText(node.text, out);
      continue;
    }
    if (FIELD_OPAQUE.has(node.kind)) {
      out.push(node);
      continue;
    }
    if ("children" in node) {
      const children = expandFieldNodes(node.children);
      out.push({ ...node, children });
      continue;
    }
    out.push(node);
  }
  return out;
}

/** Parse a profile field value into the shared AST. HTML values parse as
 * HTML (both families' anchors keep working); plain-text values gain
 * live markdown links, bare URLs, and mention chips. The field scanner
 * can split a federated Matrix ID into a hosted mention plus a dangling
 * `:server` suffix, so the Matrix merge runs again after expansion
 * (same rule as both content parsers), then adjacent text runs merge
 * in one linear pass (same quadratic fix as the HTML path). Never
 * throws. */
export function contentFromFieldValue(value: string | null | undefined): ContentNode[] {
  if (typeof value !== "string" || value.length === 0) return [];
  let nodes: ContentNode[];
  try {
    nodes = contentFromHtml(value);
  } catch {
    return [t(value)];
  }
  return coalesceText(mergeMatrixMentions(expandFieldNodes(nodes)));
}
