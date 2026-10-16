// Reply-thread helpers for the note detail view (`docs/replies.md`).
// Pure collection logic lives here so it stays unit-checkable; data
// fetching stays in the components. `Note.replyId` is the relationship
// source of truth — no client thread ids, paths, or nested children.

import type { Note } from "./types";
import { appearNoteOf } from "./types";

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

/** The parent id a feed card replies to, if any. Always derived from the
 * displayed/original note: the server lists no replies for a pure-repost
 * wrapper id, and actions never target one — so the wrapper's own (always
 * null) `replyId` must never drive reply UI. Pure. */
export function replyParentId(note: Note): string | null {
  return appearNoteOf(note).replyId;
}

/** The packed parent object when the server included one (`notes/show`
 * and timeline pages pack a one-level `reply`; it may be null even when
 * `replyId` is set — deleted, private, or simply unpacked). Displayed-note
 * aware, like `replyParentId`. Pure. */
export function replyParentNote(note: Note): Note | null {
  return appearNoteOf(note).reply;
}

/** True when `child` directly replies to `parent` in feed order. Compares
 * the child's displayed `replyId` against the parent's displayed id, so a
 * pure-repost wrapper on either side still matches its original. A note
 * never replies to itself, even on malformed data. Pure. */
export function isDirectReplyTo(child: Note, parent: Note): boolean {
  const target = appearNoteOf(parent).id;
  if (child.id === parent.id) return false;
  if (appearNoteOf(child).id === target) return false;
  return replyParentId(child) === target;
}

export interface FeedThreadLinks {
  /** Per-index flags in feed (newest-first) order: `connectedBelow[i]` is
   * true when `visible[i]` directly replies to `visible[i + 1]`;
   * `connectedAbove[i]` mirrors the previous row's below-flag. A run of
   * set flags is one visual thread (avatar-column connector + no divider
   * inside the run). Pure. */
  connectedAbove: boolean[];
  connectedBelow: boolean[];
}

/** Compute avatar-column links for a visible feed window (newest-first).
 * Only *adjacent* parent/child pairs link: a reply whose parent is not
 * the next row still gets its "Replying to" line, but no connector.
 * Operates on the rendered order (post-collapse), never the raw paging
 * array. Pure. */
export function computeFeedThreadLinks(visible: Note[]): FeedThreadLinks {
  const connectedBelow: boolean[] = visible.map((_, i) =>
    i + 1 < visible.length ? isDirectReplyTo(visible[i], visible[i + 1]) : false,
  );
  const connectedAbove: boolean[] = visible.map((_, i) =>
    i > 0 ? connectedBelow[i - 1] : false,
  );
  return { connectedAbove, connectedBelow };
}
