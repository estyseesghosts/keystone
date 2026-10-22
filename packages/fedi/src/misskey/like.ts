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
// probed once per origin (the first press), then cached — a stock Misskey
// pays one 404 per launch, never one per press. There is deliberately NO
// static seed: a flavor label cannot prove absence (stock Misskey may be
// backported), so only a real 404/UNKNOWN_API_ENDPOINT ever caches false.

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
 * Fire `notes/like` for one note. `override: null` takes the server's
 * `defaultLike`. Throws `LikeUnsupportedError` (and caches the absence)
 * where the endpoint does not exist; anything else rethrows untouched.
 * A cached `true` still calls the endpoint (the toggle is the operation);
 * a cached `false` refuses without wire traffic.
 */
export async function likeViaNotesLike(
  call: WireCall,
  origin: string | null,
  noteId: string,
  override: string | null,
): Promise<void> {
  // Known-absent (a real probe answered 404/UNKNOWN_API_ENDPOINT): refuse
  // without touching the wire — the caller falls back to a plain ❤
  // reaction. Same error as a failed probe, minus the doomed request.
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
