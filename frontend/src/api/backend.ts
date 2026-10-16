// Backend target selection for Keystone.
//
// The same frontend runs against three possible API targets:
// - "pinetree" (default): the Pinetree backend, POST /api/signin login.
// - "misskey" / "sharkey": the Misskey-family backends, native
//   POST /api/signin-flow login + scoped MiAuth app token.
//
// The target is chosen at Vite dev/build time via `VITE_KEYSTONE_BACKEND`
// (see frontend/.env.misskey, frontend/.env.sharkey). Tokens are stored
// under per-backend localStorage keys so a Misskey token is never sent to
// Sharkey and vice versa (session isolation).

export type BackendId = "pinetree" | "misskey" | "sharkey";

function detectBackend(): BackendId {
  const raw = (import.meta.env.VITE_KEYSTONE_BACKEND as string | undefined)
    ?.trim()
    .toLowerCase();
  if (raw === "misskey" || raw === "sharkey" || raw === "pinetree") return raw;
  return "pinetree";
}

export const BACKEND_ID: BackendId = detectBackend();

/** True for Misskey and Sharkey: native sign-in + scoped app tokens. */
export const IS_MISSKEY_FAMILY: boolean =
  BACKEND_ID === "misskey" || BACKEND_ID === "sharkey";

/** Instance URL used for display only (proxy handles the traffic). */
export const BACKEND_URL: string =
  (import.meta.env.VITE_KEYSTONE_API_URL as string | undefined) ??
  "http://127.0.0.1:3000";

export const BACKEND_LABEL: string =
  BACKEND_ID === "misskey"
    ? "Misskey"
    : BACKEND_ID === "sharkey"
      ? "Sharkey"
      : "Pinetree";

/** Per-backend session isolation: each target gets its own token key. */
export function tokenKeyFor(id: BackendId = BACKEND_ID): string {
  return `keystone_token_${id}`;
}

/** Minimal MiAuth permission set covering the implemented Keystone slice.
 * Verified against both backends' endpoint `kind` requirements:
 * read:account (i, timelines, antennas list/feed), write:notes
 * (create/delete/unrenote), write:reactions, write:following (+
 * read:following for incoming follow requests), read:notifications (+
 * write:notifications for mark-all-read), read:drive + write:drive (Drive
 * list/upload), write:account (antennas create/update/delete, profile edit,
 * word/instance mutes via `i/update`), write:votes (poll voting),
 * read:blocks + write:blocks (blocking/create/delete/list),
 * read:mutes + write:mutes (mute + renote-mute create/delete/list).
 *
 * Tokens minted before a scope was added lack it: the server answers 403
 * PERMISSION_DENIED and the UI tells the user to sign in again. */
export const KEYSTONE_PERMISSIONS: string[] = [
  "read:account",
  "write:notes",
  "write:reactions",
  "write:following",
  "read:following",
  "read:notifications",
  "write:notifications",
  "read:drive",
  "write:drive",
  "write:account",
  "write:votes",
  "read:blocks",
  "write:blocks",
  "read:mutes",
  "write:mutes",
];

export const KEYSTONE_APP_NAME = "Keystone";
