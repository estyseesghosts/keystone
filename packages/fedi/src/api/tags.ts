// Tag-block detection + pruning (pure; no DOM, no Solid).
//
// A **tag block** is two or more consecutive hashtags. "Consecutive" is
// AST-based with mfm as the source of truth: runs are scanned over the
// parsed top-level node list, and whitespace-only `text` nodes (including
// newlines) plus emoji (`unicodeEmoji`, `emojiCode`) may sit between tags
// without breaking the run — `#a 😂 #b :custom: #c` is ONE block of three.
// Any other node type (mention, url, link, prose `text`, code, quote, …)
// ends the run. A lone hashtag is NOT a block: it stays inline (rendered
// as a chip by `MfmRenderer`) and is excluded from the bubble/popup.
//
// The bubble/popup cover the PRUNED block tags only (`blockedTags`):
// tags that stay inline in the post never enter the bubble. `allTags`
// (every hashtag, deduped) is still returned so callers can assert
// no-double-cover (a blocked tag is in `allTags` but not in the prose).

import { parse, toString, type MfmNode } from "mfm-js";

export interface TagBlockParse {
  /** Display text with every block's raw range removed (view
   * transformation only — persisted text is never mutated). Edges are
   * trimmed when at least one range was removed; identity otherwise. */
  prunedText: string;
  /** One entry per block, in post order: the tag strings as parsed. */
  blocks: string[][];
  /** Tags that were pruned into blocks, deduped preserving first-seen
   * order. This is the bubble/popup set. */
  blockedTags: string[];
  /** Every hashtag in the post (document order, nested included),
   * deduped preserving first-seen order (exact-string match). */
  allTags: string[];
}

function isSpacer(node: MfmNode): boolean {
  if (node.type === "unicodeEmoji" || node.type === "emojiCode") return true;
  return node.type === "text" && node.props.text.trim().length === 0;
}

function collectAllTags(nodes: MfmNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === "hashtag") {
      out.push(node.props.hashtag);
      continue;
    }
    const children = (node as { children?: MfmNode[] }).children;
    if (children) collectAllTags(children, out);
  }
}

function dedupe(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** Parse tag blocks out of note text. Never throws: unparseable text
 * returns the input untouched with empty sets. A block whose serialized
 * pieces cannot be located in the raw text is skipped (text kept). */
export function parseTagBlocks(text: string | null): TagBlockParse {
  const empty: TagBlockParse = {
    prunedText: text ?? "",
    blocks: [],
    blockedTags: [],
    allTags: [],
  };
  if (!text) return empty;
  let nodes: MfmNode[];
  try {
    nodes = parse(text);
  } catch {
    return empty;
  }

  const found: string[] = [];
  collectAllTags(nodes, found);
  const allTags = dedupe(found);

  // Top-level runs of hashtags joined by spacers.
  interface RunNode {
    node: MfmNode;
    tag: string | null;
  }
  const runs: RunNode[][] = [];
  let current: RunNode[] = [];
  const flush = () => {
    if (current.length > 0) runs.push(current);
    current = [];
  };
  for (const node of nodes) {
    if (node.type === "hashtag") {
      current.push({ node, tag: node.props.hashtag });
    } else if (isSpacer(node)) {
      // A spacer only continues a run that already has a tag; leading
      // spacers belong to no run.
      if (current.length > 0) current.push({ node, tag: null });
    } else {
      flush();
    }
  }
  flush();
  const blocks = runs
    .filter((run) => run.filter((r) => r.tag !== null).length >= 2)
    .map((run) => run.map((r) => r.tag).filter((t): t is string => t !== null));

  if (blocks.length === 0) return { prunedText: text, blocks, blockedTags: [], allTags };

  // Map each block back to raw-text ranges by sequential indexOf from the
  // previous match end (tags are short; deterministic enough), expanded
  // over the inter-tag spacers. Block range = start of its first tag
  // match through the end of its last tag match.
  const runNodes = runs.filter(
    (run) => run.filter((r) => r.tag !== null).length >= 2,
  );
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const run of runNodes) {
    const pieces: string[] = run.map((r) =>
      r.tag !== null ? `#${r.tag}` : toString(r.node),
    );
    let pos = cursor;
    let firstStart = -1;
    let lastEnd = -1;
    let ok = true;
    for (const piece of pieces) {
      const at = text.indexOf(piece, pos);
      if (at < 0) {
        ok = false;
        break;
      }
      if (firstStart < 0) firstStart = at;
      pos = at + piece.length;
      lastEnd = pos;
    }
    if (!ok || firstStart < 0 || lastEnd < 0) continue;
    // Only the tag span is pruned; spacers between tags fall inside the
    // range implicitly. Advance the cursor past the whole run so later
    // blocks map after earlier ones.
    ranges.push({ start: firstStart, end: lastEnd });
    cursor = pos;
  }

  if (ranges.length === 0) return { prunedText: text, blocks, blockedTags: [], allTags };

  let pruned = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    pruned = pruned.slice(0, r.start) + pruned.slice(r.end);
  }
  pruned = pruned.trim();

  const blockedTags = dedupe(blocks.flat());
  return { prunedText: pruned, blocks, blockedTags, allTags };
}
