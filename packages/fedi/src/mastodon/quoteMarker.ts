// Textual `RE:` quote markers on the Mastodon transport (docs/quote-posts.md
// "Textual RE: fallback"). Pure: no fetching, no DOM.
//
// Reads the SANITIZED TREE, not plain text. Mastodon and Akkoma shorten long
// link text (the middle of the URL sits in invisible spans), so the quoted
// URL comes from the anchor's href. A bare URL in a text node is read too:
// Akkoma does not linkify some hosts (localhost), so a marker can arrive
// either way.
//
// Accepted shapes — one URL per marker line, at the terminal or leading end:
//   suffix:  …commentary<br>RE: <url>      (last line of the last paragraph)
//   prefix:  RE: <url><br>…commentary      (first line of the first paragraph)
// Anything else is not a marker: a mid-sentence RE:, extra text on the
// marker line, a mention or hashtag anchor as the URL, a non-web URL.

import { cleanQuoteUrl, urisMatch } from "../core/quoteUri";
import type { Post } from "../core/models";

// Structural sanitized-tree node (shape copied from the pre-2.4
// `mastodon/sanitize.ts`: slice 2.4 replaces the sanitizer with
// htmlparser2 → shared content AST and reunites this alias there).
// Pure data: text leaves + allow-listed elements. Everything here only
// reads this shape, never the DOM.
export type SanitizeNode =
  | { kind: "text"; text: string }
  | {
      kind: "element";
      /** Lowercase tag, always in the allow-list. */
      tag: string;
      /** Only survived attributes (href/class/src/alt/title/width/height/
       * data-tag); never event handlers, style, ids, or targets. */
      attrs: Readonly<Record<string, string>>;
      children: readonly SanitizeNode[];
    };

type ElementNode = Extract<SanitizeNode, { kind: "element" }>;
type TextNode = Extract<SanitizeNode, { kind: "text" }>;

export interface QuoteMarker {
  /** Cleaned absolute http(s) URL the marker names. */
  uri: string;
  /** Which end of the body the marker sat on. A suffix wins over a prefix
   * that names a different URL. */
  position: "prefix" | "suffix";
  /** Nodes (by identity) whose removal drops the marker from the body. */
  removes: Set<SanitizeNode>;
  /** Text nodes that keep the rest of their text once `RE:` is removed. */
  rewrites: Map<SanitizeNode, string>;
}

/** One inline unit of a block. Anchors are atomic: the href is the target,
 * the text is only the display form. Mentions and hashtags are `other`, so
 * they can never be a marker's URL. */
type Token =
  | { kind: "text"; node: TextNode }
  | { kind: "link"; node: ElementNode; href: string | null }
  | { kind: "br"; node: ElementNode }
  | { kind: "other"; node: SanitizeNode };

function hasClass(node: ElementNode, name: string): boolean {
  return (node.attrs.class ?? "").split(/\s+/).includes(name);
}

function flatten(nodes: readonly SanitizeNode[], out: Token[] = []): Token[] {
  for (const node of nodes) {
    if (node.kind === "text") {
      out.push({ kind: "text", node });
    } else if (node.tag === "br") {
      out.push({ kind: "br", node });
    } else if (node.tag === "a") {
      const plain = !hasClass(node, "mention") && !hasClass(node, "hashtag");
      out.push(plain ? { kind: "link", node, href: node.attrs.href ?? null } : { kind: "other", node });
    } else if (node.tag === "img") {
      out.push({ kind: "other", node });
    } else {
      flatten(node.children, out);
    }
  }
  return out;
}

/** The block a marker can sit in: the first or last top-level paragraph's
 * content, or the whole body when the server sent no paragraphs. */
function blockOf(nodes: readonly SanitizeNode[], edge: "first" | "last"): readonly SanitizeNode[] {
  const paragraphs = nodes.filter(
    (n): n is ElementNode => n.kind === "element" && n.tag === "p",
  );
  if (paragraphs.length === 0) return nodes;
  return (edge === "first" ? paragraphs[0] : paragraphs[paragraphs.length - 1]).children;
}

function isBlankText(token: Token): boolean {
  return token.kind === "text" && token.node.text.trim().length === 0;
}

/** Mark the separator before a `RE:` that starts its text node: blank text
 * and one line break may go with it. Returns false when `RE:` is glued to
 * other content (then it is not a marker). `from` is the index to start
 * looking backwards from. */
function claimSeparator(tokens: Token[], from: number, removes: Set<SanitizeNode>): boolean {
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
  removes: Set<SanitizeNode>,
  rewrites: Map<SanitizeNode, string>,
): void {
  if (left.trim().length === 0) removes.add(node);
  else rewrites.set(node, left);
}

function suffixMarker(tokens: Token[]): QuoteMarker | null {
  const removes = new Set<SanitizeNode>();
  const rewrites = new Map<SanitizeNode, string>();
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
  const removes = new Set<SanitizeNode>();
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
export function findTextualQuoteMarker(nodes: readonly SanitizeNode[]): QuoteMarker | null {
  const suffix = suffixMarker(flatten(blockOf(nodes, "last")));
  const prefix = prefixMarker(flatten(blockOf(nodes, "first")));
  if (suffix !== null && prefix !== null && urisMatch(suffix.uri, prefix.uri)) {
    for (const node of prefix.removes) suffix.removes.add(node);
    return suffix;
  }
  return suffix ?? prefix;
}

function touchesMarker(node: SanitizeNode, marker: QuoteMarker): boolean {
  if (marker.removes.has(node) || marker.rewrites.has(node)) return true;
  if (node.kind === "text") return false;
  return node.children.some((child) => touchesMarker(child, marker));
}

/** The tree with the marker removed. Pure: the input is not mutated. A
 * paragraph the marker emptied is dropped, so no blank line is left. */
export function stripQuoteMarker(
  nodes: readonly SanitizeNode[],
  marker: QuoteMarker,
): SanitizeNode[] {
  const out: SanitizeNode[] = [];
  for (const node of nodes) {
    if (marker.removes.has(node)) continue;
    if (node.kind === "text") {
      const rewritten = marker.rewrites.get(node);
      if (rewritten === undefined) out.push(node);
      else if (rewritten.length > 0) out.push({ kind: "text", text: rewritten });
      continue;
    }
    const children = stripQuoteMarker(node.children, marker);
    const emptied =
      node.tag === "p" &&
      touchesMarker(node, marker) &&
      children.every((c) => c.kind === "text" ? c.text.trim().length === 0 : c.tag === "br");
    if (emptied) continue;
    out.push({ ...node, children });
  }
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
