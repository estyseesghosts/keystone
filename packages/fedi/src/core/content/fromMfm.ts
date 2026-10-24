// MFM source → content AST (slice 2.4).
//
// Shapes verified against the installed `mfm-js@0.27.0`
// (`node_modules/mfm-js/built/index.d.ts`): `parse(input)` returns
// `MfmNode[]`; `text.props.text`, `plain.children: MfmText[]`,
// `bold/italic/strike/small → children`, `inlineCode.props.code`,
// `blockCode.props.{code, lang}`, `quote.children`, `mention.props.
// {username, host, acct}`, `hashtag.props.hashtag`, `url.props.url`,
// `link.props.{silent, url}` + children, `emojiCode.props.name`,
// `unicodeEmoji.props.emoji`, `fn.props.{name, args}` + children,
// `center.children: MfmInline[]`, `search.props.{query, content}`,
// `mathInline/mathBlock.props.formula`.
//
// Pure, framework-free, never throws on malformed input.

import { parse, toString, type MfmNode } from "mfm-js";
import {
  bold,
  br,
  codeBlock,
  codeNode,
  customEmoji,
  fnNode,
  hashtag,
  hashtagLabelOf,
  italic,
  link,
  mention,
  mentionLabelOf,
  matrix,
  matrixLabelOf,
  parseMatrixUserId,
  stripTokenPunctuation,
  quoteNode,
  safeUrl,
  splitRemoteEmojiCodes,
  strike,
  t,
  unicodeEmoji,
  type ContentNode,
} from "./ast";

/** MFM `fn` names the old renderer implemented (styling only — motion,
 * size, color, blur, rotate, allow-listed fonts). Anything else degrades
 * to its children at parse time, never dropped, never interpreted. */
const KNOWN_FN: ReadonlySet<string> = new Set([
  "tada",
  "jelly",
  "shake",
  "bounce",
  "spin",
  "pulse",
  "rainbow",
  "x2",
  "x3",
  "x4",
  "size",
  "scale",
  "color",
  "colour",
  "bg",
  "background",
  "blur",
  "rotate",
  "rotation",
  "font",
  "small",
  "center",
]);

/** Split MFM text on newlines: each `\n` is one `br`, so a blank line is
 * a `br` pair — the same paragraph boundary `fromHtml` emits. Empty
 * runs never become empty text nodes. Leading breaks are always kept:
 * mfm-js may split one line run across several text nodes, and a break
 * dropped at a node boundary would eat the blank line (chunking must
 * never change the output). Document-level trim happens once in
 * `contentFromMfm`. `\r\n`/`\r` normalize to `\n` first (a stray `\r`
 * would otherwise render as a visible spacer). Pure. */
function textNodes(text: string): ContentNode[] {
  const out: ContentNode[] = [];
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) out.push(br());
    if (parts[i].length > 0) out.push(t(parts[i]));
  }
  return out;
}

function childrenOf(node: { children?: readonly MfmNode[] }): ContentNode[] {
  const out: ContentNode[] = [];
  for (const child of node.children ?? []) out.push(...convertNode(child));
  return out;
}

function safeHref(raw: string): string | null {
  return safeUrl(raw);
}

/** One MFM node → AST nodes (usually exactly one; `fn`-unknown and
 * `plain` splice to their children). Pure. */
export function convertNode(node: MfmNode): ContentNode[] {
  switch (node.type) {
    case "text":
      return textNodes(node.props.text);
    case "plain":
      return node.children.flatMap((child) => textNodes(child.props.text));
    case "bold":
      return [bold(childrenOf(node))];
    case "italic":
      return [italic(childrenOf(node))];
    case "strike":
      return [strike(childrenOf(node))];
    case "small":
      return [fnNode("small", {}, childrenOf(node))];
    case "inlineCode":
      return [codeNode(node.props.code)];
    case "blockCode":
      return [codeBlock(node.props.lang, node.props.code)];
    case "quote":
      return [quoteNode(childrenOf(node))];
    case "mention":
      return [mention(null, [t(node.props.acct)])];
    case "hashtag":
      return [hashtag(node.props.hashtag, null, [t(`#${node.props.hashtag}`)])];
    case "url": {
      const href = safeHref(node.props.url);
      if (href === null) return [t(node.props.url)];
      return [link(href, [t(node.props.url)])];
    }
    case "link": {
      const href = safeHref(node.props.url);
      const children = childrenOf(node);
      // A link labelled exactly one hashtag is the hashtag: redirect
      // links on tags are never honored (phishing surface), so the href
      // is dropped and no link node survives to embed, chip, or unfurl.
      const tag = hashtagLabelOf(children);
      if (tag !== null) return [hashtag(tag, null, [t(`#${tag}`)])];
      // A Matrix-ID label is the Matrix user (href dropped — the chip
      // never navigates).
      const mx = matrixLabelOf(children);
      if (mx !== null) return [matrix(mx, [t(mx)])];
      // A link labelled exactly one handle is the mention: the label
      // routes in-app as a chip (same rule as the HTML parser). The
      // href is kept for remote resolution of bare `@user` labels.
      const handle = mentionLabelOf(children);
      if (handle !== null) return [mention(href, [t(handle)])];
      if (href === null) return children.length > 0 ? children : [t(node.props.url)];
      return [link(href, children.length > 0 ? children : [t(node.props.url)])];
    }
    case "emojiCode":
      return [customEmoji(node.props.name, null, null)];
    case "unicodeEmoji":
      return [unicodeEmoji(node.props.emoji)];
    case "center":
      return [fnNode("center", {}, childrenOf(node))];
    case "fn": {
      const name = String(node.props.name ?? "").toLowerCase();
      if (!KNOWN_FN.has(name)) return childrenOf(node);
      return [fnNode(name, { ...node.props.args }, childrenOf(node))];
    }
    case "search":
      return [t(node.props.content)];
    case "mathInline":
    case "mathBlock":
      return [codeNode(node.props.formula)];
    default:
      try {
        return [t(toString(node))];
      } catch {
        return [];
      }
  }
}

/** Parse MFM source into the shared AST. Never throws: unparseable
 * input degrades to one verbatim text node (content is never dropped),
 * empty input to no nodes. Leading/trailing paragraph breaks are
 * trimmed at the document level (same rule as the HTML path). Pure. */
export function contentFromMfm(source: string | null | undefined): ContentNode[] {
  const text = source ?? "";
  if (text.length === 0) return [];
  let nodes: MfmNode[];
  try {
    nodes = parse(text);
  } catch {
    return [t(text)];
  }
  const out = splitRemoteCodes(nodes.flatMap(convertNode));
  const merged = mergeMatrixMentions(out);
  while (merged.length > 0 && merged[0].kind === "br") merged.shift();
  while (merged.length > 0 && merged[merged.length - 1].kind === "br") merged.pop();
  return merged;
}

/** Split remote `:name@host:` codes out of text runs (F11). mfm-js
 * leaves them inside `text` nodes — without this they render
 * literally. Local `:name:` codes already arrive as `emojiCode` nodes.
 * Code spans/blocks are never split (verbatim). Pure. */
function splitRemoteCodes(nodes: readonly ContentNode[]): ContentNode[] {
  const out: ContentNode[] = [];
  for (const node of nodes) {
    if (node.kind === "text") {
      for (const part of splitRemoteEmojiCodes(node.text)) {
        if (part.kind === "text") {
          if (part.text.length > 0) out.push(t(part.text));
        } else {
          out.push(customEmoji(part.name, part.host, null));
        }
      }
      continue;
    }
    if ("children" in node) {
      out.push({ ...node, children: splitRemoteCodes(node.children) } as ContentNode);
      continue;
    }
    out.push(node);
  }
  return out;
}

/** A bare local mention label (`@name`, no host), else null. mfm-js
 * emits Matrix IDs as exactly this plus trailing `:server` text. */
function bareLocalMentionLabel(node: ContentNode): string | null {
  if (node.kind !== "mention" || node.children.length !== 1) return null;
  const only = node.children[0];
  if (!only || only.kind !== "text") return null;
  return /^@[\w-]+$/.test(only.text) ? only.text : null;
}

const MATRIX_SUFFIX_PATTERN = /^:([A-Za-z0-9.-]+(?::\d+)?)/;

/** Rejoin Matrix IDs mfm-js splits into a local mention plus trailing
 * `:server` text (`@jm:nope.chat` → one matrix node). Only merges when
 * the suffix is DNS-shaped (a dot, optional `:port`) with no space —
 * `@user: hello` and `@3:30` timestamps never qualify. Transparent
 * containers recurse; link / mention / hashtag / code labels are never
 * rewritten. Pure. */
function mergeMatrixMentions(nodes: ContentNode[]): ContentNode[] {
  const out: ContentNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (
      node.kind === "bold" ||
      node.kind === "italic" ||
      node.kind === "strike" ||
      node.kind === "fn" ||
      node.kind === "quote"
    ) {
      out.push({ ...node, children: mergeMatrixMentions(node.children) } as ContentNode);
      continue;
    }
    const local = bareLocalMentionLabel(node);
    const next = i + 1 < nodes.length ? nodes[i + 1] : undefined;
    if (local !== null && next && next.kind === "text") {
      const suffix = MATRIX_SUFFIX_PATTERN.exec(next.text);
      if (suffix) {
        const server = stripTokenPunctuation(suffix[1]);
        const id = parseMatrixUserId(`${local}:${server}`);
        if (id !== null) {
          out.push(matrix(id, [t(id)]));
          const rest = next.text.slice(1 + server.length);
          if (rest.length > 0) out.push(t(rest));
          i++;
          continue;
        }
      }
    }
    out.push(node);
  }
  return out;
}
