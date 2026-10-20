// Session-bound API routing facade (ported from old Keystone `api/client.ts`).
//
// The old facade routed via active-session globals (`misskey/external.ts`),
// ambient `location.origin`, the Vite backend id, and localized messages.
// Pure-TS rule: this module takes the store (`KeyValueStore`, the same seam
// `core/sessions.ts` runs on) and the app's `HomeSpec` explicitly, and its
// messages are fixed English fallbacks (`FediError` codes ride along for
// the UI's catalog).
//
// Routing contract (unchanged):
// - `apiCall` routes to the active session when one is set, otherwise to
//   the internal (home-origin, first-party) path. A token only ever reaches
//   its own origin: every transport is built FROM a session.
// - `apiCallInternal` always targets the home origin (restore, sign-in/out,
//   refresh), even while another account is active.
// - `apiCallPublic` never injects a credential (login, token checks).
// - Family routing: the ACTIVE session's family picks the `Backend` —
//   Mastodon-family sessions get the Mastodon backend (OAuth + Bearer),
//   everything else the Misskey backend. Switching accounts switches the
//   backend.
// - The Mastodon transport resolves its session per call and fails closed:
//   a backend captured before an account switch throws instead of firing
//   with a missing/wrong session.
//
// What is NOT here (already ported elsewhere, reused — never forked):
// - `signin-flow` / `miauth/gen-token` / `check` live in `misskey/auth.ts`
//   (`WireCall`-injected); the native wrappers below bind them to the
//   public wire call. `KEYSTONE_APP_NAME` / `KEYSTONE_PERMISSIONS` stay
//   there too.
// - `isUnsupportedError` / `isPermissionError` stay in `misskey/client.ts`
//   (they only need `ApiError` + status, which the Mastodon backend's
//   error guard preserves).

import { ApiError } from "../core/errors";
import { familyOf, type ServerFamily, type ServerFlavor } from "../core/detect";
import type { Backend } from "../core/backend";
import {
  getActiveSession,
  loadSessions,
  removeLegacyKeys,
  removeSession,
  rekeySession,
  saveSession,
  sessionId,
  UNKNOWN_ACCOUNT_ID,
  type KeyValueStore,
  type Session,
  type SessionGrant,
} from "../core/sessions";
import { createMisskeyBackend } from "../misskey/backend";
import { createMisskeyClient } from "../misskey/client";
import { mintAppToken, signinFlow, type SigninFlowResponse } from "../misskey/auth";
import { createMastodonBackend } from "../mastodon/backend";
import { createClient, type MastoClient } from "../mastodon/client";
import type { HomeSpec } from "./backend";

export type { HomeSpec };

// --- Internal (first-party, home-origin) token store ------------------------

/** The first-party session at the home origin, if one is stored. */
export function internalSessionOf(store: KeyValueStore, homeOrigin: string): Session | null {
  return (
    loadSessions(store, homeOrigin).find(
      (s) => s.hosting === "first-party" && s.origin === homeOrigin,
    ) ?? null
  );
}

/** Per-origin session isolation: a token stored for one origin is never
 * returned (and therefore never sent) for another. */
export function getToken(store: KeyValueStore, homeOrigin: string): string | null {
  return internalSessionOf(store, homeOrigin)?.token ?? null;
}

export function setStoredToken(
  store: KeyValueStore,
  homeOrigin: string,
  token: string,
  opts: { family?: ServerFamily; flavor?: ServerFlavor; grant?: SessionGrant } = {},
): void {
  // A new login is a new account: replace any previous internal session
  // and start on the unknown-account id until `i` names the account.
  for (const s of loadSessions(store, homeOrigin)) {
    if (s.hosting === "first-party" && s.origin === homeOrigin) {
      removeSession(store, s.id, homeOrigin);
    }
  }
  saveSession(
    store,
    {
      id: sessionId(homeOrigin, UNKNOWN_ACCOUNT_ID),
      origin: homeOrigin,
      family: opts.family ?? "misskey",
      flavor: opts.flavor ?? "unknown",
      accountId: UNKNOWN_ACCOUNT_ID,
      token,
      grant: opts.grant ?? "password",
      hosting: "first-party",
    },
    homeOrigin,
  );
}

export function clearStoredToken(store: KeyValueStore, homeOrigin: string): void {
  const existing = internalSessionOf(store, homeOrigin);
  if (existing) removeSession(store, existing.id, homeOrigin);
}

/** Record the signed-in account's real id on the internal session (the
 * `UNKNOWN_ACCOUNT_ID` placeholder exists only until the first `i`). */
export function adoptInternalAccount(
  store: KeyValueStore,
  homeOrigin: string,
  accountId: string,
): void {
  rekeySession(store, sessionId(homeOrigin, UNKNOWN_ACCOUNT_ID), accountId, homeOrigin);
}

/** Finish the auth migration: drop every legacy key. Called at boot after
 * the store migration. */
export function finalizeAuthMigration(store: KeyValueStore): void {
  removeLegacyKeys(store);
}

// --- Active session ----------------------------------------------------------

/** The ACTIVE session, or null when signed out (or the pointer is stale —
 * a stale pointer resolves to null, never to a half session). */
export function activeSessionOf(store: KeyValueStore, homeOrigin?: string): Session | null {
  return getActiveSession(store, homeOrigin);
}

/** The ACTIVE session's store key (the active account when one is set,
 * the home placeholder otherwise). Session-scoped client state (drafts,
 * reaction overlays) namespaces keys by this — by session, not by
 * backend. */
export function activeSessionId(
  store: KeyValueStore,
  home: HomeSpec,
): string {
  return activeSessionOf(store, home.origin)?.id ?? sessionId(home.origin, UNKNOWN_ACCOUNT_ID);
}

/** Signed-out stand-in: the home session shape with no credential. Public
 * calls use it for the origin; backends use it until sign-in. */
function placeholderSession(home: HomeSpec): Session {
  return {
    id: sessionId(home.origin, UNKNOWN_ACCOUNT_ID),
    origin: home.origin,
    family: home.family,
    flavor: home.flavor,
    accountId: UNKNOWN_ACCOUNT_ID,
    token: "",
    grant: "password",
    hosting: "first-party",
  };
}

/** Session for unauthenticated calls: active, else internal, else the
 * home placeholder (origin only — no credential is ever attached). */
function publicSessionOf(store: KeyValueStore, home: HomeSpec): Session {
  return (
    activeSessionOf(store, home.origin) ??
    internalSessionOf(store, home.origin) ??
    placeholderSession(home)
  );
}

/** The family of the ACTIVE session (else the internal session's, else
 * the home's). UI gates family-only services on this — never on wire. */
export function activeFamily(store: KeyValueStore, home: HomeSpec): ServerFamily {
  return (
    activeSessionOf(store, home.origin)?.family ??
    internalSessionOf(store, home.origin)?.family ??
    home.family
  );
}

/** The flavor of the ACTIVE session (else the internal session's, else
 * the home's). Unknown means undetected — callers must never unlock UI
 * on it. */
export function activeFlavor(store: KeyValueStore, home: HomeSpec): ServerFlavor {
  return (
    activeSessionOf(store, home.origin)?.flavor ??
    internalSessionOf(store, home.origin)?.flavor ??
    home.flavor
  );
}

// --- Family routing ------------------------------------------------------------

/** A `Backend` for exactly one session: the session's family picks the
 * implementation, its flavor tunes capabilities. The transport is built
 * FROM the session, so the token can only ever reach its own origin. */
export function backendForSession(session: Session): Backend {
  const family = session.family ?? familyOf(session.flavor) ?? "misskey";
  if (family === "mastodon") {
    return createMastodonBackend(createClient(session.origin, session.token || null), {
      flavor: session.flavor,
    });
  }
  return createMisskeyBackend(createMisskeyClient(session), session.flavor);
}

/**
 * A `MastoClient` bound to the ACTIVE Mastodon-family session, resolved
 * per call (exactly like `apiCall`): the token is only ever paired with
 * its own origin and never reaches the home backend. Signed out — or on
 * a non-Mastodon session — calls fail closed with a clear error rather
 * than hitting the wrong server.
 */
export function activeSessionMastoClient(store: KeyValueStore, home: HomeSpec): MastoClient {
  const resolve = (): { origin: string; token: string } => {
    const active = activeSessionOf(store, home.origin);
    if (!active || (active.family ?? familyOf(active.flavor) ?? "misskey") !== "mastodon") {
      throw new ApiError("No active Mastodon-family session.", 0, "NO_SESSION");
    }
    return { origin: active.origin, token: active.token };
  };
  const call = <T>(run: (client: MastoClient) => Promise<T>): Promise<T> => {
    const { origin, token } = resolve();
    return run(createClient(origin, token));
  };
  return {
    get origin() {
      return resolve().origin;
    },
    get token() {
      return resolve().token;
    },
    get: (path, query, opts) => call((c) => c.get(path, query, opts)),
    post: (path, json, opts) => call((c) => c.post(path, json, opts)),
    put: (path, json, opts) => call((c) => c.put(path, json, opts)),
    patch: (path, json, opts) => call((c) => c.patch(path, json, opts)),
    delete: (path, json, opts) => call((c) => c.delete(path, json, opts)),
    postForm: (path, form, opts) => call((c) => c.postForm(path, form, opts)),
    postFormData: (path, formData, opts) =>
      call((c) => c.postFormData(path, formData, opts)),
  };
}

/** The `Backend` for the ACTIVE session. Mastodon-family actives resolve
 * their session per call (fail-closed on switch); Misskey-family actives
 * bind the current session; signed-out resolves the home Misskey backend
 * over the placeholder session. */
export function activeBackend(store: KeyValueStore, home: HomeSpec): Backend {
  const active = activeSessionOf(store, home.origin);
  if (active && (active.family ?? familyOf(active.flavor) ?? "misskey") === "mastodon") {
    return createMastodonBackend(activeSessionMastoClient(store, home), {
      flavor: active.flavor,
    });
  }
  const session = active ?? internalSessionOf(store, home.origin) ?? placeholderSession(home);
  return createMisskeyBackend(createMisskeyClient(session), session.flavor);
}

// --- Misskey-family wire calls -------------------------------------------------

/** Authenticated Misskey-family call on the ACTIVE session (else the
 * internal path). A Mastodon-family active has no Misskey path: the call
 * throws before any I/O instead of hitting the wrong origin. */
export async function apiCall<T>(
  store: KeyValueStore,
  home: HomeSpec,
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const active = activeSessionOf(store, home.origin);
  if (active && (active.family ?? familyOf(active.flavor) ?? "misskey") !== "misskey") {
    throw new ApiError(
      "The active session is Mastodon-family; this call is Misskey-family.",
      404,
      "UNSUPPORTED_FAMILY",
    );
  }
  const session = active ?? internalSessionOf(store, home.origin) ?? placeholderSession(home);
  return createMisskeyClient(session).call<T>(endpoint, params);
}

/** POST without injecting any credential (login, token checks). */
export function apiCallPublic<T>(
  store: KeyValueStore,
  home: HomeSpec,
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return createMisskeyClient(publicSessionOf(store, home)).callPublic<T>(endpoint, params);
}

/** The internal (home-origin) path with no active-session routing. Used
 * for session operations that must always target the home server (restore,
 * internal sign-in/out, internal refresh) even while another account is
 * active. */
export function apiCallInternal<T>(
  store: KeyValueStore,
  home: HomeSpec,
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const session = internalSessionOf(store, home.origin) ?? placeholderSession(home);
  return createMisskeyClient(session).call<T>(endpoint, params);
}

/** Multipart Drive upload. `drive/files/create` is NOT JSON: the file and
 * the credential ride as FormData fields (`file`, `i`). The runtime sets
 * the multipart boundary — never set Content-Type by hand here. */
export function uploadDriveFile<T>(
  store: KeyValueStore,
  home: HomeSpec,
  file: File,
  opts: { isSensitive?: boolean; comment?: string } = {},
): Promise<T> {
  const session =
    activeSessionOf(store, home.origin) ??
    internalSessionOf(store, home.origin) ??
    placeholderSession(home);
  return createMisskeyClient(session).upload<T>(file, opts);
}

// --- Misskey-family native authentication ---------------------------------------

/** Misskey-family native `signin-flow` (username/password, no redirects)
 * against the home server. The full-authority native credential the flow
 * may return is memory-only, never persisted. */
export function nativeSigninFlow(
  store: KeyValueStore,
  home: HomeSpec,
  username: string,
  password: string,
): Promise<SigninFlowResponse> {
  return signinFlow(
    <T>(endpoint: string, params?: Record<string, unknown>) =>
      apiCallPublic<T>(store, home, endpoint, params),
    username,
    password,
  );
}

/** Exchange a native credential for a scoped Keystone app token (memory-
 * only until the session store persists it). */
export function nativeMintAppToken(
  store: KeyValueStore,
  home: HomeSpec,
  nativeToken: string,
): Promise<string> {
  return mintAppToken(
    <T>(endpoint: string, params?: Record<string, unknown>) =>
      apiCallPublic<T>(store, home, endpoint, params),
    nativeToken,
  );
}
