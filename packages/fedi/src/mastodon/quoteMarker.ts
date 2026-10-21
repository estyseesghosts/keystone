// Textual `RE:` quote markers on the Mastodon transport (docs/quote-posts.md
// "Textual RE: fallback"). Pure: no fetching, no DOM.
//
// Reads the shared content AST, not plain text. Mastodon and Akkoma shorten
// long link text (the middle of the URL sits in invisible spans), so the
// quoted URL comes from the anchor's href. A bare URL in a text node is
// read too: Akkoma does not linkify some hosts (localhost), so a marker
// can arrive either way.
//
// Accepted shapes — one URL per marker line, at the terminal or leading end:
//   suffix:  …commentary<br>RE: <url>      (last line of the last paragraph)
//   prefix:  RE: <url><br>…commentary      (first line of the first paragraph)
// Anything else is not a marker: a mid-sentence RE:, extra text on the
// marker line, a mention or hashtag anchor as the URL, a non-web URL.
//
// Paragraphs are `br` pairs in the AST (both parsers emit them); a lone
// `br` is a line break inside a paragraph.

import { cleanQuoteUrl, urisMatch } from "../core/quoteUri";
import type { Post } from "../core/models";
import { br, isBlankContent, type ContentNode } from "../core/content/ast";

type LinkNode = Extract<ContentNode, { kind: "link" }>;
type TextNode = Extract<ContentNode, { kind: "text" }>;

export interface QuoteMarker {
  /** Cleaned absolute http(s) URL the marker names. */
  uri: string;
  /** Which end of the body the marker sat on. A suffix wins over a prefix
   * that names a different URL. */
  position: "prefix" | "suffix";
  /** Nodes (by identity) whose removal drops the marker from the body. */
  removes: Set<ContentNode>;
  /** Text nodes that keep the rest of their text once `RE:` is removed. */
  rewrites: Map<ContentNode, string>;
}

/** One inline unit of a block. Anchors are atomic: the href is the target,
 * the text is only the display form. Mentions and hashtags are `other`, so
 * they can never be a marker's URL. */
type Token =
  | { kind: "text"; node: TextNode }
  | { kind: "link"; node: LinkNode; href: string | null }
  | { kind: "br"; node: ContentNode }
  | { kind: "other"; node: ContentNode };

function flatten(nodes: readonly ContentNode[], out: Token[] = []): Token[] {
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out.push({ kind: "text", node });
        break;
      case "br":
        out.push({ kind: "br", node });
        break;
      case "link":
        out.push({ kind: "link", node, href: node.href });
        break;
      case "mention":
      case "hashtag":
      case "customEmoji":
      case "unicodeEmoji":
      case "code":
      case "codeBlock":
      case "bullet":
      case "invisible":
        out.push({ kind: "other", node });
        break;
      default:
        flatten(node.children, out);
        break;
    }
  }
  return out;
}

/** Split a top-level flow on paragraph boundaries (`br` pairs). A lone
 * `br` stays inside its block as a line break. */
function splitBlocks(nodes: readonly ContentNode[]): ContentNode[][] {
  const blocks: ContentNode[][] = [];
  let current: ContentNode[] = [];
  let i = 0;
  while (i < nodes.length) {
    if (nodes[i].kind === "br") {
      let j = i;
      while (j < nodes.length && nodes[j].kind === "br") j++;
      if (j - i >= 2) {
        blocks.push(current);
        current = [];
        i = j;
        continue;
      }
      current.push(nodes[i]);
      i++;
      continue;
    }
    current.push(nodes[i]);
    i++;
  }
  blocks.push(current);
  return blocks;
}

/** The block a marker can sit in: the first or last top-level paragraph's
 * content, or the whole body when the parsers emitted no paragraphs. */
function blockOf(nodes: readonly ContentNode[], edge: "first" | "last"): readonly ContentNode[] {
  const blocks = splitBlocks(nodes);
  if (blocks.length === 0) return nodes;
  return edge === "first" ? blocks[0] : blocks[blocks.length - 1];
}

function isBlankText(token: Token): boolean {
  return token.kind === "text" && token.node.text.trim().length === 0;
}

/** Mark the separator before a `RE:` that starts its text node: blank text
 * and one line break may go with it. Returns false when `RE:` is glued to
 * other content (then it is not a marker). `from` is the index to start
 * looking backwards from. */
function claimSeparator(tokens: Token[], from: number, removes: Set<ContentNode>): boolean {
  let q = from;
  while (q >= 0 && isBlankText(tokens[q])) {
    removes.add(tokens[q].node);
    q -= 1;
  }
  if (q < 0) return true;
  const before = tokens[q];
  if (before.kind === "br") {
    removes.add(before.node);
    return true;
  }
  return false;
}

function settleText(
  node: TextNode,
  left: string,
  removes: Set<ContentNode>,
  rewrites: Map<ContentNode, string>,
): void {
  if (left.trim().length === 0) removes.add(node);
  else rewrites.set(node, left);
}

function suffixMarker(tokens: Token[]): QuoteMarker | null {
  const removes = new Set<ContentNode>();
  const rewrites = new Map<ContentNode, string>();
  let end = tokens.length;
  while (end > 0 && isBlankText(tokens[end - 1])) {
    removes.add(tokens[end - 1].node);
    end -= 1;
  }
  if (end === 0) return null;
  const last = tokens[end - 1];

  // The text token that must end in `RE:` (before a link), or the token
  // itself (a bare URL in text). `prevIndex` is that token's position.
  let uri: string | null = null;
  let prevIndex: number;
  if (last.kind === "link") {
    uri = last.href === null ? null : cleanQuoteUrl(last.href);
    if (uri === null) return null;
    removes.add(last.node);
    prevIndex = end - 2;
    while (prevIndex >= 0 && isBlankText(tokens[prevIndex])) {
      removes.add(tokens[prevIndex].node);
      prevIndex -= 1;
    }
    const prev = tokens[prevIndex];
    if (prev === undefined || prev.kind !== "text") return null;
    const m = /(^|\s)RE:[ \t]*$/.exec(prev.node.text);
    if (m === null) return null;
    settleText(prev.node, prev.node.text.slice(0, m.index), removes, rewrites);
    if (m.index === 0 && !claimSeparator(tokens, prevIndex - 1, removes)) return null;
  } else if (last.kind === "text") {
    const m = /(^|\s)RE:[ \t]*(\S+)[ \t]*$/.exec(last.node.text);
    if (m === null) return null;
    uri = cleanQuoteUrl(m[2]);
    if (uri === null) return null;
    settleText(last.node, last.node.text.slice(0, m.index), removes, rewrites);
    if (m.index === 0 && !claimSeparator(tokens, end - 2, removes)) return null;
  } else {
    return null;
  }
  return { uri, position: "suffix", removes, rewrites };
}

function prefixMarker(tokens: Token[]): QuoteMarker | null {
  const removes = new Set<ContentNode>();
  let i = 0;
  while (i < tokens.length && isBlankText(tokens[i])) {
    removes.add(tokens[i].node);
    i += 1;
  }
  const first = tokens[i];
  if (first === undefined || first.kind !== "text") return null;

  let uri: string | null;
  let next: number;
  const whole = /^RE:[ \t]*(\S+)[ \t]*$/.exec(first.node.text);
  if (whole !== null) {
    uri = cleanQuoteUrl(whole[1]);
    if (uri === null) return null;
    removes.add(first.node);
    next = i + 1;
  } else if (/^RE:[ \t]*$/.test(first.node.text)) {
    removes.add(first.node);
    let k = i + 1;
    while (k < tokens.length && isBlankText(tokens[k])) {
      removes.add(tokens[k].node);
      k += 1;
    }
    const link = tokens[k];
    if (link === undefined || link.kind !== "link" || link.href === null) return null;
    uri = cleanQuoteUrl(link.href);
    if (uri === null) return null;
    removes.add(link.node);
    next = k + 1;
  } else {
    return null;
  }

  // The marker line ends at a line break or the end of its block. Anything
  // else on that line makes it commentary, not a bare marker.
  while (next < tokens.length && isBlankText(tokens[next])) {
    removes.add(tokens[next].node);
    next += 1;
  }
  if (next < tokens.length) {
    const after = tokens[next];
    if (after.kind !== "br") return null;
    removes.add(after.node);
  }
  return { uri, position: "prefix", removes, rewrites: new Map() };
}

/** The textual marker of one status body, or null. A terminal suffix wins
 * over a leading prefix when they name different URLs (the prefix stays as
 * text). When both name the same URL, one marker removes both lines. */
export function findTextualQuoteMarker(nodes: readonly ContentNode[]): QuoteMarker | null {
  const suffix = suffixMarker(flatten(blockOf(nodes, "last")));
  const prefix = prefixMarker(flatten(blockOf(nodes, "first")));
  if (suffix !== null && prefix !== null && urisMatch(suffix.uri, prefix.uri)) {
    for (const node of prefix.removes) suffix.removes.add(node);
    return suffix;
  }
  return suffix ?? prefix;
}

function touchesMarker(node: ContentNode, marker: QuoteMarker): boolean {
  if (marker.removes.has(node) || marker.rewrites.has(node)) return true;
  if (!("children" in node)) return false;
  return node.children.some((child) => touchesMarker(child, marker));
}

/** A top-level segment left blank by the strip (whitespace text and lone
 * breaks only) that the marker touched. */
function isEmptiedSegment(segment: readonly ContentNode[], marker: QuoteMarker): boolean {
  if (!isBlankContent(segment)) return false;
  return segment.some((node) => touchesMarker(node, marker));
}

/** The tree with the marker removed. Pure: the input is not mutated. A
 * paragraph the marker emptied is dropped, so no blank line is left —
 * edge separators orphaned by the strip are trimmed the same way. */
export function stripQuoteMarker(
  nodes: readonly ContentNode[],
  marker: QuoteMarker,
): ContentNode[] {
  const stripped: ContentNode[] = [];
  for (const node of nodes) {
    if (marker.removes.has(node)) continue;
    if (node.kind === "text") {
      const rewritten = marker.rewrites.get(node);
      if (rewritten === undefined) stripped.push(node);
      else if (rewritten.length > 0) stripped.push({ kind: "text", text: rewritten });
      continue;
    }
    if ("children" in node) {
      stripped.push({ ...node, children: stripQuoteMarker(node.children, marker) } as ContentNode);
      continue;
    }
    stripped.push(node);
  }
  // Drop emptied paragraphs (blank segments the marker touched) and trim
  // orphaned edge breaks — the AST equivalent of dropping an emptied `<p>`.
  const kept = splitBlocks(stripped).filter(
    (segment) => segment.length > 0 && !isEmptiedSegment(segment, marker),
  );
  const out = kept.flatMap((segment, index) =>
    index === 0 ? segment : [br(), br(), ...segment],
  );
  while (out.length > 0 && out[0].kind === "br") out.shift();
  while (out.length > 0 && out[out.length - 1].kind === "br") out.pop();
  return out;
}

/** The status a textual lookup returned that IS the quoted URL: exact URI
 * or web-URL match only. A search hit for anything else is not the quoted
 * post, so it is never rendered as one. */
export function pickQuotedStatus(
  statuses: readonly Post[],
  uri: string,
): Post | null {
  return (
    statuses.find(
      (s) =>
        (s.uri !== null && urisMatch(s.uri, uri)) ||
          (s.url !== null && urisMatch(s.url, uri)),
    ) ?? null
  );
}
