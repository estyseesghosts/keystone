// Confirmed-reaction overlay (§3 write path): the viewer's reaction as of
// the last SUCCESSFUL local write, per backend. Every success path ends
// in a full server replace (`notes/show`), and backends whose `show`
// doesn't pack `myReaction` yet would snap the button straight back —
// the write succeeded but the UI reverts. Readers use
// `effectiveMyReaction` (overlay wins when present); writers
// `confirmMyReaction` on success and `clearMyReaction` on failure (which
// falls back to server truth + the error path). On backends that pack
// correctly the overlay always equals the server value (invisible).
//
// REFERENCE ONLY (plan §3): replaced by post-shadow + toggle queue in
// Phase 4. Kept so its test cases stay green; do not build on this.
// Session scoping is an explicit seam now (`setMyReactionScope`) instead
// of the old global active-session lookup.
import type { ReactionSummary } from "../core/models";

const overlays = new Map<string, string | null>();

let scope = "default";

/** Scope overlay keys to a session id (the auth layer sets this on
 * account switch). Overlays never leak across accounts. */
export function setMyReactionScope(id: string): void {
  scope = id;
}

const keyFor = (noteId: string): string => `${scope}:${noteId}`;

/** The reaction the UI acts on: the last confirmed local write when one
 * exists, else the server-packed value. Pure read. */
export function effectiveMyReaction(post: {
  id: string;
  reactions: ReactionSummary | null;
}): string | null {
  const key = keyFor(post.id);
  return overlays.has(key) ? overlays.get(key)! : post.reactions?.mine ?? null;
}

/** Remember a successful write's end state. Bounded (oldest go first). */
export function confirmMyReaction(noteId: string, reaction: string | null): void {
  overlays.set(keyFor(noteId), reaction);
  if (overlays.size > 500) {
    const first = overlays.keys().next();
    if (!first.done) overlays.delete(first.value);
  }
}

/** Forget the overlay (failed write, explicit reset): server truth shows. */
export function clearMyReaction(noteId: string): void {
  overlays.delete(keyFor(noteId));
}

/** Synchronous optimistic overlay: set the viewer's reaction immediately,
 * before any await, so the icon follows the count in the same frame. */
export function beginMyReaction(noteId: string, reaction: string | null): void {
  overlays.set(keyFor(noteId), reaction);
  if (overlays.size > 500) {
    const first = overlays.keys().next();
    if (!first.done) overlays.delete(first.value);
  }
}
