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
  mergeMatrixMentions,
  quoteNode,
  safeUrl,
  splitRemoteEmojiCodes,
  strike,
  t,
  unicodeEmoji,
  type ContentNode,
} from "./ast";

/** MFM `fn` names the renderer implements or knowingly degrades
 * (styling, color, ruby/unixtime content, motion). Anything else
 * degrades to its children at parse time, never dropped, never
 * interpreted. Decorative-only names (`sparkle`, `jump`, `twitch`,
 * `flip`, `mirror`, `border`, `position`, `crop`, motion, `blur`)
 * survive as nodes so the renderer — not the parser — decides the
 * degradation, without losing text. */
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
  "fg",
  "bg",
  "background",
  "blur",
  "rotate",
  "rotation",
  "font",
  "small",
  "center",
  "ruby",
  "unixtime",
  "border",
  "position",
  "crop",
  "flip",
  "mirror",
  "sparkle",
  "jump",
  "twitch",
]);

/** Size decorations that compound multiplicatively (`x2..x4`, `size`,
 * `scale`) — flattened past nesting depth 2 (F4). */
const SIZE_FN: ReadonlySet<string> = new Set(["x2", "x3", "x4", "size", "scale"]);

/** Total `fn` nesting cap (F4): past 8 deep, degrade to children. */
const MAX_FN_DEPTH = 8;
/** Size-`fn` nesting cap (F4): past 2 deep, flatten to children. The
 * renderer additionally clamps the accumulated size to 4x the base. */
const MAX_SIZE_DEPTH = 2;

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

function childrenOf(
  node: { children?: readonly MfmNode[] },
  fnDepth: number,
  sizeDepth: number,
): ContentNode[] {
  const out: ContentNode[] = [];
  for (const child of node.children ?? []) out.push(...convertNodeAt(child, fnDepth, sizeDepth));
  return out;
}

function safeHref(raw: string): string | null {
  return safeUrl(raw);
}

/** One MFM node → AST nodes (usually exactly one; `fn`-unknown and
 * `plain` splice to their children). `fnDepth` counts enclosing `fn`
 * nodes, `sizeDepth` enclosing size-`fn` nodes (F4 caps). Pure. */
export function convertNode(node: MfmNode): ContentNode[] {
  return convertNodeAt(node, 0, 0);
}

function convertNodeAt(node: MfmNode, fnDepth: number, sizeDepth: number): ContentNode[] {
  switch (node.type) {
    case "text":
      return textNodes(node.props.text);
    case "plain":
      return node.children.flatMap((child) => textNodes(child.props.text));
    case "bold":
      return [bold(childrenOf(node, fnDepth, sizeDepth))];
    case "italic":
      return [italic(childrenOf(node, fnDepth, sizeDepth))];
    case "strike":
      return [strike(childrenOf(node, fnDepth, sizeDepth))];
    case "small":
      return [fnNode("small", {}, childrenOf(node, fnDepth, sizeDepth))];
    case "inlineCode":
      return [codeNode(node.props.code)];
    case "blockCode":
      return [codeBlock(node.props.lang, node.props.code)];
    case "quote":
      return [quoteNode(childrenOf(node, fnDepth, sizeDepth))];
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
      const children = childrenOf(node, fnDepth, sizeDepth);
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
      return [fnNode("center", {}, childrenOf(node, fnDepth, sizeDepth))];
    case "fn": {
      const name = String(node.props.name ?? "").toLowerCase();
      if (!KNOWN_FN.has(name)) return childrenOf(node, fnDepth, sizeDepth);
      // Nesting caps (F4): a hostile `$[x4 …]` tower flattens instead of
      // compounding forever. Sizes flatten past depth 2; everything
      // flattens past total depth 8. Content is never lost — only the
      // decoration level is dropped.
      if (fnDepth >= MAX_FN_DEPTH) return childrenOf(node, fnDepth, sizeDepth);
      const size = SIZE_FN.has(name);
      if (size && sizeDepth >= MAX_SIZE_DEPTH) return childrenOf(node, fnDepth, sizeDepth);
      return [
        fnNode(
          name,
          { ...node.props.args },
          childrenOf(node, fnDepth + 1, sizeDepth + (size ? 1 : 0)),
        ),
      ];
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
