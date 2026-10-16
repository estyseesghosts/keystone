// Reply-thread helpers for the note detail view (`docs/replies.md`).
// Pure collection logic lives here so it stays unit-checkable; data
// fetching stays in the components. `Note.replyId` is the relationship
// source of truth — no client thread ids, paths, or nested children.

import type { Note } from "./types";

/** Direct-reply page size for `notes/replies` (cross-backend cursor rule:
 * only `{limit, sinceId, untilId}` plus the parent `noteId`). */
export const REPLIES_PAGE_SIZE = 20;

/** Ancestor page size for `notes/conversation`. */
export const CONVERSATION_PAGE_SIZE = 30;

/** Upper bound on ancestor paging (matches Pinetree's ancestor-walk
 * guard): paging stops here even if a page comes back full, so a server
 * that ignores `offset` can never trap the client in an endless loop. */
export const MAX_ANCESTOR_WALK = 512;

/** Defensive render-depth cap for nested reply branches. Real threads
 * never reach it; hitting it renders an explicit state instead of
 * recursing indefinitely. */
export const THREAD_MAX_DEPTH = 32;

/** Merge one `notes/replies` page into the loaded list, deduplicated by
 * note id. Order is preserved: loaded items first (server order,
 * newest-first), then the page's fresh items. Loaded object identities
 * are kept, so keyed `<For>` rows update in place. Pure. */
export function mergeNotes(
  current: Note[],
  page: Note[],
): { merged: Note[]; freshCount: number } {
  const seen = new Set(current.map((n) => n.id));
  const fresh: Note[] = [];
  for (const n of page) {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      fresh.push(n);
    }
  }
  return { merged: [...current, ...fresh], freshCount: fresh.length };
}

export interface OrderedAncestors {
  /** Visible ancestors oldest-first (may be empty for a root note). */
  ancestors: Note[];
  /** True when the chain stops before reaching a root: a parent is
   * deleted, private, unknown, or omitted by the server. The caller
   * shows a neutral marker — never a missing id or URI. */
  incomplete: boolean;
}

/** Order the visible ancestors of the displayed note oldest-first by
 * walking its `replyId` chain through the collected `notes/conversation`
 * notes. Only chain-reachable notes render: anything else the server
 * packs (siblings, quotes) is ignored, so an embedded quote can never
 * appear as a child. Cycle-safe and bounded — malformed data stops the
 * walk instead of looping. Pure. */
export function orderAncestors(
  displayedReplyId: string | null,
  collected: Note[],
): OrderedAncestors {
  const byId = new Map<string, Note>();
  for (const n of collected) {
    if (!byId.has(n.id)) byId.set(n.id, n);
  }
  const chain: Note[] = [];
  const seen = new Set<string>();
  let cursor = displayedReplyId;
  let incomplete = false;
  let guard = 0;
  while (cursor && guard < MAX_ANCESTOR_WALK) {
    guard++;
    if (seen.has(cursor)) break;
    const node = byId.get(cursor);
    if (!node) {
      incomplete = true;
      break;
    }
    seen.add(cursor);
    chain.push(node);
    cursor = node.replyId;
  }
  chain.reverse();
  return { ancestors: chain, incomplete };
}
