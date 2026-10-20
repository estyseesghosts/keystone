// Home-server target selection (ported from old Keystone `api/backend.ts`).
//
// The old module read Vite build env (`VITE_KEYSTONE_BACKEND` → BACKEND_ID,
// `VITE_KEYSTONE_API_URL` → BACKEND_URL/DEV_HOME_SERVER) and the global
// hosting singleton. Pure-TS rule: none of that exists here — the app
// passes its home explicitly as a `HomeSpec` (origin + detected family /
// flavor), and the router below resolves everything else from the session
// store. The dev-only backend override is gone: first boot detects the
// home server instead.
//
// What moved where:
// - `KEYSTONE_APP_NAME` / `KEYSTONE_PERMISSIONS` live in
//   `misskey/auth.ts` (already ported); the facade wires them through.
// - `BACKEND_HINT` / `BACKEND_ID` / `IS_MISSKEY_FAMILY` / `BACKEND_URL` /
//   `DEV_HOME_SERVER` / `backendId()` have no equivalent: the build bakes
//   in no backend, and per-backend token keys (`tokenKeyFor`, kept) are
//   legacy-migration input only (`core/sessions.ts` migration reads them).

import type { ServerFamily, ServerFlavor } from "../core/detect";

/** First-party home targets (Misskey-family native login flavors). */
export type BackendId = "pinetree" | "misskey" | "sharkey";

/** The app's home server, resolved at runtime (detection + hosting). */
export interface HomeSpec {
  /** Canonical origin of the home server (same-origin proxy target). */
  origin: string;
  family: ServerFamily;
  flavor: ServerFlavor;
  /** Display name when the hosting config carries one. */
  name?: string;
}

/** Legacy per-backend token key (`keystone_token_<backend>`). Migration
 * input only — nothing live reads these after the auth flip. */
export function tokenKeyFor(id: BackendId = "pinetree"): string {
  return `keystone_token_${id}`;
}

/** True for native-Misskey-family homes (signin-flow + MiAuth +
 * streaming). Pinetree is Misskey-wire but not this (its own `signin`,
 * no streaming). */
export function isMisskeyFamilyHome(home: HomeSpec): boolean {
  return (
    home.flavor === "misskey" || home.flavor === "sharkey" || home.flavor === "catodon"
  );
}

/** True when the home server is Pinetree. */
export function isPinetreeHome(home: HomeSpec): boolean {
  return home.flavor === "pinetree";
}

/** True when the home server is Mastodon-family. */
export function isMastodonHome(home: HomeSpec): boolean {
  return home.family === "mastodon";
}

const FLAVOR_LABELS: Record<string, string> = {
  misskey: "Misskey",
  sharkey: "Sharkey",
  catodon: "Catodon",
  pinetree: "Pinetree",
  mastodon: "Mastodon",
  akkoma: "Akkoma",
  pleroma: "Pleroma",
};

/** Display name of the home server: configured `name`, else its flavor. */
export function homeLabel(home: HomeSpec): string {
  if (home.name) return home.name;
  return FLAVOR_LABELS[home.flavor] ?? "Keystone";
}
