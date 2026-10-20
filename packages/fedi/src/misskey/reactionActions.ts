// Shared Misskey-family reaction write path. Both TimelineFeed and Note
// route through here so the optimistic/coalescing logic lives in one place.
// Misskey family only.
//
// REFERENCE ONLY (plan §3): replaced by post-shadow + toggle queue in
// Phase 4. Kept so its test cases stay green; do not build on this. The
// old global `activeBackend` lookup became an explicit provider seam
// (`setReactionBackendProvider`); the locale params are gone (pure-TS
// rule: error codes, English fallback messages).

import type { Post } from "../core/models";
import { withMyReaction, withReaction } from "../core/models";
import {
  beginMyReaction,
  clearMyReaction,
  confirmMyReaction,
  effectiveMyReaction,
} from "./myReactions";

export interface ReactionHost {
  token: string | null;
  getNote(id: string): Post | undefined;
  applyNote(id: string, updater: (n: Post) => Post): void;
  refreshNote(id: string): Promise<void>;
  setError(msg: string): void;
}

export interface ReactionBackend {
  react(id: string, reaction: string): Promise<void>;
  unreact(id: string): Promise<void>;
}

let backendProvider: () => ReactionBackend = () => {
  throw new Error("No reaction backend: reference-only path (Phase 4 replaces this).");
};

/** Inject the write backend (tests and the Phase-4 queue set this). */
export function setReactionBackendProvider(fn: () => ReactionBackend): void {
  backendProvider = fn;
}

// Per-note coalescing state.
const desired = new Map<string, string | null>();
const inFlight = new Map<string, boolean>();
const pending = new Map<string, boolean>();

export async function runReaction(
  host: ReactionHost,
  noteId: string,
  from: string | null,
  to: string | null,
): Promise<void> {
  const backend = backendProvider();
  inFlight.set(noteId, true);
  try {
    if (from) await backend.unreact(noteId);
    if (to) await backend.react(noteId, to);
    confirmMyReaction(noteId, to);
    await host.refreshNote(noteId);
  } catch (err) {
    clearMyReaction(noteId);
    host.setError(err instanceof Error ? err.message : "Reaction failed.");
    await host.refreshNote(noteId);
    pending.set(noteId, false);
  } finally {
    inFlight.set(noteId, false);
  }
}

export async function requestReaction(
  host: ReactionHost,
  note: Post,
  reaction: string | null,
): Promise<void> {
  if (!host.token) return;
  const noteId = note.id;
  const current = effectiveMyReaction(note);
  if (!current && !reaction) return;
  if (current === reaction) return;

  desired.set(noteId, reaction);

  // Synchronous optimistic commit: overlay + count move together.
  beginMyReaction(noteId, reaction);
  host.applyNote(noteId, (n) =>
    withReaction(withMyReaction(n, current), reaction),
  );

  if (inFlight.get(noteId)) {
    pending.set(noteId, true);
    return;
  }

  let from: string | null = current;
  while (true) {
    const to = desired.get(noteId) ?? null;
    await runReaction(host, noteId, from, to);
    // settle coalescing
    if (!pending.get(noteId)) break;
    pending.set(noteId, false);
    const confirmed = effectiveMyReaction(
      host.getNote(noteId) ?? note,
    );
    const nextDesired = desired.get(noteId) ?? null;
    if (confirmed === nextDesired) break;
    // apply optimistic delta for the follow-up
    const snap = host.getNote(noteId);
    if (snap) {
      beginMyReaction(noteId, nextDesired);
      host.applyNote(noteId, (n) =>
        withReaction(withMyReaction(n, confirmed), nextDesired),
      );
    }
    from = confirmed;
  }
}
