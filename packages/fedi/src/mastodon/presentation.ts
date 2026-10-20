// Feed presentation over the SANITIZED TREE (phase3-handoff §2.3,
// specs: docs/tag-bubbles-fold-scroll-handoff.md Workstreams A + C).
// Pure functions on `SanitizeNode` trees — unit-tested in
// scripts/smoke-phase3.ts with structural fixtures. No DOM, no fetch.
//
// Workstream A — TAG BLOCKS: two or more consecutive hashtags form a
// block; the block is PRUNED from the displayed body and a `(#tag +N)`
// bubble takes its place in the header. Spacers that sit BETWEEN tags
// without breaking a run: whitespace-only text and emoji (the Beeline
// lesson — users separate tags with emoji). Lone hashtags are never
// pruned (they stay inline and become chips). The bubble label uses the
// first tag overall and the total count (allTags, deduped, first-seen
// order — including tags that never grouped: owner requirement).
// Pruning is a VIEW transformation only; persisted/server text is
// never touched.
//
// Workstream C — FOLD: never show more than ~750 chars of post text in
// a timeline. Budget rules: links and mentions contribute 0, hashtags
// DO count, emoji count as 1 visible char, everything else its text
// length. Cut at the last whitespace inside a TEXT node only —
// hashtag/emoji/code nodes are atomic (end BEFORE them, never slice).
// After the cut everything is dropped; the caller appends "…" + the
// Open post link (the `…` is appended here, on the cut text node).

import type { Account, Post } from "../core/models";
import type { SanitizeNode } from "./quoteMarker";

// Pure `data-tag`/href → tag-name reading (copied from the pre-2.4
// `mastodon/sanitize.ts`: slice 2.4 replaces the sanitizer with
// htmlparser2 → shared content AST and reunites this helper there).
function hashtagTagOf(attrs: Readonly<Record<string, string>>): string | null {
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

// --- Workstream A: tag-block pruning -----------------------------------------

function classTokens(node: SanitizeNode): string[] {
  if (node.kind !== "element") return [];
  return (node.attrs.class ?? "").split(/\s+/).filter((t) => t.length > 0);
}

export function isHashtagAnchor(node: SanitizeNode): boolean {
  return node.kind === "element" && node.tag === "a" && classTokens(node).includes("hashtag");
}

/** An emoji at tree level: the emoji-gated img, or an emoji-classed
 * span (defensive — contract §7 mentioned spans). */
function isEmojiNode(node: SanitizeNode): boolean {
  if (node.kind !== "element") return false;
  if (node.tag === "img") return true;
  return node.tag === "span" && classTokens(node).includes("emoji");
}

function isSpacer(node: SanitizeNode): boolean {
  if (node.kind === "text") return node.text.trim().length === 0;
  return isEmojiNode(node);
}

function textOf(node: SanitizeNode): string {
  if (node.kind === "text") return node.text;
  return node.children.map(textOf).join("");
}

/** The tag name of a hashtag anchor: `data-tag`/href-derived when
 * possible, else its displayed text minus the leading `#`. */
function tagOfAnchor(node: SanitizeNode): string | null {
  if (node.kind !== "element") return null;
  const viaAttrs = hashtagTagOf(node.attrs);
  if (viaAttrs !== null) return viaAttrs;
  const shown = textOf(node).trim().replace(/^#/, "");
  return shown.length > 0 ? shown : null;
}

type Atom = "tag" | "spacer" | "breaker";

function atomKind(node: SanitizeNode): Atom {
  if (isHashtagAnchor(node)) return "tag";
  if (isSpacer(node)) return "spacer";
  return "breaker";
}

function collectAllTags(nodes: readonly SanitizeNode[], out: string[]): void {
  for (const n of nodes) {
    if (n.kind === "element") {
      if (isHashtagAnchor(n)) {
        const tag = tagOfAnchor(n);
        if (tag !== null && !out.includes(tag)) out.push(tag);
      }
      collectAllTags(n.children, out);
    }
  }
}

function pruneLevel(nodes: readonly SanitizeNode[], blocks: string[][]): SanitizeNode[] {
  const keep = new Array<boolean>(nodes.length).fill(true);
  let i = 0;
  while (i < nodes.length) {
    if (atomKind(nodes[i]) !== "tag") {
      i += 1;
      continue;
    }
    // Extend the run of tag/spacer atoms starting at i.
    const j0 = i;
    let j = j0;
    const runTags: string[] = [];
    let lastTagIdx = -1;
    while (j < nodes.length) {
      const kind = atomKind(nodes[j]);
      if (kind === "breaker") break;
      if (kind === "tag") {
        const tag = tagOfAnchor(nodes[j]);
        if (tag !== null) runTags.push(tag);
        lastTagIdx = j;
      }
      j += 1;
    }
    if (runTags.length >= 2) {
      // A block: prune from the first tag through the LAST tag (any
      // trailing whitespace after the last tag stays in the prose).
      for (let x = i; x <= lastTagIdx; x += 1) keep[x] = false;
      blocks.push(runTags);
      i = lastTagIdx + 1;
    } else {
      i = j; // lone tag (or tag + trailing spacers): stays inline
    }
  }
  const out: SanitizeNode[] = [];
  nodes.forEach((n, idx) => {
    if (!keep[idx]) return;
    if (n.kind === "element" && n.children.length > 0) {
      out.push({ ...n, children: pruneLevel(n.children, blocks) });
    } else {
      out.push(n);
    }
  });
  return out;
}

export interface TagPruneResult {
  /** The display tree with every block removed. */
  nodes: SanitizeNode[];
  /** Tag runs removed, in tree order. */
  blocks: string[][];
  /** Every hashtag in the ORIGINAL tree, document order, deduped
   * first-seen — the bubble/popup set (owner requirement: includes
   * tags that never grouped). */
  allTags: string[];
}

export function pruneTagBlocks(nodes: readonly SanitizeNode[]): TagPruneResult {
  const allTags: string[] = [];
  collectAllTags(nodes, allTags);
  const blocks: string[][] = [];
  const pruned = pruneLevel(nodes, blocks);
  return { nodes: pruned, blocks, allTags };
}

// --- Workstream C: 750-char timeline fold ------------------------------------

/** Nodes that are never sliced: emoji images (1 visible char), code
 * (the spec names code nodes atomic), and hashtag anchors (a cut
 * `#ta` would link wrong). Mentions/links cost 0 and are kept whole. */
function isAtomic(node: SanitizeNode): boolean {
  if (node.kind !== "element") return false;
  if (node.tag === "img") return true;
  if (node.tag === "code" || node.tag === "pre") return true;
  return isHashtagAnchor(node);
}

/** What this node costs against the budget, in display chars. */
function atomCost(node: SanitizeNode): number {
  if (node.kind === "text") return node.text.length;
  if (node.tag === "br") return 1;
  if (node.tag === "img") return 1; // emoji: one visible char
  if (node.tag === "a") {
    if (classTokens(node).includes("mention")) return 0; // mentions: free
    if (isHashtagAnchor(node)) return textOf(node).length; // hashtags count
    return 0; // bare links: free
  }
  return node.children.reduce((sum, c) => sum + atomCost(c), 0);
}

/** Cut a text node at the last whitespace inside `budget` chars; fall
 * back to a hard cut when the slice holds no whitespace. */
function cutAtWhitespace(text: string, budget: number): string {
  const slice = text.slice(0, Math.max(0, budget));
  const lastWs = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  const cut = lastWs > 0 ? slice.slice(0, lastWs) : slice.replace(/\s+$/, "");
  return cut.length > 0 ? cut : slice;
}

interface FoldState {
  remaining: number;
  done: boolean;
}

function foldLevel(nodes: readonly SanitizeNode[], state: FoldState): SanitizeNode[] {
  const out: SanitizeNode[] = [];
  for (const node of nodes) {
    if (state.done) break;
    if (node.kind === "text") {
      if (node.text.length <= state.remaining) {
        out.push(node);
        state.remaining -= node.text.length;
      } else {
        out.push({ kind: "text", text: `${cutAtWhitespace(node.text, state.remaining)}…` });
        state.done = true;
      }
      continue;
    }
    const cost = atomCost(node);
    if (cost === 0 || cost <= state.remaining) {
      out.push(node);
      state.remaining -= cost;
      continue;
    }
    if (isAtomic(node) || node.children.length === 0) {
      // Ends BEFORE an atomic node; a fully-beyond empty element drops.
      state.done = true;
      continue;
    }
    const kids = foldLevel(node.children, state);
    if (kids.length > 0) out.push({ ...node, children: kids });
    else state.done = true;
  }
  return out;
}

export interface FoldResult {
  nodes: SanitizeNode[];
  folded: boolean;
}

export const TIMELINE_FOLD_CHARS = 750;

/**
 * Make a folded body visibly end in "…". A cut inside a text node already
 * carries it; a cut at an atomic boundary (hashtag, emoji, code, or a whole
 * element) does not, so the ellipsis goes on the last text leaf or as its
 * own text node. Links and mentions are never extended — an ellipsis inside
 * an anchor would become part of the link.
 */
function ellipsize(nodes: readonly SanitizeNode[]): SanitizeNode[] {
  const last = nodes[nodes.length - 1];
  if (last === undefined) return [{ kind: "text", text: "…" }];
  if (last.kind === "text") {
    if (last.text.endsWith("…")) return [...nodes];
    return [...nodes.slice(0, -1), { kind: "text", text: `${last.text}…` }];
  }
  const extendable =
    last.tag !== "a" && last.tag !== "img" && last.tag !== "br" && last.children.length > 0;
  if (extendable) return [...nodes.slice(0, -1), { ...last, children: ellipsize(last.children) }];
  return [...nodes, { kind: "text", text: "…" }];
}

/** Fold a (already pruned) tree to the timeline budget. Callers append
 * the "Open post" link when `folded` is true. */
export function foldTree(
  nodes: readonly SanitizeNode[],
  budget: number = TIMELINE_FOLD_CHARS,
): FoldResult {
  if (nodes.length === 0) return { nodes: [], folded: false };
  const total = nodes.reduce((sum, n) => sum + atomCost(n), 0);
  if (total <= budget) return { nodes: [...nodes], folded: false };
  const state: FoldState = { remaining: budget, done: false };
  return { nodes: ellipsize(foldLevel(nodes, state)), folded: true };
}

/**
 * The last presentation stage (parse → prune → FOLD → render), as one pure
 * decision. `pruned` is already tag-pruned and is never re-inserted
 * unpruned: detail/quote embeds (`fold` false) keep the pruned tree and
 * skip only the fold — the header bubble is derived from the same prune,
 * so body and bubble can never disagree.
 */
export function presentBody(pruned: readonly SanitizeNode[], fold: boolean): FoldResult {
  return fold ? foldTree(pruned) : { nodes: [...pruned], folded: false };
}

export interface PlainFoldResult {
  text: string;
  folded: boolean;
}

/**
 * MFM-mode fold (phase3-handoff §2.2 × Workstream C). MFM mode renders the
 * plain-text projection, so there is no tree to walk: the budget counts
 * every character (mentions, links, hashtags and `:shortcodes:` included —
 * a documented deviation from the HTML-mode budget, which makes links and
 * mentions free and emoji 1 char). Counted in code points so a cut never
 * splits a surrogate pair; cut at the last whitespace so `@user@host` and
 * `:shortcode:` are never split either. Callers append "Open post" when
 * `folded` is true.
 */
export function foldPlainText(
  text: string,
  budget: number = TIMELINE_FOLD_CHARS,
): PlainFoldResult {
  const chars = Array.from(text);
  if (chars.length <= budget) return { text, folded: false };
  const head = chars.slice(0, budget).join("");
  const lastWs = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
  const cut = lastWs > 0 ? head.slice(0, lastWs) : head.replace(/\s+$/, "");
  return { text: `${cut.length > 0 ? cut : head}…`, folded: true };
}

// --- Repost collapse (phase3-handoff §2.3, Keystone parity) ------------------

export interface CollapsedFeedItem {
  /** The status to render: the ORIGINAL when it is in the feed, else the
   * first wrapper of its group (a wrapper row displays the original's
   * content, so the banner reads from `boostedBy`). */
  status: Post;
  /** The banner's lead booster — the first boost in feed order, or null
   * when nobody boosted this row. */
  boostedBy: Account | null;
  /** Boosters beyond `boostedBy`. */
  extraBoosters: Account[];
  /** Total boosts merged into this row (0 for plain posts). */
  totalBoosters: number;
}

/** A PURE reblog: the wrapper carries no independent content (contract
 * §6: Akkoma wrappers have empty content; Mastodon wrappers likewise).
 * A wrapper with its own media/poll/quote/card is NOT pure and never
 * collapses. (This is core `isPureRenote`'s question asked over the
 * reblog wrapper; kept here for the smoke's parity checks.) */
export function isPureReblog(item: Post): boolean {
  if (item.renote === null) return false;
  return (
    (item.content.mfm ?? item.content.html ?? null) == null &&
    item.cw === null &&
    item.media.length === 0 &&
    item.poll === null &&
    item.quote === null &&
    !item.quoteUnavailable &&
    item.card === null
  );
}

/**
 * Collapse pure reblogs into their originals (Keystone `collapseReposts`,
 * ported to `Post.renote` (the plan's renote/reblog)). Feed order is newest-first, so a boost
 * usually sits ABOVE its original — the original's slot must win whatever
 * the order, or the post would show twice:
 *
 *   - the original is in the feed → its pure boosts are absorbed (no row
 *     of their own) and the original's row carries them, in feed order;
 *   - the original is NOT in the feed → the group's first wrapper takes
 *     the slot and the rest merge into it.
 *
 * Quotes, impure wrappers (own media/poll/quote/card) and plain posts
 * always keep their own row. Remaining rows keep their relative order.
 */
export function collapseReblogs(items: readonly Post[]): CollapsedFeedItem[] {
  const originals = new Set<string>();
  for (const item of items) if (item.renote === null) originals.add(item.id);

  // Pass 1: pure boosts of an original that is in the feed, grouped by it.
  const absorbed = new Map<string, Account[]>();
  for (const item of items) {
    if (item.renote === null || !isPureReblog(item)) continue;
    if (!originals.has(item.renote.id)) continue;
    const list = absorbed.get(item.renote.id) ?? [];
    list.push(item.author);
    absorbed.set(item.renote.id, list);
  }

  // Pass 2: emit rows in feed order.
  const out: CollapsedFeedItem[] = [];
  const wrapperRows = new Map<string, CollapsedFeedItem>();
  for (const item of items) {
    if (item.renote === null) {
      const boosters = absorbed.get(item.id) ?? [];
      out.push({
        status: item,
        boostedBy: boosters[0] ?? null,
        extraBoosters: boosters.slice(1),
        totalBoosters: boosters.length,
      });
      continue;
    }
    if (!isPureReblog(item)) {
      // Impure wrapper: its own row, boosted by its own account.
      out.push({ status: item, boostedBy: item.author, extraBoosters: [], totalBoosters: 1 });
      continue;
    }
    if (originals.has(item.renote.id)) continue; // absorbed into the original's row
    const targetId = item.renote.id;
    const existing = wrapperRows.get(targetId);
    if (existing) {
      existing.extraBoosters.push(item.author);
      existing.totalBoosters += 1;
      continue;
    }
    const entry: CollapsedFeedItem = {
      status: item,
      boostedBy: item.author,
      extraBoosters: [],
      totalBoosters: 1,
    };
    wrapperRows.set(targetId, entry);
    out.push(entry);
  }
  return out;
}
