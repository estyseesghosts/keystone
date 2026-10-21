// Server HTML → content AST (slice 2.4).
//
// Policy ported from the old DOM-based sanitizer (which parsed with an
// inert `DOMParser` document and walked real DOM nodes): an explicit
// tag allow-list, subtree-drops for dangerous/mXSS carriers, vetted
// absolute http(s)/mailto hrefs, emoji-gated `img`, Akkoma `data-tag`
// hashtags. The walker here runs over `htmlparser2`'s parsed document
// instead — same policy, no DOM, RN-safe.
//
// Block structure (paragraphs, headings, list items, quotes, code
// blocks) has no AST node by design: blocks are joined with `br` pairs
// (a blank line), matching what `fromMfm` emits for MFM blank lines.
//
// Pure, framework-free, never throws on malformed input.

import { parseDocument } from "htmlparser2";
import {
  bold,
  br,
  bullet,
  codeBlock,
  codeNode,
  customEmoji,
  fnNode,
  hashtag,
  hashtagTagOf,
  heading,
  invisible,
  isBlankContent,
  italic,
  link,
  mention,
  quoteNode,
  safeHttpUrl,
  safeUrl,
  strike,
  t,
  unicodeEmoji,
  type ContentNode,
  type HeadingLevel,
} from "./ast";

/** Structural view of an htmlparser2 DOM node — duck-typed on purpose
 * so this module imports only `htmlparser2` itself (never its
 * transitive `domhandler` package directly). */
interface DomNode {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  data?: string;
  children?: DomNode[];
}

/** Tags whose CONTENT is dropped entirely (dangerous or mXSS carriers).
 * Anything else off the allow-list degrades to its children — text
 * survives, the tag never renders. */
const DROP_SUBTREE_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "svg",
  "math",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "canvas",
  "link",
  "meta",
  "base",
  "head",
  "title",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "dialog",
  "slot",
  "audio",
  "video",
  "source",
  "track",
  "frameset",
  "frame",
  "applet",
]);

/** Block-level tags: their converted children join the parent flow with
 * a `br` pair (blank line) on each side. `ul`/`ol` are transparent
 * wrappers — their `li` children are the blocks. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
]);

/** The only `img` that survives: a custom-emoji image (either server's
 * marking — `rel="emoji"` or an emoji class), over http/https only.
 * Anything else is dropped, never guessed. */
const EMOJI_IMG_CLASSES: ReadonlySet<string> = new Set(["emoji", "custom-emoji", "emojione"]);

function classList(raw: string | null | undefined): string[] {
  return (raw ?? "").split(/\s+/).filter((token) => token.length > 0);
}

function isEmojiImage(attribs: Record<string, string>): boolean {
  if ((attribs["rel"] ?? "").trim() === "emoji") return true;
  return classList(attribs["class"]).some((c) => EMOJI_IMG_CLASSES.has(c));
}

/** Lowercase attribute map for one element. */
function attrsOf(node: DomNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.attribs ?? {})) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

/** Visible text of a subtree (for `<pre>`/`<code>` payloads and emoji
 * shortcode fallbacks). Script/style subtrees never reach here — they
 * are dropped before conversion. */
function innerText(node: DomNode): string {
  if (node.type === "text" || node.type === "cdata") return node.data ?? "";
  let out = "";
  for (const child of node.children ?? []) {
    if (child.type === "tag") {
      if (child.name === "br") out += "\n";
      else out += innerText(child);
    } else {
      out += innerText(child);
    }
  }
  return out;
}

const SHORTCODE_PATTERN = /^:([A-Za-z0-9_+-]+(?:@[A-Za-z0-9.-]+)?):$/;

/** Bare shortcode name + host from an emoji `alt`/`title` (`:name:` /
 * `:name@host:`), else null. Pure. */
export function shortcodeOf(raw: string | null | undefined): {
  name: string;
  host: string | null;
} | null {
  if (typeof raw !== "string") return null;
  const match = SHORTCODE_PATTERN.exec(raw.trim());
  if (!match) return null;
  const inner = match[1];
  const at = inner.indexOf("@");
  if (at < 0) return { name: inner, host: null };
  const name = inner.slice(0, at);
  const host = inner.slice(at + 1);
  if (name.length === 0 || host.length === 0) return null;
  return { name, host };
}

/** Last-resort code for an emoji image with no usable alt/title: the
 * file stem (`thinking.png` → `thinking`). Never a URL — the renderer
 * shows the literal `:stem:` unless a packed map resolves it. */
function stemOf(src: string): string | null {
  let tail = src.split("/").pop() ?? "";
  tail = tail.split("?")[0].split("#")[0];
  const dot = tail.lastIndexOf(".");
  const stem = (dot > 0 ? tail.slice(0, dot) : tail).trim();
  return /^[A-Za-z0-9_+-]{1,64}$/.test(stem) ? stem : null;
}

function pushText(out: ContentNode[], text: string): void {
  if (text.length === 0) return;
  const last = out[out.length - 1];
  if (last && last.kind === "text") {
    out[out.length - 1] = t(last.text + text);
    return;
  }
  out.push(t(text));
}

/** Convert one element's children in flow mode: block children are
 * separated by `br` pairs, blank blocks are skipped. */
function convertFlow(children: readonly DomNode[], out: ContentNode[]): void {
  for (const child of children) {
    if (child.type === "tag" && BLOCK_TAGS.has((child.name ?? "").toLowerCase())) {
      const block: ContentNode[] = [];
      convertElement(child, block);
      if (isBlankContent(block)) continue;
      if (out.length > 0) {
        out.push(br(), br());
      }
      out.push(...block);
      continue;
    }
    convertNode(child, out);
  }
}

/** Convert the children of a transparent wrapper (span, div, unknown
 * tags, degraded anchors): blocks inside still break, so a `<div>`
 * wrapping paragraphs keeps its line structure. */
function convertTransparent(node: DomNode, out: ContentNode[]): void {
  convertFlow(node.children ?? [], out);
}

/** Convert one element KNOWN to be a block (`p`, headings, `li`,
 * `blockquote`, `pre`) — its own tag is consumed, children flow inline
 * except nested blocks. */
function convertElement(node: DomNode, out: ContentNode[]): void {
  const tag = (node.name ?? "").toLowerCase();
  if (tag === "blockquote") {
    const inner: ContentNode[] = [];
    convertFlow(node.children ?? [], inner);
    if (!isBlankContent(inner)) out.push(quoteNode(inner));
    return;
  }
  if (tag === "pre") {
    const code = innerText(node).replace(/\n+$/, "");
    if (code.length > 0) out.push(codeBlock(null, code));
    return;
  }
  // Lists have no AST list node: `ul`/`ol` are transparent wrappers and
  // each `li` opens with a `bullet()` marker (the renderer owns the glyph,
  // never server text — so a pruned tag block can never leave a stray
  // "• "). An `li` with no other content is skipped, like a blank block.
  if (tag === "li") {
    const inner: ContentNode[] = [bullet()];
    convertFlow(node.children ?? [], inner);
    if (!isBlankContent(inner)) out.push(...inner);
    return;
  }
  // Headings keep their level in a `heading` node (styled by level at
  // render) instead of flattening to bold body.
  if (tag.length === 2 && tag[0] === "h" && tag[1] >= "1" && tag[1] <= "6") {
    const inner: ContentNode[] = [];
    convertFlow(node.children ?? [], inner);
    if (!isBlankContent(inner)) out.push(heading(Number(tag[1]) as HeadingLevel, inner));
    return;
  }
  convertFlow(node.children ?? [], out);
}

/** Convert one anchor: mention/hashtag/plain-link by class + data-tag,
 * degraded to its children when the href is unsafe or missing. */
function convertAnchor(node: DomNode, out: ContentNode[]): void {
  const attribs = attrsOf(node);
  const href = safeUrl(attribs["href"]);
  const inner: ContentNode[] = [];
  convertTransparent(node, inner);
  if (href === null) {
    out.push(...inner);
    return;
  }
  const classes = classList(attribs["class"]);
  const isMention = classes.includes("mention");
  const isHashtag = classes.includes("hashtag") || (attribs["data-tag"] ?? "").length > 0;
  if (isMention && !isHashtag) {
    out.push(mention(href, inner));
    return;
  }
  if (isHashtag) {
    const tag = hashtagTagOf({
      class: attribs["class"] ?? "",
      href,
      ...(attribs["data-tag"] ? { "data-tag": attribs["data-tag"] } : {}),
    });
    if (tag !== null) {
      out.push(hashtag(tag, href, inner.length > 0 ? inner : [t(`#${tag}`)]));
      return;
    }
  }
  out.push(link(href, inner));
}

/** Convert one emoji-gated image, or drop it. */
function convertEmojiImage(node: DomNode, out: ContentNode[]): void {
  const attribs = attrsOf(node);
  if (!isEmojiImage(attribs)) return;
  const src = safeHttpUrl(attribs["src"]);
  if (src === null) return;
  const code =
    shortcodeOf(attribs["alt"]) ??
    shortcodeOf(attribs["title"]) ??
    ((): { name: string; host: string | null } | null => {
      const stem = stemOf(src);
      return stem ? { name: stem, host: null } : null;
    })();
  if (code === null) return;
  out.push(customEmoji(code.name, code.host, src));
}

/** Convert one node in inline position. */
function convertNode(node: DomNode, out: ContentNode[]): void {
  if (node.type === "text" || node.type === "cdata") {
    pushText(out, node.data ?? "");
    return;
  }
  if (node.type !== "tag") return; // comments, directives: dropped
  const tag = (node.name ?? "").toLowerCase();
  if (DROP_SUBTREE_TAGS.has(tag)) return;

  // `span.invisible` (URL-shortening spans) survives as an `invisible`
  // node: zero-width at render, never visible text, never counted — the
  // structure outlives the parse so pruning can never leak it. Mention /
  // hashtag spans (`h-card`, `name`, `emoji`) are never invisible; only
  // the shortening spans carry the class.
  if (node.attribs) {
    const classAttr = Object.entries(node.attribs).find(([k]) => k.toLowerCase() === "class")?.[1];
    if (classList(classAttr).includes("invisible")) {
      out.push(invisible(innerText(node)));
      return;
    }
  }

  if (tag === "br") {
    out.push(br());
    return;
  }
  if (tag === "img") {
    convertEmojiImage(node, out);
    return;
  }
  if (tag === "a") {
    convertAnchor(node, out);
    return;
  }
  switch (tag) {
    case "strong":
    case "b": {
      const inner: ContentNode[] = [];
      convertTransparent(node, inner);
      out.push(bold(inner));
      return;
    }
    case "em":
    case "i": {
      const inner: ContentNode[] = [];
      convertTransparent(node, inner);
      out.push(italic(inner));
      return;
    }
    case "s":
    case "del":
    case "strike": {
      const inner: ContentNode[] = [];
      convertTransparent(node, inner);
      out.push(strike(inner));
      return;
    }
    case "code": {
      const code = innerText(node);
      if (code.length > 0) out.push(codeNode(code));
      return;
    }
    case "span": {
      // Defensive emoji span (older servers): a lone text run marked
      // `emoji` becomes one opaque emoji node so tag-block spacing and
      // fold accounting treat it as one glyph, never prose.
      const classes = classList(attrsOf(node)["class"]);
      // `span.mchip` (mention/url chips) renders its content inline as a
      // chip — the anchor child carries the link. Never dropped, never a
      // block; the renderer styles the chip.
      if (classes.includes("mchip")) {
        convertTransparent(node, out);
        return;
      }
      const kids = node.children ?? [];
      if (
        classes.includes("emoji") &&
        kids.length === 1 &&
        kids[0].type === "text" &&
        (kids[0].data ?? "").trim().length > 0
      ) {
        out.push(unicodeEmoji((kids[0].data ?? "").trim()));
        return;
      }
      convertTransparent(node, out);
      return;
    }
    case "center": {
      const inner: ContentNode[] = [];
      convertTransparent(node, inner);
      out.push(fnNode("center", {}, inner));
      return;
    }
    default:
      // Unknown tag: degrade to children — text survives, the tag never
      // renders. `div`, lists (`ul`/`ol`), headings handled as blocks
      // above are NOT lost structurally: nested blocks still break.
      convertTransparent(node, out);
      return;
  }
}

/** Parse server HTML into the shared AST. Never throws on malformed
 * input — unparseable markup yields no nodes. Entity-decoded once by
 * the parser; output renders as constructed nodes, never HTML. Pure. */
export function contentFromHtml(html: string | null | undefined): ContentNode[] {
  if (typeof html !== "string" || html.length === 0) return [];
  let doc: { children?: DomNode[] };
  try {
    doc = parseDocument(html) as unknown as { children?: DomNode[] };
  } catch {
    return [];
  }
  const out: ContentNode[] = [];
  convertFlow(doc.children ?? [], out);
  // No trailing paragraph break: the last block's separator is structure,
  // not content.
  while (out.length > 0 && out[out.length - 1].kind === "br") out.pop();
  return out;
}
