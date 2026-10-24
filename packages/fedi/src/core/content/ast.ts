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
// headings, list items) is expressed with `br` pairs between blocks, plus
// two structural markers that stay inline by design: `bullet` (one per
// `<li>`, the renderer owns the glyph) and `heading` (level + children,
// styled by level instead of flattened to bold). `invisible` carries
// server-hidden text (`span.invisible` URL-shortening spans): it is never
// rendered visibly and never counted as text, but the structure survives
// so pruning can never leak it and wrapping matches the server.

/** A parsed content node. `children` order is document order. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type ContentNode =
  | { kind: "text"; text: string }
  | { kind: "br" }
  | { kind: "bullet" }
  | { kind: "heading"; level: HeadingLevel; children: ContentNode[] }
  | { kind: "invisible"; text: string }
  | { kind: "link"; href: string; children: ContentNode[] }
  | { kind: "mention"; href: string | null; children: ContentNode[] }
  | { kind: "hashtag"; tag: string; href: string | null; children: ContentNode[] }
  | { kind: "matrix"; userId: string; children: ContentNode[] }
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

/** List-item marker (one per `<li>`): the renderer draws the bullet glyph,
 * never server text — so a pruned tag block can never leave a stray "• ". */
export function bullet(): ContentNode {
  return { kind: "bullet" };
}

/** Heading (HTML `h1`–`h6`; no MFM source): level + children, styled by
 * level instead of flattened to bold body. */
export function heading(level: HeadingLevel, children: ContentNode[]): ContentNode {
  return { kind: "heading", level, children };
}

/** Server-hidden text (`span.invisible` URL-shortening spans): carried so
 * structure survives, never rendered visibly and never counted as text. */
export function invisible(text: string): ContentNode {
  return { kind: "invisible", text };
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

/** A Matrix user ID (`@local:server`, colon — never a webfinger
 * handle). `userId` is the canonical ID; children carry the exact
 * written text. Renderers chip it (never a profile link, never a
 * browser); taps explain + copy, never navigate. */
export function matrix(userId: string, children: ContentNode[]): ContentNode {
  return { kind: "matrix", userId, children };
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
 * labels; custom emoji its `:code:` literal; emoji its sequence; bullets
 * their marker; headings their children; invisible nodes nothing). Pure. */
export function textOf(nodes: readonly ContentNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out += node.text;
        break;
      case "bullet":
        out += "\u2022 ";
        break;
      case "invisible":
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

/** Plain-text projection of a tree for the `plain` content mode: like
 * `textOf`, but line breaks survive as `\n` so the paragraph shape is
 * kept. Links/mentions/hashtags contribute their labels (never raw
 * URLs); formatting nodes are transparent; invisible nodes contribute
 * nothing (hidden text never leaks into the projection). Pure. */
export function plainTextOf(nodes: readonly ContentNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out += node.text;
        break;
      case "br":
        out += "\n";
        break;
      case "bullet":
        out += "\u2022 ";
        break;
      case "invisible":
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
      default:
        out += plainTextOf(node.children);
        break;
    }
  }
  return out;
}

/** True when the tree renders nothing (whitespace text and lone breaks,
 * bullets and invisible nodes only — custom emoji always counts as
 * content). Pure. */
export function isBlankContent(nodes: readonly ContentNode[]): boolean {
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        if (node.text.trim().length > 0) return false;
        break;
      case "br":
      case "bullet":
      case "invisible":
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

// --- Bare-link chip labels (v1 `.mchip` parity) ---------------------------

/** Short display form of a bare URL (v1 link chip): scheme stripped,
 * truncated to `max` chars with `…`. Pure. */
export function shortenBareUrl(href: string, max = 32): string {
  const noScheme = href.replace(/^https?:\/\//, "");
  if (noScheme.length <= max) return noScheme;
  return noScheme.slice(0, max - 1) + "…";
}

/** Display label when a link should render as an inline chip, else null.
 * Misskey bare URLs (visible text IS the href) shorten; Mastodon
 * server-shortened links (visible text + `invisible` remainder) keep the
 * server's visible label (capped). Labeled links ("click here") never
 * qualify, and neither do non-web schemes. Pure. */
export function bareLinkLabel(node: ContentNode): string | null {
  if (node.kind !== "link") return null;
  if (!/^https?:\/\//.test(node.href)) return null;
  let visible = "";
  let hasInvisible = false;
  for (const child of node.children) {
    if (child.kind === "text") visible += child.text;
    else if (child.kind === "invisible") hasInvisible = true;
    else return null;
  }
  if (visible.length === 0) return null;
  if (visible === node.href) return shortenBareUrl(node.href);
  if (hasInvisible) return visible.length > 48 ? visible.slice(0, 47) + "…" : visible;
  return null;
}

// --- Translated-text nodes --------------------------------------------------
// Translated post bodies arrive as plain strings (no server AST), so
// mentions and bare URLs would render dead — and in v1 they are live.
// Scan them back out: `@user` / `@user@host` (same classes `parseAcct`
// accepts, tap-time resolution stays authoritative) and http(s) URLs.
// Newlines survive as `br`, like every other path. Hashtags stay text:
// a translated tag is not a routable tag — markdown hashtag links and
// bare hashtag URLs collapse to plain `#tag` text instead of rendering
// a chip that shows the author's instance hashtag URL. Pure.
const TRANSLATED_TOKEN_PATTERN =
  /(\[#[^\s#\]]{1,128}\]\([^)\s]+\))|((?:^|[\s>(])@[A-Za-z0-9._=\-/+]+:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?)|(^|[\s>(])@([\w-]+(?:@[\w.-]+)?)|(https?:\/\/[^\s<]+)/g;

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

/** Trailing punctuation is prose, never address (matches and lookups
 * would fail or mistarget on it). Shared with the field-value scanner.
 * Pure. */
export function stripTokenPunctuation(token: string): string {
  return token.replace(/[.,;:!?)\]}>]+$/, "");
}

export function validTranslatedHandle(handle: string): { username: string; host: string | null } | null {
  const parts = handle.split("@");
  if (parts.length > 2) return null;
  const [username, host] = parts;
  // Same dotted-username allowance as `parseAcct` (bridged actors).
  if (!username || !/^[\w-]+(?:\.[\w-]+)*$/.test(username)) return null;
  if (host !== undefined && (host.length === 0 || !/^[\w.-]+$/.test(host))) return null;
  return { username, host: host ?? null };
}

/** Plain translated text → content nodes with live mentions and links. */
export function contentFromTranslatedText(text: string | null | undefined): ContentNode[] {
  if (!text) return [];
  const out: ContentNode[] = [];
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
  return out;
}

/** Every bare-link href in a tree, in document order (nested included).
 * PostCard uses the count: a lone bare link with an embed card for it
 * hides its chip (the card carries the action). Pure. */
export function collectBareLinkHrefs(nodes: readonly ContentNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly ContentNode[]): void => {
    for (const node of list) {
      if (node.kind === "link") {
        const label = bareLinkLabel(node);
        if (label !== null) out.push(node.href);
      }
      if ("children" in node) walk(node.children);
    }
  };
  walk(nodes);
  return out;
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

/**
 * The tag when a link's ENTIRE visible label is one hashtag
 * (`[#tag](url)` markdown, pixelfed-style `?q=` redirect links) — or
 * null. A hashtag must never carry a redirect link (phishing surface),
 * so callers drop the href entirely and render a plain hashtag: no
 * embed, no chip, no browser. Anything richer than a lone `#tag`
 * label stays a link. Pure.
 */
export function hashtagLabelOf(children: readonly ContentNode[]): string | null {
  if (children.length !== 1) return null;
  const only = children[0];
  const label = only.kind === "text" ? only.text.trim() : null;
  if (label === null) return null;
  const match = /^#([^\s#]{1,128})$/.exec(label);
  return match ? (match[1] as string) : null;
}

/**
 * The canonical handle when a link's ENTIRE visible label is one handle
 * (`[@user@host](url)` markdown, a bare `@user` anchor) — or null. The
 * mention analog of `hashtagLabelOf`: the label routes in-app (taps
 * resolve the handle first and never open the href blindly), so callers
 * render a mention chip instead of an external link. Matrix IDs
 * (`@local:server`, colon) are explicitly rejected here — they are
 * never webfinger handles. Anything richer than a lone handle stays a
 * link. Pure.
 */
export function mentionLabelOf(children: readonly ContentNode[]): string | null {
  if (children.length !== 1) return null;
  const only = children[0];
  const label = only.kind === "text" ? only.text.trim() : null;
  if (label === null || !label.startsWith("@")) return null;
  if (label.includes(":")) return null;
  const ref = validTranslatedHandle(label.slice(1));
  if (ref === null) return null;
  return `@${ref.username}${ref.host ? `@${ref.host}` : ""}`;
}

// --- Matrix user IDs (`@local:server`) ---------------------------------------
// A Matrix ID is colonial, not webfinger: `@handle:domain` must never
// parse as a local `@handle` mention with `:domain` trailing text. The
// scanners below match the matrix shape FIRST at every `@` position;
// `parseMatrixUserId` is the single validity gate (scanners are
// intentionally looser; the gate decides).

const MATRIX_LOCALPART = "[A-Za-z0-9._=\\-/+]";
const MATRIX_SERVER = "[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+(?::\\d+)?";
const MATRIX_USERID_PATTERN = new RegExp(`^@(${MATRIX_LOCALPART}+):(${MATRIX_SERVER})$`);

/** Canonical `@local:server` for an exact-shape Matrix ID, else null.
 * The server must be DNS-shaped (a dot) with an optional `:port`;
 * bare `@local`, webfinger `@local@host`, and dot-less servers all
 * fail. Case is preserved verbatim (IDs are case-sensitive). Pure. */
export function parseMatrixUserId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const match = MATRIX_USERID_PATTERN.exec(raw);
  if (!match) return null;
  return `@${match[1]}:${match[2]}`;
}

/** Canonical Matrix ID for a lone-handle link label, else null — the
 * matrix analog of `mentionLabelOf` / `hashtagLabelOf`. Pure. */
export function matrixLabelOf(children: readonly ContentNode[]): string | null {
  if (children.length !== 1) return null;
  const only = children[0];
  const label = only.kind === "text" ? only.text.trim() : null;
  if (label === null) return null;
  return parseMatrixUserId(label);
}

/** Split a scanned matrix match (lead char + candidate ID) into its
 * parts: the lead to re-emit, the canonical ID, and the trailing
 * punctuation to re-emit. Null when the candidate is not a valid ID
 * (unreachable for pattern hits, but cheap insurance). Pure. */
export function splitMatrixMatch(full: string): { lead: string; id: string; trail: string } | null {
  const lead = full.startsWith("@") ? "" : full.slice(0, 1);
  const raw = stripTokenPunctuation(full.slice(lead.length));
  const id = parseMatrixUserId(raw);
  if (id === null) return null;
  return { lead, id, trail: full.slice(lead.length + raw.length) };
}

/** A mention label usable as a Matrix localpart (`@name`), else null.
 * Both parsers emit Matrix IDs as exactly this plus trailing `:server`
 * text (mfm-js splits them; Mastodon's autolinker links only the
 * `@name` half as a hallucinated local mention). Hosted labels
 * (`@name@fedihost`) also qualify, returning the bare `@name`: a
 * Misskey-family server federating Mastodon's shredded
 * `<a>@JM</a>:nope.chat` field markup rewrites the hallucinated
 * mention to `@JM@mstdn.ca` and leaves `:nope.chat` dangling, so the
 * merge must see through the injected host. */
function matrixMergeLocal(node: ContentNode): string | null {
  if (node.kind !== "mention" || node.children.length !== 1) return null;
  const only = node.children[0];
  if (!only || only.kind !== "text") return null;
  if (/^@[\w-]+$/.test(only.text)) return only.text;
  const hosted = /^@([\w-]+)@[\w.-]+$/.exec(only.text);
  return hosted ? `@${hosted[1]}` : null;
}

const MATRIX_SUFFIX_PATTERN = /^:([A-Za-z0-9.-]+(?::\d+)?)/;

/** Transparent containers a merge may recurse into (labels already
 * decided inside link / mention / hashtag / code are never
 * rewritten). */
const MATRIX_MERGE_CONTAINERS: ReadonlySet<ContentNode["kind"]> = new Set([
  "bold",
  "italic",
  "strike",
  "fn",
  "quote",
  "heading",
]);

/** Rejoin Matrix IDs the parsers split into a mention plus
 * trailing `:server` text (`@JM` + `:nope.chat` → one matrix node,
 * Mastodon's hallucinated profile URL dropped with it). A hosted
 * mention label (`@JM@mstdn.ca`, Misskey's federation rewrite of the
 * shredded field markup) merges the same way, the injected host
 * dropped: the result is always the bare `@local:server`. Only merges
 * when the suffix is DNS-shaped (a dot, optional `:port`) with no
 * space — `@user: hello` prose and `@3:30` timestamps never qualify.
 * Uniform across both parsers: the same keystrokes mean the same ID
 * on every family. Pure. */
export function mergeMatrixMentions(nodes: ContentNode[]): ContentNode[] {
  const out: ContentNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (MATRIX_MERGE_CONTAINERS.has(node.kind) && "children" in node) {
      out.push({ ...node, children: mergeMatrixMentions(node.children) } as ContentNode);
      continue;
    }
    const local = matrixMergeLocal(node);
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

// --- Remote custom-emoji codes (`:name@host:`) --------------------------
//
// Moved here from `api/emoji` so the MFM parser (core) can split them
// without depending on the adapter-flavored emoji module. Re-exported
// from `api/emoji` for compatibility.

/** Text segment split on remote `:name@host:` codes (mfm-js never emits
 * these as `emojiCode` nodes — they arrive inside `text`). Local codes
 * are left alone (the MFM parser owns those). Pure. */
export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "remote"; code: string; name: string; host: string };

const REMOTE_CODE_PATTERN = /:([A-Za-z0-9_+-]+)@([A-Za-z0-9.-]+):/g;

/** Split remote emoji codes out of plain text. Adjacent codes each
 * become their own part; everything else stays verbatim. Pure. */
export function splitRemoteEmojiCodes(text: string): TextSegment[] {
  const parts: TextSegment[] = [];
  let last = 0;
  REMOTE_CODE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REMOTE_CODE_PATTERN.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ kind: "text", text: text.slice(last, match.index) });
    }
    parts.push({
      kind: "remote",
      code: match[0],
      name: match[1],
      host: match[2],
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

