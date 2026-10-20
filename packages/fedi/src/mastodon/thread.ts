// Thread reconstruction from the Mastodon-family STATUS CONTEXT
// (phase3-handoff §2.4; keystodon.md §7 "flat ancestor/descendant
// lists → rebuild the tree via in_reply_to_id"). Pure — unit-tested in
// scripts/smoke-phase3.ts with scrambled/missing/cyclic fixtures.
//
// Server shape (contract §4): `GET /api/v1/statuses/:id/context`
// returns `{ancestors[], descendants[]}` as FLAT arrays. The caps
// (Mastodon: 40 ancestors / 60 descendants / depth 20 unauth vs 4096
// auth) mean the client must tolerate an INCOMPLETE thread: a missing
// parent is normal, never an error.

import type { Post } from "../core/models";

/** Render-depth guard (Keystone replies.md parity: cycle + depth-32).
 * The TREE build itself is single-pass and cannot loop; this caps the
 * recursive RENDER of pathological deep chains. */
export const MAX_THREAD_DEPTH = 32;

export interface ReplyNode {
  status: Post;
  children: ReplyNode[];
}

export interface ThreadStructure {
  /** Ancestors oldest-first, ending at the root's direct parent.
   * Partial when the server hid/truncated part of the chain — render
   * what arrived and stay honest about the gap. */
  chain: Post[];
  /** Direct replies to the root and everything under them. Orphaned
   * descendants (parent filtered/hidden/deleted) surface at the top
   * level rather than disappearing. */
  replies: ReplyNode[];
}

/** Every status in `nodes` and below, pre-order (parent before its
 * children). Iterative, so a deep branch cannot overflow the stack. */
export function flattenReplies(nodes: readonly ReplyNode[]): Post[] {
  const out: Post[] = [];
  const stack: ReplyNode[] = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node.status);
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]);
  }
  return out;
}

/**
 * Rebuild the thread around `root` from the flat context arrays.
 *
 * - Ancestor chain: start at the root's direct parent
 *   (`root.replyToId`) and walk UP through the ancestor map; a missing
 *   link or a cycle stops the walk (visited guard) — the chain is the
 *   honest partial reconstruction.
 * - Descendants: attach each status under its `in_replyToId` when that
 *   parent is the root or another descendant; anything else is an
 *   orphan top-level reply. Single pass — a self/mutual-reference
 *   cycle can only produce orphans, never a loop.
 */
export function rebuildThread(
  root: Post,
  ancestors: readonly Post[],
  descendants: readonly Post[],
): ThreadStructure {
  // --- Ancestor chain (walk up from the direct parent) -----------------
  const ancestorById = new Map<string, Post>();
  for (const a of ancestors) ancestorById.set(a.id, a);
  const chain: Post[] = [];
  if (root.replyToId !== null) {
    const visited = new Set<string>([root.id]);
    let cursor = ancestorById.get(root.replyToId);
    while (cursor !== undefined && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      chain.push(cursor);
      cursor =
        cursor.replyToId !== null ? ancestorById.get(cursor.replyToId) : undefined;
    }
    chain.reverse(); // oldest-first
  }

  // --- Descendants (two passes: collect, then attach) -------------------
  // Pass 1: one node per unique id (first wins; the root never nests
  // under itself). The list order is the server's, not the tree's.
  const nodeById = new Map<string, ReplyNode>();
  const order: ReplyNode[] = [];
  for (const d of descendants) {
    if (d.id === root.id || nodeById.has(d.id)) continue;
    const node: ReplyNode = { status: d, children: [] };
    nodeById.set(d.id, node);
    order.push(node);
  }

  // Pass 2: a node nests under its parent ONLY when the parent chain
  // terminates at the root. A chain that loops (a↔b, or a self-reply)
  // or reaches a missing parent is not a tree, so each such post becomes
  // a flat top-level entry — kept, never looped, never nested under a
  // cycle. A child of a cyclic node is cyclic too, so nothing is hidden.
  const cyclic = new Map<string, boolean>();
  const isCyclic = (start: ReplyNode): boolean => {
    const path: string[] = [];
    const seen = new Set<string>();
    let cur: ReplyNode | undefined = start;
    let result = false;
    while (cur !== undefined) {
      const known = cyclic.get(cur.status.id);
      if (known !== undefined) {
        result = known;
        break;
      }
      if (seen.has(cur.status.id)) {
        result = true;
        break;
      }
      seen.add(cur.status.id);
      path.push(cur.status.id);
      const pid = cur.status.replyToId;
      if (pid === null || pid === root.id) break; // chain ends cleanly
      cur = nodeById.get(pid); // undefined: missing parent, chain ends
    }
    for (const id of path) cyclic.set(id, result);
    return result;
  };

  const roots: ReplyNode[] = [];
  for (const node of order) {
    const pid = node.status.replyToId;
    const parent = pid === null || pid === root.id ? undefined : nodeById.get(pid);
    if (isCyclic(node) || parent === undefined || parent === node) {
      // Cycle, missing parent, or a reply to the root / to nothing.
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  return { chain, replies: roots };
}
