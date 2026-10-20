// Unified session store (plan §2.1/§3 Phase 1 item C).
//
// One store envelope: `keystone_sessions`, whose sessions are keyed by
// `id = "${origin} ${accountId}"`. A transport client can only be built FROM
// a Session, so a token can only ever reach its own origin.
//
// `Session = { id, origin, family, flavor, accountId, token, grant, hosting }`
//   grant   = password | miauth | oauth-pkce | oauth-code | injected
//   hosting = first-party | third-party
//
// Ported from old Keystone `frontend/src/core/sessions.ts`, adapted for the
// pure-TS rule:
//
// - Storage seam: every function takes a `KeyValueStore` (sync, matching the
//   old call sites) instead of touching `localStorage`. The app wires
//   MMKV/SecureStore behind this interface (slice 2.5); tests use
//   `createMemoryStore()`.
// - Origin seam: the legacy internal-token migration binds migrated tokens
//   to an explicitly passed `origin` instead of `location.origin`.
//
// LEGACY MIGRATION runs once (the first load that finds no valid envelope)
// and merges every pre-Phase-1 key:
//   keystone_token_<backend>   api/backend.ts tokenKeyFor()  (internal)
//   pinetree_token             pre-multibackend Pinetree key (internal)
//   keystone_external_sessions api/external.ts SESSIONS_KEY   (external MiAuth)
//   keystone_active_external   api/external.ts ACTIVE_KEY     (active host)
//   keystodon_masto_sessions   api/mastodon/sessions.ts       (Mastodon OAuth)
//   keystodon_active_masto     Keystodon active pointer
//   keystodon_masto_apps       api/mastodon/oauth.ts app cache -> keystone_apps
//
// Migration is COPY-ONLY: the legacy keys are left in place; `removeLegacyKeys()`
// exists for the later auth switch and is NOT called here.
//
// Revoke on logout (best-effort, failures never block local sign-out):
//   misskey family -> POST ${origin}/api/i/revoke-token
//   mastodon family -> POST ${origin}/oauth/revoke (RFC 7009)

import { familyOf, type ServerFamily, type ServerFlavor } from "./detect";
import type { Account } from "./models";

export type SessionGrant =
  | "password"
  | "miauth"
  | "oauth-pkce"
  | "oauth-code"
  | "injected";

export type SessionHosting = "first-party" | "third-party";

export interface Session {
  /** `${origin} ${accountId}` — the per-(origin, account) key. */
  id: string;
  /** Canonical origin the token belongs to. A token is only ever sent here. */
  origin: string;
  family: ServerFamily;
  flavor: ServerFlavor;
  accountId: string;
  token: string;
  grant: SessionGrant;
  hosting: SessionHosting;
  /** Cached profile for third-party sessions (the external MiAuth flow
   * stores the verified account so a reload shows it without a fetch).
   * Never a credential; absent means "fetch on demand". */
  user?: Account;
}

export const SESSIONS_KEY = "keystone_sessions";
export const OAUTH_APPS_KEY = "keystone_apps";
export const STORE_VERSION = 1;

/** Placeholder account id for migrated internal tokens: the legacy keys
 * stored only a token, never the account it belongs to. The auth layer
 * re-keys the session (same origin, real accountId) after the first
 * successful `i`. */
export const UNKNOWN_ACCOUNT_ID = "unknown";

export function sessionId(origin: string, accountId: string): string {
  return `${origin} ${accountId}`;
}

// --- Storage seam ------------------------------------------------------------

/** Synchronous key/value storage behind the session store. Sync by design:
 * it matches the old call sites, MMKV (the native backing, slice 2.5) is
 * synchronous, and the async SecureStore token layer wraps above this. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory `KeyValueStore` for tests and non-persisted use. */
export function createMemoryStore(initial?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Fallback origin for migrated internal tokens when the caller passes none.
 * Matches the old non-DOM fallback; the app always passes its real origin. */
export const DEFAULT_INTERNAL_ORIGIN = "http://localhost";

interface Store {
  version: number;
  active: string | null;
  sessions: Session[];
}

function emptyStore(): Store {
  return { version: STORE_VERSION, active: null, sessions: [] };
}

function normalizeSession(value: unknown): Session | null {
  if (typeof value !== "object" || value === null) return null;
  const s = value as Partial<Session>;
  if (
    typeof s.id !== "string" ||
    !s.id ||
    typeof s.origin !== "string" ||
    !s.origin ||
    typeof s.token !== "string" ||
    !s.token ||
    typeof s.accountId !== "string" ||
    (s.family !== "misskey" && s.family !== "mastodon")
  ) {
    return null;
  }
  const family: ServerFamily = s.family;
  const flavor: ServerFlavor =
    s.flavor === "misskey" || s.flavor === "sharkey" || s.flavor === "catodon" ||
    s.flavor === "pinetree" || s.flavor === "mastodon" || s.flavor === "akkoma" ||
    s.flavor === "pleroma" || s.flavor === "unknown"
      ? s.flavor
      : "unknown";
  const grant: SessionGrant =
    s.grant === "password" || s.grant === "miauth" || s.grant === "oauth-pkce" ||
    s.grant === "oauth-code" || s.grant === "injected"
      ? s.grant
      : "injected";
  const hosting: SessionHosting =
    s.hosting === "first-party" || s.hosting === "third-party" ? s.hosting : "third-party";
  return {
    id: s.id,
    origin: s.origin,
    family,
    flavor,
    accountId: s.accountId,
    token: s.token,
    grant,
    hosting,
    ...(s.user && typeof (s.user as { id?: unknown }).id === "string"
      ? { user: s.user }
      : {}),
  };
}

function readStore(store: KeyValueStore): Store | null {
  try {
    const raw = store.getItem(SESSIONS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const rec = parsed as Partial<Store>;
    if (rec.version !== STORE_VERSION || !Array.isArray(rec.sessions)) return null;
    const sessions: Session[] = [];
    for (const item of rec.sessions) {
      const s = normalizeSession(item);
      if (s) sessions.push(s);
    }
    return {
      version: STORE_VERSION,
      active: typeof rec.active === "string" && rec.active ? rec.active : null,
      sessions,
    };
  } catch {
    return null; // corrupt store: treated as absent, migration rebuilds it
  }
}

function writeStore(store: KeyValueStore, data: Store): void {
  try {
    store.setItem(SESSIONS_KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable: sessions last for this process only.
  }
}

function update(
  store: KeyValueStore,
  fn: (data: Store) => Store,
  origin?: string,
): Store {
  ensureMigrated(store, origin);
  const data = fn(readStore(store) ?? emptyStore());
  writeStore(store, data);
  return data;
}

// --- Public store API --------------------------------------------------------
//
// `origin` on each entry point feeds only the legacy internal-token
// migration (migrated internal tokens are bound to it); once the envelope
// exists it is unused.

/** All stored sessions (migrated first). */
export function loadSessions(store: KeyValueStore, origin?: string): Session[] {
  ensureMigrated(store, origin);
  return (readStore(store) ?? emptyStore()).sessions;
}

/** Insert or replace the session with the same (origin, accountId) id. */
export function saveSession(
  store: KeyValueStore,
  session: Session,
  origin?: string,
): Session[] {
  const normalized = normalizeSession(session);
  if (!normalized) return loadSessions(store, origin);
  return update(
    store,
    (data) => ({
      ...data,
      sessions: [
        normalized,
        ...data.sessions.filter((s) => s.id !== normalized.id),
      ],
    }),
    origin,
  ).sessions;
}

export function removeSession(
  store: KeyValueStore,
  id: string,
  origin?: string,
): Session[] {
  return update(
    store,
    (data) => ({
      ...data,
      active: data.active === id ? null : data.active,
      sessions: data.sessions.filter((s) => s.id !== id),
    }),
    origin,
  ).sessions;
}

export function findSession(
  store: KeyValueStore,
  id: string,
  origin?: string,
): Session | null {
  return loadSessions(store, origin).find((s) => s.id === id) ?? null;
}

export function getActiveSessionId(
  store: KeyValueStore,
  origin?: string,
): string | null {
  ensureMigrated(store, origin);
  return (readStore(store) ?? emptyStore()).active;
}

export function setActiveSessionId(
  store: KeyValueStore,
  id: string | null,
  origin?: string,
): void {
  update(store, (data) => ({ ...data, active: id }), origin);
}

/** The active session, or null. A stale pointer resolves to null — never
 * to a half session. */
export function getActiveSession(
  store: KeyValueStore,
  origin?: string,
): Session | null {
  const id = getActiveSessionId(store, origin);
  if (!id) return null;
  return findSession(store, id, origin);
}

/** Re-key a session after the real account id becomes known (the auth layer
 * uses this for migrated `UNKNOWN_ACCOUNT_ID` internal tokens after `i`). */
export function rekeySession(
  store: KeyValueStore,
  oldId: string,
  accountId: string,
  origin?: string,
): Session[] {
  return update(store, (data) => {
    const old = data.sessions.find((s) => s.id === oldId);
    if (!old) return data;
    const nextId = sessionId(old.origin, accountId);
    const rekeyed: Session = { ...old, id: nextId, accountId };
    return {
      ...data,
      active: data.active === oldId ? nextId : data.active,
      sessions: [
        rekeyed,
        ...data.sessions.filter((s) => s.id !== oldId && s.id !== nextId),
      ],
    };
  }, origin).sessions;
}

// --- Legacy migration --------------------------------------------------------

const LEGACY_INTERNAL_KEYS: ReadonlyArray<{ key: string; flavor: ServerFlavor }> = [
  { key: "keystone_token_misskey", flavor: "misskey" },
  { key: "keystone_token_sharkey", flavor: "sharkey" },
  { key: "keystone_token_pinetree", flavor: "pinetree" },
  // Pre-multibackend Pinetree key (api/client.ts getToken fallback).
  { key: "pinetree_token", flavor: "pinetree" },
];

const LEGACY_EXTERNAL_SESSIONS_KEY = "keystone_external_sessions";
const LEGACY_EXTERNAL_ACTIVE_KEY = "keystone_active_external";
const LEGACY_MASTO_SESSIONS_KEY = "keystodon_masto_sessions";
const LEGACY_MASTO_ACTIVE_KEY = "keystodon_active_masto";
const LEGACY_MASTO_APPS_KEY = "keystodon_masto_apps";

export const LEGACY_KEYS: readonly string[] = [
  ...LEGACY_INTERNAL_KEYS.map((k) => k.key),
  LEGACY_EXTERNAL_SESSIONS_KEY,
  LEGACY_EXTERNAL_ACTIVE_KEY,
  LEGACY_MASTO_SESSIONS_KEY,
  LEGACY_MASTO_ACTIVE_KEY,
  LEGACY_MASTO_APPS_KEY,
];

function safeGet(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: KeyValueStore, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch {
    // Ignore.
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // corrupt legacy values are dropped, never crash
  }
}

function pushUnique(list: Session[], session: Session | null): void {
  if (!session) return;
  if (list.some((s) => s.id === session.id)) return; // first wins; nothing lost
  list.push(session);
}

/**
 * Merge every legacy key into the store. Runs exactly once — the first
 * load that finds no valid `keystone_sessions` envelope; afterwards the
 * envelope exists and later loads (and this function) are no-ops, so
 * migration is idempotent and can never resurrect a removed session.
 *
 * `origin` binds migrated internal tokens (the old code used
 * `location.origin`); the app passes its own origin explicitly.
 */
export function migrateLegacySessions(
  store: KeyValueStore,
  origin: string = DEFAULT_INTERNAL_ORIGIN,
): Session[] {
  if (readStore(store) !== null) return (readStore(store) as Store).sessions;

  const migrated: Session[] = [];

  // 1. Internal tokens: same-origin (through the proxy), Misskey family.
  //    Order is deterministic; on an id collision the first key wins — the
  //    legacy keys stay in place, so no credential is lost from storage.
  for (const { key, flavor } of LEGACY_INTERNAL_KEYS) {
    const token = safeGet(store, key);
    if (!token) continue;
    pushUnique(migrated, {
      id: sessionId(origin, UNKNOWN_ACCOUNT_ID),
      origin,
      family: "misskey",
      flavor,
      accountId: UNKNOWN_ACCOUNT_ID,
      token,
      grant: "password",
      hosting: "first-party",
    });
  }

  // 2. External MiAuth sessions (api/external.ts shape).
  const external = parseJson(safeGet(store, LEGACY_EXTERNAL_SESSIONS_KEY));
  const externalByHost: Record<string, Session> = {};
  if (Array.isArray(external)) {
    for (const item of external) {
      if (typeof item !== "object" || item === null) continue;
      const s = item as {
        host?: unknown;
        scheme?: unknown;
        token?: unknown;
        user?: { id?: unknown };
      };
      if (
        typeof s.host !== "string" ||
        !s.host ||
        (s.scheme !== "http" && s.scheme !== "https") ||
        typeof s.token !== "string" ||
        !s.token ||
        typeof s.user?.id !== "string" ||
        !s.user.id
      ) {
        continue; // corrupt/unknown entry: dropped
      }
      const sessionOrigin = `${s.scheme}://${s.host}`;
      const session: Session = {
        id: sessionId(sessionOrigin, s.user.id),
        origin: sessionOrigin,
        family: "misskey",
        // The external MiAuth flow never recorded which fork answered;
        // detection upgrades the flavor. "unknown" auths via the
        // `i` body field, which every Misskey-family server accepts.
        flavor: "unknown",
        accountId: s.user.id,
        token: s.token,
        grant: "miauth",
        hosting: "third-party",
      };
      externalByHost[s.host] = session;
      pushUnique(migrated, session);
    }
  }

  // 3. Keystodon Mastodon sessions (mastodon/sessions.ts shape).
  const masto = parseJson(safeGet(store, LEGACY_MASTO_SESSIONS_KEY));
  if (Array.isArray(masto)) {
    for (const item of masto) {
      if (typeof item !== "object" || item === null) continue;
      const s = item as {
        origin?: unknown;
        kind?: unknown;
        token?: unknown;
        account?: { id?: unknown };
      };
      if (
        typeof s.origin !== "string" ||
        !s.origin ||
        typeof s.token !== "string" ||
        !s.token ||
        typeof s.account?.id !== "string" ||
        !s.account.id
      ) {
        continue; // corrupt/unknown entry: dropped
      }
      pushUnique(migrated, {
        id: sessionId(s.origin, s.account.id),
        origin: s.origin,
        family: "mastodon",
        // The old store never recorded the flavor; NodeInfo detection
        // (core/detect.ts) refines it on the next boot.
        flavor: "unknown",
        accountId: s.account.id,
        token: s.token,
        // Keystodon's default flow was OAuth PKCE (authorization-code with
        // a cached app for Akkoma); the old store did not record which.
        grant: "oauth-pkce",
        hosting: s.kind === "internal" ? "first-party" : "third-party",
      });
    }
  }

  // 4. Keystodon's per-origin OAuth app cache -> keystone_apps (RFC 7009
  //    revocation needs the app credentials).
  const apps = parseJson(safeGet(store, LEGACY_MASTO_APPS_KEY));
  if (apps !== null && typeof apps === "object" && !Array.isArray(apps)) {
    const existing = parseJson(safeGet(store, OAUTH_APPS_KEY));
    const base =
      existing !== null && typeof existing === "object" && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};
    safeSet(store, OAUTH_APPS_KEY, JSON.stringify({ ...(apps as Record<string, unknown>), ...base }));
  }

  // 5. Active pointer. The envelope's own choice wins if somehow present;
  //    otherwise Keystone's own external pointer beats the frozen island's.
  let active: string | null = null;
  const activeHost = safeGet(store, LEGACY_EXTERNAL_ACTIVE_KEY);
  if (activeHost && externalByHost[activeHost]) {
    active = externalByHost[activeHost].id;
  }
  if (!active) {
    const activeMasto = safeGet(store, LEGACY_MASTO_ACTIVE_KEY);
    if (activeMasto && migrated.some((s) => s.id === activeMasto)) {
      active = activeMasto;
    }
  }

  writeStore(store, { version: STORE_VERSION, active, sessions: migrated });
  return migrated;
}

function ensureMigrated(store: KeyValueStore, origin?: string): void {
  migrateLegacySessions(store, origin ?? DEFAULT_INTERNAL_ORIGIN);
}

/**
 * Delete every legacy key. NOT called during migration — the legacy readers
 * stay live until auth flips to this store; the auth layer calls this to
 * finish the migration.
 */
export function removeLegacyKeys(store: KeyValueStore): void {
  for (const key of LEGACY_KEYS) {
    try {
      store.removeItem(key);
    } catch {
      // Ignore.
    }
  }
}

// --- Revoke on logout (best-effort) ------------------------------------------

export interface RevokeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** App-credential cache (`keystone_apps`); without it Mastodon revocation
   * is skipped (no request is ever sent without the cached app). */
  store?: KeyValueStore;
}

function cachedAppFor(
  store: KeyValueStore | undefined,
  origin: string,
): { client_id?: string; client_secret?: string } | null {
  if (!store) return null;
  const apps = parseJson(safeGet(store, OAUTH_APPS_KEY));
  if (apps === null || typeof apps !== "object" || Array.isArray(apps)) return null;
  const app = (apps as Record<string, unknown>)[origin];
  return typeof app === "object" && app !== null
    ? (app as { client_id?: string; client_secret?: string })
    : null;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort server-side revocation for a session. Misskey family:
 * `POST ${origin}/api/i/revoke-token`. Mastodon family:
 * `POST ${origin}/oauth/revoke` with the cached app credentials (RFC 7009;
 * skipped when no app is cached). Never throws — local state clears
 * regardless of the outcome.
 */
export async function revokeSessionToken(
  session: Session,
  opts: RevokeOptions = {},
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  try {
    const family = session.family ?? familyOf(session.flavor);
    if (family === "mastodon") {
      const app = cachedAppFor(opts.store, session.origin);
      if (!app?.client_id) return;
      const form = new URLSearchParams({ token: session.token, client_id: app.client_id });
      if (app.client_secret) form.set("client_secret", app.client_secret);
      await fetchImpl(`${session.origin}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: timeoutSignal(timeoutMs),
      });
      return;
    }
    await fetchImpl(`${session.origin}/api/i/revoke-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ i: session.token }),
      signal: timeoutSignal(timeoutMs),
    });
  } catch {
    // Offline, already-revoked, or unsupported endpoint: ignore.
  }
}
