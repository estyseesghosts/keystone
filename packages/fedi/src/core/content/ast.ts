// The ONE allow-listed inline content AST (plan §2, slice 2.4).
//
// Both content sources — Misskey-family MFM (`fromMfm.ts`, via `mfm-js`)
// and Mastodon-family server HTML (`fromHtml.ts`, via `htmlparser2`) —
// parse into this shape. One `RichText` renders it everywhere (Phase 3);
// no `innerHTML`, no WebView, never the raw server string.
//
// Nodes are plain serializable interfaces in a discriminated union —
// framework-free, `JSON.stringify`-safe. Decorative MFM extras (`fn`)
// survive with name + args + children; renderers that do not implement a
// given function degrade to the children. Block structure (paragraphs,
// headings, list items) is expressed with `br` pairs between blocks —
// there are no paragraph/list/heading nodes by design (the allow-list
// stays inline-only).

/** A parsed content node. `children` order is document order. */
export type ContentNode =
  | { kind: "text"; text: string }
  | { kind: "br" }
  | { kind: "link"; href: string; children: ContentNode[] }
  | { kind: "mention"; href: string | null; children: ContentNode[] }
  | { kind: "hashtag"; tag: string; href: string | null; children: ContentNode[] }
  | { kind: "customEmoji"; name: string; host: string | null; src: string | null }
  | { kind: "unicodeEmoji"; emoji: string }
  | { kind: "bold"; children: ContentNode[] }
  | { kind: "italic"; children: ContentNode[] }
  | { kind: "strike"; children: ContentNode[] }
  | { kind: "code"; code: string }
  | { kind: "codeBlock"; language: string | null; code: string }
  | { kind: "quote"; children: ContentNode[] }
  | { kind: "fn"; name: string; args: Record<string, string | true>; children: ContentNode[] };

// --- Constructors -----------------------------------------------------------

/** Plain text leaf. */
export function t(text: string): ContentNode {
  return { kind: "text", text };
}

/** Explicit line break (`<br>`, MFM newline). */
export function br(): ContentNode {
  return { kind: "br" };
}

/** Outbound link. `href` is always a vetted absolute URL (see `safeUrl`). */
export function link(href: string, children: ContentNode[]): ContentNode {
  return { kind: "link", href, children };
}

/** A mention anchor. Never used as a bare-URL source (see quoteMarker). */
export function mention(href: string | null, children: ContentNode[]): ContentNode {
  return { kind: "mention", href, children };
}

/** A hashtag anchor. `tag` is the resolved internal tag (data-tag or href tail). */
export function hashtag(tag: string, href: string | null, children: ContentNode[]): ContentNode {
  return { kind: "hashtag", tag, href, children };
}

/** A custom emoji. `src` is null when no packed source knew the code —
 * renderers show the literal `:code:` then, never a fabricated URL. */
export function customEmoji(name: string, host: string | null, src: string | null): ContentNode {
  return { kind: "customEmoji", name, host, src };
}

/** One complete Unicode emoji sequence. */
export function unicodeEmoji(emoji: string): ContentNode {
  return { kind: "unicodeEmoji", emoji };
}

/** Inline container nodes. */
export function bold(children: ContentNode[]): ContentNode {
  return { kind: "bold", children };
}

/** Inline container nodes. */
export function italic(children: ContentNode[]): ContentNode {
  return { kind: "italic", children };
}

/** Inline container nodes. */
export function strike(children: ContentNode[]): ContentNode {
  return { kind: "strike", children };
}

/** Inline code (opaque: never sliced, never linkified). */
export function codeNode(code: string): ContentNode {
  return { kind: "code", code };
}

/** Fenced code / `<pre>` (opaque). */
export function codeBlock(language: string | null, code: string): ContentNode {
  return { kind: "codeBlock", language, code };
}

/** MFM `>` quote / HTML `<blockquote>` (transparent container). */
export function quoteNode(children: ContentNode[]): ContentNode {
  return { kind: "quote", children };
}

/** An MFM extra (`$[name args ...]`): name + args + children. Renderers
 * degrade unknown names to the children. */
export function fnNode(
  name: string,
  args: Record<string, string | true>,
  children: ContentNode[],
): ContentNode {
  return { kind: "fn", name, args, children };
}

// --- Readers ------------------------------------------------------------------

/** Visible text of a tree (links/mentions/hashtags contribute their
 * labels; custom emoji its `:code:` literal; emoji its sequence). Pure. */
export function textOf(nodes: readonly ContentNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out += node.text;
        break;
      case "unicodeEmoji":
        out += node.emoji;
        break;
      case "customEmoji":
        out += node.host ? `:${node.name}@${node.host}:` : `:${node.name}:`;
        break;
      case "code":
      case "codeBlock":
        out += node.code;
        break;
      case "br":
        break;
      default:
        out += textOf(node.children);
        break;
    }
  }
  return out;
}

/** True when the tree renders nothing (whitespace text and lone breaks
 * only — custom emoji always counts as content). Pure. */
export function isBlankContent(nodes: readonly ContentNode[]): boolean {
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        if (node.text.trim().length > 0) return false;
        break;
      case "br":
        break;
      case "customEmoji":
      case "unicodeEmoji":
        return false;
      case "code":
      case "codeBlock":
        if (node.code.trim().length > 0) return false;
        break;
      default:
        if (!isBlankContent(node.children)) return false;
        break;
    }
  }
  return true;
}

// --- URL policy (ported from the old DOM-based sanitizer; pure) --------------

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * True when the string holds an ASCII control character or space.
 * Browsers strip those when resolving URLs, so "java<newline>script:"
 * must never survive a naive prefix check. Char-code loop on purpose —
 * no regex escapes in source. Pure.
 */
export function hasUnsafeUrlChars(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A URL is safe only when it parses as an absolute http/https/mailto
 * URL with no embedded credentials. Relative, protocol-relative,
 * `javascript:`/`data:` and friends all return null (the link degrades
 * to its text). Pure.
 */
export function safeUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  if (hasUnsafeUrlChars(raw)) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null; // relative or unparseable
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.username.length > 0 || parsed.password.length > 0) return null;
  return parsed.href;
}

/**
 * `safeUrl` restricted to http/https — for things that LOAD (images)
 * rather than navigate. `mailto:` is a valid link target but never a
 * valid image source. Pure.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const href = safeUrl(raw);
  if (href === null) return null;
  const protocol = new URL(href).protocol;
  return protocol === "http:" || protocol === "https:" ? href : null;
}

// --- Mention / hashtag routing (the reunion point) ------------------------------

/**
 * The account a mention anchor points at. The server's `mentions[]`
 * carries each mention's profile URL; both sides go through `safeUrl`,
 * so the comparison is on one normalized form. Returns null for a null
 * href or a mention that matches no entry — callers then keep the
 * anchor external. Pure.
 */
export function mentionAccountIdOf(
  href: string | null,
  mentions: ReadonlyArray<{ id: string; url: string }>,
): string | null {
  const safe = safeUrl(href);
  if (safe === null) return null;
  for (const mention of mentions) {
    if (safeUrl(mention.url) === safe) return mention.id;
  }
  return null;
}

/**
 * The internal tag for a hashtag anchor: Akkoma's `data-tag`, else the
 * last path segment of Mastodon's `/tags/<tag>` href (unicode tags
 * arrive percent-encoded). Returns null when the candidate is junk —
 * callers then keep the anchor a plain external link. Pure.
 */
export function hashtagTagOf(attrs: Readonly<Record<string, string>>): string | null {
  const dataTag = attrs["data-tag"];
  if (dataTag && /^[\w-]{1,64}$/.test(dataTag)) return dataTag;
  if (!(attrs.class ?? "").split(/\s+/).includes("hashtag")) return null;
  const href = attrs.href ?? "";
  let tail: string;
  try {
    const segments = new URL(href).pathname.split("/").filter((s) => s.length > 0);
    tail = decodeURIComponent(segments[segments.length - 1] ?? "");
  } catch {
    return null;
  }
  // A plausible tag: no whitespace, no separators, bounded length.
  return /^[^\s/#?]{1,128}$/.test(tail) ? tail : null;
}
