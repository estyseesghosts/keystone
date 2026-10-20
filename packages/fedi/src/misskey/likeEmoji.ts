// Server-persisted like emoji (§8). The device-local store
// (`state/emojiPrefs.tsx`, `keystone_like_emoji`) stays the source of truth;
// this best-effort sync pushes the value per-account once the backend offers
// a field (`i/update { defaultReaction }`). 404/400 means no server field —
// the caller keeps its device-local value and (optionally) notes it in the UI.

import type { WireCall } from "./client";
import type { MeDetailed } from "./wire";

/** True when the server stored the value; false when it has no field. */
export async function tryPersistLikeEmoji(call: WireCall, emoji: string): Promise<boolean> {
  try {
    await call<MeDetailed>("i/update", { defaultReaction: emoji });
    return true;
  } catch {
    return false;
  }
}
