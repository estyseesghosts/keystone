// Confirmed-reaction overlay (§3 write path): the viewer's reaction as of
// the last SUCCESSFUL local write, per backend. Every success path ends
// in a full server replace (`notes/show`), and backends whose `show`
// doesn't pack `myReaction` yet would snap the button straight back —
// the write succeeded but the UI reverts. Readers use
// `effectiveMyReaction` (overlay wins when present); writers
// `confirmMyReaction` on success and `clearMyReaction` on failure (which
// falls back to server truth + the error path). On backends that pack
// correctly the overlay always equals the server value (invisible).
// Session-only and namespaced per backend (never leaks across accounts).

import { BACKEND_ID } from "./backend";
import type { Note } from "./types";

const overlays = new Map<string, string | null>();

const keyFor = (noteId: string): string => `${BACKEND_ID}:${noteId}`;

/** The reaction the UI acts on: the last confirmed local write when one
 * exists, else the server-packed value. Pure read. */
export function effectiveMyReaction(note: Pick<Note, "id" | "myReaction">): string | null {
  const key = keyFor(note.id);
  return overlays.has(key) ? overlays.get(key)! : note.myReaction;
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
