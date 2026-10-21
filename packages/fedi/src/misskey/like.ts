// Sharkey-family like shortcut (`POST notes/like`) with graceful
// degradation on servers without the endpoint (stock Misskey).
//
// Contract (Sharkey; Pinetree matches): body `{noteId, override}` where
// `override ?? <server defaultLike>` is the effective emoji. The server
// creates the reaction, or deletes it when already reacted — one press
// toggles, so the client never sends a separate delete. Rate-limited
// (2/sec); per-note serialization lives in the caller's toggle queue.
// Errors: `NO_SUCH_NOTE`, `YOU_HAVE_BEEN_BLOCKED`,
// `CANNOT_REACT_TO_RENOTE`, and `UNKNOWN_API_ENDPOINT` where the endpoint
// is absent (stock Misskey answers the unknown path with 404).
//
// The client never fabricates like state: after success the caller
// re-reads the note and syncs to what the server reports. Support is
// cached per origin so vanilla servers pay one 404 per launch, never one
// per press.

import { ApiError, FediError } from "../core/errors";
import { isUnsupportedError, type WireCall } from "./client";

export class LikeUnsupportedError extends FediError {
  constructor() {
    super("This server does not support likes yet.", "errors.reactions.likeUnsupported");
  }
}

const supportCache = new Map<string, boolean>();

/** Endpoint presence by origin: true/false, or null when unprobed. */
export function likeSupportFor(origin: string): boolean | null {
  return supportCache.has(origin) ? (supportCache.get(origin) as boolean) : null;
}

/** Test hook: drop the per-origin support cache. */
export function resetLikeSupportCache(): void {
  supportCache.clear();
}

/**
 * Seed the per-origin support cache from a static fact (flavor table).
 * A `false` seed means the capability table already proves the endpoint
 * absent (stock Misskey): callers reading `likeSupportFor` skip the
 * probe-by-fire entirely and fall back to a plain ❤ reaction, so a stock
 * server never pays one doomed 404 per launch. A `true` seed is never
 * written here — presence is only ever confirmed by a successful call
 * (see `likeViaNotesLike`), never assumed from a flavor label.
 */
export function seedLikeSupport(origin: string, supported: false): void {
  if (origin) supportCache.set(origin, supported);
}

/**
 * Fire `notes/like` for one note. `override: null` takes the server's
 * `defaultLike`. Throws `LikeUnsupportedError` (and caches the absence)
 * where the endpoint does not exist; anything else rethrows untouched.
 */
export async function likeViaNotesLike(
  call: WireCall,
  origin: string | null,
  noteId: string,
  override: string | null,
): Promise<void> {
  // Known-absent (probed 404, or seeded from the flavor table for stock
  // Misskey): refuse without touching the wire — the caller falls back
  // to a plain ❤ reaction. Same error as a failed probe, minus the 404.
  if (origin && likeSupportFor(origin) === false) throw new LikeUnsupportedError();
  try {
    await call<unknown>("notes/like", { noteId, override });
  } catch (err) {
    if (
      err instanceof ApiError &&
      (isUnsupportedError(err) || err.code === "UNKNOWN_API_ENDPOINT")
    ) {
      if (origin) supportCache.set(origin, false);
      throw new LikeUnsupportedError();
    }
    throw err;
  }
  if (origin) supportCache.set(origin, true);
}
