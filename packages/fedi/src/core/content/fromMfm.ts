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
  italic,
  link,
  mention,
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
 * runs never become empty text nodes. `\r\n`/`\r` normalize to `\n`
 * first (a stray `\r` would otherwise render as a visible spacer). Pure. */
function textNodes(text: string): ContentNode[] {
  const out: ContentNode[] = [];
  for (const part of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (out.length > 0) out.push(br());
    if (part.length > 0) out.push(t(part));
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
 * empty input to no nodes. Pure. */
export function contentFromMfm(source: string | null | undefined): ContentNode[] {
  const text = source ?? "";
  if (text.length === 0) return [];
  let nodes: MfmNode[];
  try {
    nodes = parse(text);
  } catch {
    return [t(text)];
  }
  return splitRemoteCodes(nodes.flatMap(convertNode));
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
