// Timeline fold (pure; no DOM, no Solid).
//
// Never show more than ~750 chars of full post text in a feed; the reader
// opens the note for the rest.
//
// Budget (owner rule): links and mentions do NOT count toward the limit;
// hashtags DO count. The mfm nodes of the (already pruned) text are
// walked top-down: `mention`/`url`/`link` nodes contribute 0, everything
// else contributes its serialized length (`toString(node)`). Nested
// structures (a mention inside bold, …) count at the top level that owns
// them — the walk does not descend. Emoji count as visible characters
// with JS `.length` semantics (no code-point counting).
//
// Cut rules: nodes are kept in order until the budget is spent. Only
// `text`/`plain` nodes may be sliced, at the last whitespace before the
// budget (word boundary; the boundary whitespace itself is dropped).
// Anything else that would overflow — hashtag, emoji, code, quote, … —
// ends the text before it instead (a sliced `#ta` would link wrong). A
// zero-count node after the cut is dropped; one before it is kept.
// Unparseable text falls back to a raw word-boundary slice.

import { parse, toString, type MfmNode } from "mfm-js";

/** Max counted characters of post text shown in a feed. */
export const FOLD_BUDGET = 750;

export interface FoldResult {
  text: string;
  truncated: boolean;
}

function isZeroCount(node: MfmNode): boolean {
  return node.type === "mention" || node.type === "url" || node.type === "link";
}

function isSlicable(node: MfmNode): boolean {
  return node.type === "text" || node.type === "plain";
}

/** Last whitespace index at or before `room` (room is a length budget
 * into `s`), or -1 when there is no word boundary to cut at. */
export function lastWhitespaceAtOrBefore(s: string, room: number): number {
  const end = Math.min(room, s.length);
  for (let i = end; i >= 0; i--) {
    if (/\s/.test(s[i] ?? "")) return i;
  }
  return -1;
}

/** Fold text to the budget. Returns the folded text plus whether anything
 * was dropped (callers append `…` and an "Open post" link on true). */
export function foldMfm(text: string | null, budget: number = FOLD_BUDGET): FoldResult {
  if (text == null || text.length === 0) return { text: text ?? "", truncated: false };
  let nodes: MfmNode[];
  try {
    nodes = parse(text);
  } catch {
    if (text.length <= budget) return { text, truncated: false };
    const at = lastWhitespaceAtOrBefore(text, budget);
    return at > 0
      ? { text: text.slice(0, at), truncated: true }
      : { text: "", truncated: true };
  }
  let used = 0;
  let cut = false;
  const kept: string[] = [];
  for (const node of nodes) {
    if (cut) break;
    if (isZeroCount(node)) {
      kept.push(toString(node));
      continue;
    }
    const s = toString(node);
    if (used + s.length <= budget) {
      kept.push(s);
      used += s.length;
      continue;
    }
    if (isSlicable(node)) {
      const at = lastWhitespaceAtOrBefore(s, budget - used);
      if (at > 0) {
        kept.push(s.slice(0, at));
        used += at;
      }
    }
    cut = true;
  }
  return { text: kept.join(""), truncated: cut };
}
