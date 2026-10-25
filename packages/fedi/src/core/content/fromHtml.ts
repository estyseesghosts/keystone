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
  hashtagLabelOf,
  hashtagTagOf,
  heading,
  invisible,
  isBlankContent,
  italic,
  link,
  matrix,
  matrixLabelOf,
  mention,
  mentionLabelOf,
  mergeMatrixMentions,
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

/** Hard input caps (F5): absurd server payloads degrade instead of
 * throwing or stalling the feed. */
const MAX_HTML_CHARS = 200 * 1024;
/** Walker depth cap (F5): past this, a subtree degrades to its plain
 * text — content survives, the stack does not grow. */
const MAX_DEPTH = 32;
/** Alt-text fallback bound (F13): a lone `alt` is content, not a novel. */
const MAX_ALT_TEXT = 500;

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
 * wrappers — their `li` children are the blocks (see `convertList`).
 * `tr` is a block so table rows break; cells stay inline with a space
 * separator (F13). */
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
  "tr",
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
 * are dropped before conversion. Iterative: deep hostile nesting must
 * not grow the stack (F5). */
function innerText(node: DomNode): string {
  const parts: string[] = [];
  const stack: DomNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    if (cur.type === "text" || cur.type === "cdata") {
      if (cur.data) parts.push(cur.data);
      continue;
    }
    if (cur.type === "tag" && (cur.name ?? "").toLowerCase() === "br") {
      parts.push("\n");
      continue;
    }
    const kids = cur.children ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return parts.join("");
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
  out.push(t(text));
}

/** Merge adjacent text runs in one linear pass (array join, not
 * repeated concatenation — the 100k-span quadratic fix, F13). Runs
 * into containers too; trees from the depth-capped walkers are
 * shallow, so this recursion is bounded. Pure. Exported for the
 * profile-field scanner, which has the same hot loop. */
export function coalesceText(nodes: readonly ContentNode[]): ContentNode[] {
  const out: ContentNode[] = [];
  let buf: string[] | null = null;
  const flush = (): void => {
    if (buf !== null) {
      out.push(t(buf.join("")));
      buf = null;
    }
  };
  for (const node of nodes) {
    if (node.kind === "text") {
      if (buf === null) buf = [node.text];
      else buf.push(node.text);
      continue;
    }
    flush();
    if ("children" in node) {
      out.push({ ...node, children: coalesceText(node.children) } as ContentNode);
    } else {
      out.push(node);
    }
  }
  flush();
  return out;
}

/** Convert one element's children in flow mode: block children are
 * separated by `br` pairs, blank blocks are skipped. Whitespace-only
 * text next to a block boundary is source formatting (pretty-printed
 * HTML), not content — browsers collapse it, so it is dropped rather
 * than becoming a literal run that renders as extra blank lines. Inline
 * spacing (`a <b>b</b>`) never qualifies: its neighbors are not blocks.
 * `depth` is the DOM depth of `children`; past `MAX_DEPTH` nodes
 * degrade to plain text (F5). */
function convertFlow(children: readonly DomNode[], out: ContentNode[], depth: number): void {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "tag" && BLOCK_TAGS.has((child.name ?? "").toLowerCase())) {
      const block: ContentNode[] = [];
      convertElement(child, block, depth);
      if (isBlankContent(block)) continue;
      if (out.length > 0) {
        out.push(br(), br());
      }
      out.push(...block);
      continue;
    }
    if (child.type === "text" && /^\s*$/.test(child.data ?? "")) {
      const prev = children[i - 1];
      const next = children[i + 1];
      if (isBlockTag(prev) || isBlockTag(next)) continue;
    }
    convertNode(child, out, depth);
  }
}

/** Block-level tag check for the whitespace rule above. */
function isBlockTag(node: DomNode | undefined): boolean {
  return node !== undefined && node.type === "tag" && BLOCK_TAGS.has((node.name ?? "").toLowerCase());
}

/** Convert the children of a transparent wrapper (span, div, unknown
 * tags, degraded anchors): blocks inside still break, so a `<div>`
 * wrapping paragraphs keeps its line structure. */
function convertTransparent(node: DomNode, out: ContentNode[], depth: number): void {
  convertFlow(node.children ?? [], out, depth + 1);
}

/** Convert one element KNOWN to be a block (`p`, headings, `li`,
 * `blockquote`, `pre`, `tr`) — its own tag is consumed, children flow
 * inline except nested blocks. Depth-capped (F5). */
function convertElement(node: DomNode, out: ContentNode[], depth: number): void {
  if (depth > MAX_DEPTH) {
    pushText(out, innerText(node));
    return;
  }
  const tag = (node.name ?? "").toLowerCase();
  if (tag === "blockquote") {
    const inner: ContentNode[] = [];
    convertFlow(node.children ?? [], inner, depth + 1);
    if (!isBlankContent(inner)) out.push(quoteNode(inner));
    return;
  }
  if (tag === "pre") {
    const code = innerText(node).replace(/\n+$/, "");
    if (code.length > 0) out.push(codeBlock(null, code));
    return;
  }
  // Lists have no AST list node: `ul`/`ol` are transparent wrappers and
  // each `li` opens with a marker (see `convertList`). A bare `li`
  // outside any list keeps the bullet marker here, like before.
  if (tag === "li") {
    const inner: ContentNode[] = [bullet()];
    convertFlow(node.children ?? [], inner, depth + 1);
    if (!isBlankContent(inner)) out.push(...inner);
    return;
  }
  // Headings keep their level in a `heading` node (styled by level at
  // render) instead of flattening to bold body.
  if (tag.length === 2 && tag[0] === "h" && tag[1] >= "1" && tag[1] <= "6") {
    const inner: ContentNode[] = [];
    convertFlow(node.children ?? [], inner, depth + 1);
    if (!isBlankContent(inner)) out.push(heading(Number(tag[1]) as HeadingLevel, inner));
    return;
  }
  convertFlow(node.children ?? [], out, depth + 1);
}

/** Convert one anchor: mention/hashtag/plain-link by class + data-tag,
 * degraded to its children when the href is unsafe or missing. */
function convertAnchor(node: DomNode, out: ContentNode[], depth: number): void {
  const attribs = attrsOf(node);
  const href = safeUrl(attribs["href"]);
  const inner: ContentNode[] = [];
  convertTransparent(node, inner, depth + 1);
  // Labels split across several DOM nodes (e.g. `@` + `<span>u</span>`)
  // merge here so the single-label checks below see one label.
  const kids = coalesceText(inner);
  if (href === null) {
    out.push(...kids);
    return;
  }
  const classes = classList(attribs["class"]);
  const isMention = classes.includes("mention");
  const isHashtag = classes.includes("hashtag") || (attribs["data-tag"] ?? "").length > 0;
  if (isMention && !isHashtag) {
    out.push(mention(href, kids));
    return;
  }
  if (isHashtag) {
    const tag = hashtagTagOf({
      class: attribs["class"] ?? "",
      href,
      ...(attribs["data-tag"] ? { "data-tag": attribs["data-tag"] } : {}),
    });
    if (tag !== null) {
      out.push(hashtag(tag, href, kids.length > 0 ? kids : [t(`#${tag}`)]));
      return;
    }
  }
  // A link labelled exactly one hashtag is the hashtag (pixelfed-style
  // redirect links): same phishing rule as MFM — the href dies here, so
  // no embed, no chip, no browser. Anything richer stays a link.
  const redirectTag = hashtagLabelOf(kids);
  if (redirectTag !== null) {
    out.push(hashtag(redirectTag, null, [t(`#${redirectTag}`)]));
    return;
  }
  // A Matrix-ID label is the Matrix user (href dropped — the chip
  // never navigates, so no URL survives to embed or unfurl).
  const redirectMatrix = matrixLabelOf(kids);
  if (redirectMatrix !== null) {
    out.push(matrix(redirectMatrix, [t(redirectMatrix)]));
    return;
  }
  // A link labelled exactly one handle is the mention (the
  // `[@handle@host](url)` markdown / pixelfed-anchor shape): the label
  // routes in-app, so it renders as a mention chip. The href is kept —
  // a bare `@user` label still needs the profile URL to resolve
  // remotely — and taps resolve the label first, so a mismatched URL
  // can never hijack the chip into a browser. Anything richer stays a
  // link.
  const redirectMention = mentionLabelOf(kids);
  if (redirectMention !== null) {
    out.push(mention(href, [t(redirectMention)]));
    return;
  }
  out.push(link(href, kids));
}

/** Convert one emoji-gated image; a non-emoji image contributes its
 * `alt` text when it has one (F13 accessibility fallback — still no
 * load, no tracking pixel), otherwise it is dropped. */
function convertEmojiImage(node: DomNode, out: ContentNode[]): void {
  const attribs = attrsOf(node);
  if (!isEmojiImage(attribs)) {
    const alt = (attribs["alt"] ?? "").trim();
    if (alt.length > 0) pushText(out, alt.slice(0, MAX_ALT_TEXT));
    return;
  }
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

/** `ul`/`ol` are transparent wrappers; each `li` is a block
 * (blank-line separated, like a bare `li`) opening with a marker — a
 * `bullet()` for `ul`, a `1. ` text run for `ol` (F13: the renderer owns
 * the bullet glyph but numbers are content). Blank items are skipped;
 * `ol` numbering counts every `li` so it matches the server's list. */
function convertList(node: DomNode, ordered: boolean, out: ContentNode[], depth: number): void {
  let n = 0;
  for (const child of node.children ?? []) {
    if (child.type === "tag" && (child.name ?? "").toLowerCase() === "li") {
      n += 1;
      const inner: ContentNode[] = [];
      if (depth + 1 > MAX_DEPTH) {
        pushText(inner, innerText(child));
      } else {
        convertFlow(child.children ?? [], inner, depth + 1);
      }
      if (isBlankContent(inner)) continue;
      if (out.length > 0) {
        out.push(br(), br());
      }
      out.push(...(ordered ? [t(`${n}. `), ...inner] : [bullet(), ...inner]));
      continue;
    }
    convertNode(child, out, depth + 1);
  }
}

/** Convert one node in inline position. Depth-capped (F5): past
 * `MAX_DEPTH` the subtree degrades to its plain text. */
function convertNode(node: DomNode, out: ContentNode[], depth: number): void {
  if (depth > MAX_DEPTH) {
    pushText(out, innerText(node));
    return;
  }
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
    convertAnchor(node, out, depth);
    return;
  }
  if (tag === "ol" || tag === "ul") {
    convertList(node, tag === "ol", out, depth);
    return;
  }
  switch (tag) {
    case "strong":
    case "b": {
      const inner: ContentNode[] = [];
      convertTransparent(node, inner, depth + 1);
      out.push(bold(inner));
      return;
    }
    case "em":
    case "i": {
      const inner: ContentNode[] = [];
      convertTransparent(node, inner, depth + 1);
      out.push(italic(inner));
      return;
    }
    case "s":
    case "del":
    case "strike": {
      const inner: ContentNode[] = [];
      convertTransparent(node, inner, depth + 1);
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
        convertTransparent(node, out, depth + 1);
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
      convertTransparent(node, out, depth + 1);
      return;
    }
    case "center": {
      const inner: ContentNode[] = [];
      convertTransparent(node, inner, depth + 1);
      out.push(fnNode("center", {}, inner));
      return;
    }
    case "td":
    case "th": {
      // Table cells have no AST node: the content survives inline and
      // cells separate with a space (F13). Rows break via `tr`, which is
      // a block tag; `table`/`thead`/`tbody`/`tfoot` stay transparent.
      const inner: ContentNode[] = [];
      convertTransparent(node, inner, depth + 1);
      if (!isBlankContent(inner)) {
        out.push(...inner);
        pushText(out, " ");
      }
      return;
    }
    default:
      // Unknown tag: degrade to children — text survives, the tag never
      // renders. `div`, lists (`ul`/`ol`), headings handled as blocks
      // above are NOT lost structurally: nested blocks still break.
      convertTransparent(node, out, depth + 1);
      return;
  }
}

/** Parse server HTML into the shared AST. Never throws on malformed
 * input — unparseable markup yields no nodes, hostile nesting degrades
 * to plain text, oversize input is capped, and any internal failure
 * falls back to the stripped text. Entity-decoded once by the parser;
 * output renders as constructed nodes, never HTML. Pure. */
export function contentFromHtml(html: string | null | undefined): ContentNode[] {
  if (typeof html !== "string" || html.length === 0) return [];
  const capped = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  try {
    let doc: { children?: DomNode[] };
    try {
      doc = parseDocument(capped) as unknown as { children?: DomNode[] };
    } catch {
      return fallbackNodes(capped);
    }
    const out: ContentNode[] = [];
    convertFlow(doc.children ?? [], out, 0);
    // No trailing paragraph break: the last block's separator is structure,
    // not content.
    while (out.length > 0 && out[out.length - 1].kind === "br") out.pop();
    // Coalesce first (adjacent runs merge into single text nodes), then
    // rejoin Matrix IDs split across the mention/text boundary. The
    // merge cannot create adjacent texts (it consumes the text it splits),
    // so one pass each is enough.
    return mergeMatrixMentions(coalesceText(out));
  } catch {
    return fallbackNodes(capped);
  }
}

/** Last-resort projection: tags stripped, text kept (never throws). */
function fallbackNodes(html: string): ContentNode[] {
  let text = "";
  try {
    text = html.replace(/<[^>]*>?/g, "").slice(0, MAX_HTML_CHARS);
  } catch {
    return [];
  }
  return text.length > 0 ? [t(text)] : [];
}
