import {
  ApiError,
  backendForSession,
  FALLBACK_SCOPES,
  FediError,
  getActiveSessionId,
  loadSessions,
  MASTO_SCOPES,
  OAUTH_APPS_KEY,
  removeSession,
  revokeSessionToken,
  saveSession,
  sessionId,
  setActiveSessionId,
  type ServerFamily,
  type ServerFlavor,
  type Session,
  type SessionGrant,
  type SessionHosting,
  type KeyValueStore,
} from '@keystone/fedi'

import {readDeviceState, writeDeviceState, type TokenVault} from '#/storage'

// App session store (slice 2.5): active-session id + session records,
// persisted through the 2.1 `KeyValueStore` seam so the SAME core session
// logic runs here and in `packages/fedi`.
//
// Layering (async-vs-sync, per the `core/sessions` header):
// - sync seam (MMKV): the session envelope (`keystone_sessions`) —
//   sessions WITH their token copy, so sync core logic (request building,
//   revoke flows) works unchanged on both platforms.
// - async vault above it (SecureStore native / MMKV web-dev-grade):
//   the OS-secured per-(session id, origin) token copy. Writes go through
//   to both; reads prefer the vault when it holds a value (`hydrate()`).
// - device scope mirror: `activeSessionId` is written through on every
//   switch/sign-out; the envelope stays the source of truth, the mirror
//   is only a boot fallback (`resolveActiveId`).
//
// Tokens are per origin end to end: requests are built FROM a session
// (fedi transports), so session A's token can never reach session B's
// origin — pinned by the cross-origin test, not by convention.

export interface NewSessionInput {
  origin: string
  family: ServerFamily
  flavor: ServerFlavor
  accountId: string
  token: string
  grant: SessionGrant
  hosting: SessionHosting
  user?: Session['user']
  evidence?: Session['evidence']
}

export interface SessionStoreDeps {
  storage: KeyValueStore
  vault: TokenVault
  /** Binds migrated internal tokens (the app's own origin). */
  homeOrigin: string
  /** Revoke transport (tests stub this; defaults to global fetch). */
  revokeFetch?: typeof fetch
}

export interface SessionSnapshot {
  sessions: Session[]
  activeId: string | null
}

/** Result of a boot re-verify (`verifySession`/`verifyActive`, MD5). Plain
 * code strings — this layer is Lingui-free, the UI localizes the prompt.
 * `cleared` is true only when the dead session was dropped from the store. */
export interface SessionVerifyResult {
  ok: boolean
  reason:
    | 'ok'
    | 'signed-out'
    | 'unknown-session'
    | 'unauthorized'
    | 'forbidden'
    | 'network'
    | 'error'
  cleared: boolean
}

/** Result of `refreshActive` (MD5). Tokens are single bearer/app tokens —
 * no refresh token is persisted in the envelope (STORAGE_VERSION stays 2),
 * so refresh is honestly unsupported and expiry means re-auth. */
export interface SessionRefreshResult {
  refreshed: boolean
  reason: 'refreshed' | 'signed-out' | 'unknown-session' | 'unsupported' | 'network' | 'error'
}

/** Which scope generation a Mastodon-family session's cached app belongs
 * to: `pre-scopes` (umbrella `read write follow` only), `granular` (the W4
 * set, no umbrellas), `current` (W5 umbrella + granular). Misskey-family
 * sessions carry no OAuth scopes (`not-applicable`); no app cache means
 * `unknown` (never a verdict — `verifyActive` is the arbiter). */
export type SessionScopeGeneration =
  | 'current'
  | 'granular'
  | 'pre-scopes'
  | 'unknown'
  | 'not-applicable'
  | 'signed-out'

/** Scope auto-upgrade detection (MD5): old sessions stay old-scoped until
 * re-auth (OAuth needs the user in a browser — no silent upgrade), so this
 * surfaces `needsUpgrade` + the missing tokens for the sign-in prompt.
 * `needsReauth` stays false here; it flips only when `verifyActive`
 * proves the token dead (401 → cleared). */
export interface SessionScopeHealth {
  needsReauth: boolean
  needsUpgrade: boolean
  generation: SessionScopeGeneration
  /** Plain code string (Lingui-free layer): `current` / `stale-scopes`
   * / `no-app-cache` / `misskey-no-scopes` / `signed-out` /
   * `unknown-session`. */
  reason: string
  /** Current `MASTO_SCOPES` tokens absent from the cached app. */
  missingScopes: string[]
}

/**
 * Envelope `active` wins; the device mirror only fills a missing pointer
 * (and only when it still resolves to a stored session — never a ghost).
 */
export function resolveActiveId(
  envelopeActive: string | null,
  mirrorActive: string | null,
  sessions: Session[],
): string | null {
  if (envelopeActive && sessions.some(s => s.id === envelopeActive)) return envelopeActive
  if (mirrorActive && sessions.some(s => s.id === mirrorActive)) return mirrorActive
  return null
}

/** True when the failure is the transport never reaching the server
 * (offline/DNS/TLS/abort/timeout) rather than the server answering.
 * The transports wrap those as `FediError errors.network.*` (misskey) —
 * never `ApiError` — so both shapes count. Never clears. */
function isNetworkFailure(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0
  if (err instanceof FediError) return err.code.startsWith('errors.network.')
  // Non-HTTP failures from fetch (TypeError on refused/DNS, AbortError).
  return err instanceof TypeError || (err instanceof Error && err.name === 'AbortError')
}

/** Cached OAuth app scopes for one origin (`keystone_apps`, same store).
 * Null when absent/unparsable — an honest "no evidence", never a verdict.
 * Ignores the redirect-uri binding `getCachedApp` enforces: a changed
 * callback re-registers at the next OAuth start anyway, so a stale entry
 * here conservatively reads as "upgrade needed". */
function cachedAppScopes(storage: KeyValueStore, origin: string): string[] | null {
  let raw: string | null = null
  try {
    raw = storage.getItem(OAUTH_APPS_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, {scopes?: unknown} | null | undefined>
    const entry = parsed[origin]
    if (!entry || typeof entry.scopes !== 'string') return null
    return entry.scopes.split(/\s+/).filter(Boolean)
  } catch {
    return null
  }
}

export interface SessionStore {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  list(): Session[]
  activeId(): string | null
  active(): Session | null
  /** Persist a session (envelope + vault) and activate it (sign-in). */
  add(input: NewSessionInput): Promise<Session>
  /** Activate a STORED session. False when unknown — never a ghost. */
  switch(id: string): boolean
  /** Best-effort server revoke, then drop envelope + vault entries. */
  remove(id: string): Promise<void>
  /** Remove the given (default: active) session. */
  signOut(id?: string): Promise<void>
  /** Revoke + drop every session. The store is empty after this. */
  signOutEverywhere(): Promise<void>
  /** Vault-wins token hydration (async SecureStore layer above the sync
   * seam). No vault value → envelope copy stands. */
  hydrate(): Promise<void>
  /** Adopt the device mirror into the envelope when the envelope pointer
   * is missing (boot recovery). No-op otherwise. */
  initialize(): void
  /** Re-read + notify (after an out-of-band storage change). */
  refresh(): void
  /** Re-verify one stored session's token via `backend.me()` (MD5 boot
   * check). 401 (dead token) drops the session and reports
   * `unauthorized/cleared`; 403 (scope/permissions) is NOT cleared — the
   * token may be valid but under-scoped, see `scopeHealth`; network
   * failures never clear. Root wires this at boot (this module only
   * exposes the hook — it never runs on import/mount). */
  verifySession(id: string): Promise<SessionVerifyResult>
  /** Re-verify the ACTIVE session. Signed out → `signed-out`, never an
   * error. Same clear-on-401 contract as `verifySession`. */
  verifyActive(): Promise<SessionVerifyResult>
  /** Best-effort token refresh (MD5). Honestly unsupported: neither family
   * persists a refresh token in the envelope (Misskey app tokens don't
   * expire; Mastodon `refresh_token` is never stored), so expiry means
   * re-auth. No timers, no network — inert by design. */
  refreshActive(): Promise<SessionRefreshResult>
  /** Scope-generation check for one session (default: active). Sync and
   * read-only: compares the per-origin cached OAuth app scopes against the
   * current `MASTO_SCOPES`. */
  scopeHealth(id?: string | null): SessionScopeHealth
}

export function createSessionStore(deps: SessionStoreDeps): SessionStore {
  const {storage, vault, homeOrigin} = deps
  const listeners = new Set<() => void>()
  let cached: SessionSnapshot | null = null

  function readSessions(): Session[] {
    return loadSessions(storage, homeOrigin)
  }

  function readMirror(): string | null {
    return readDeviceState(storage).activeSessionId
  }

  function writeMirror(activeSessionId: string | null): void {
    writeDeviceState(storage, {...readDeviceState(storage), activeSessionId})
  }

  function snapshot(): SessionSnapshot {
    if (!cached) {
      const sessions = readSessions()
      cached = {
        sessions,
        activeId: resolveActiveId(getActiveSessionId(storage, homeOrigin), readMirror(), sessions),
      }
    }
    return cached
  }

  function emit(): void {
    cached = null
    for (const listener of [...listeners]) listener()
  }

  function revoke(session: Session): Promise<void> {
    return revokeSessionToken(session, {
      fetchImpl: deps.revokeFetch ?? fetch,
      store: storage,
    })
  }

  /** Drop a session WITHOUT server revoke (dead-token path: revoking with
   * a 401 token is a doomed round-trip; local state still clears). */
  function dropLocal(id: string): void {
    const existing = readSessions().find(s => s.id === id)
    if (!existing) return
    removeSession(storage, id, homeOrigin)
    void vault.removeToken(id, existing.origin)
    if (readMirror() === id) writeMirror(null)
    emit()
  }

  const store: SessionStore = {
    getSnapshot: () => snapshot(),

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    list(): Session[] {
      return snapshot().sessions
    },

    activeId(): string | null {
      return snapshot().activeId
    },

    active(): Session | null {
      const snap = snapshot()
      return snap.sessions.find(s => s.id === snap.activeId) ?? null
    },

    async add(input: NewSessionInput): Promise<Session> {
      const session: Session = {
        id: sessionId(input.origin, input.accountId),
        origin: input.origin,
        family: input.family,
        flavor: input.flavor,
        accountId: input.accountId,
        token: input.token,
        grant: input.grant,
        hosting: input.hosting,
        ...(input.user ? {user: input.user} : {}),
        ...(input.evidence ? {evidence: input.evidence} : {}),
      }
      saveSession(storage, session, homeOrigin)
      await vault.setToken(session.id, session.origin, session.token)
      setActiveSessionId(storage, session.id, homeOrigin)
      writeMirror(session.id)
      emit()
      return session
    },

    switch(id: string): boolean {
      if (!readSessions().some(s => s.id === id)) return false
      setActiveSessionId(storage, id, homeOrigin)
      writeMirror(id)
      emit()
      return true
    },

    async remove(id: string): Promise<void> {
      const existing = readSessions().find(s => s.id === id)
      if (!existing) return
      await revoke(existing)
      removeSession(storage, id, homeOrigin)
      await vault.removeToken(id, existing.origin)
      if (readMirror() === id) writeMirror(null)
      emit()
    },

    async signOut(id?: string): Promise<void> {
      const target = id ?? store.activeId()
      if (!target) return
      await store.remove(target)
    },

    async signOutEverywhere(): Promise<void> {
      const sessions = readSessions()
      for (const session of sessions) {
        await revoke(session)
      }
      for (const session of sessions) {
        removeSession(storage, session.id, homeOrigin)
        await vault.removeToken(session.id, session.origin)
      }
      setActiveSessionId(storage, null, homeOrigin)
      writeMirror(null)
      emit()
    },

    async hydrate(): Promise<void> {
      let changed = false
      for (const session of readSessions()) {
        const vaultToken = await vault.getToken(session.id, session.origin)
        if (vaultToken != null && vaultToken !== '' && vaultToken !== session.token) {
          saveSession(storage, {...session, token: vaultToken}, homeOrigin)
          changed = true
        }
      }
      if (changed) emit()
    },

    initialize(): void {
      const sessions = readSessions()
      const envelopeActive = getActiveSessionId(storage, homeOrigin)
      if (envelopeActive && sessions.some(s => s.id === envelopeActive)) return
      const mirror = readMirror()
      if (mirror && sessions.some(s => s.id === mirror)) {
        setActiveSessionId(storage, mirror, homeOrigin)
        emit()
      }
    },

    refresh(): void {
      emit()
    },

    async verifySession(id: string): Promise<SessionVerifyResult> {
      const session = readSessions().find(s => s.id === id) ?? null
      if (!session) return {ok: false, reason: 'unknown-session', cleared: false}
      let backend: ReturnType<typeof backendForSession>
      try {
        backend = backendForSession(session)
      } catch {
        return {ok: false, reason: 'error', cleared: false}
      }
      try {
        await backend.me()
        return {ok: true, reason: 'ok', cleared: false}
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          dropLocal(id)
          return {ok: false, reason: 'unauthorized', cleared: true}
        }
        if (err instanceof ApiError && err.status === 403) {
          // Scope/permission failure: the token may still be valid for its
          // old surface — never clear, surface `forbidden` + `scopeHealth`.
          return {ok: false, reason: 'forbidden', cleared: false}
        }
        if (isNetworkFailure(err)) return {ok: false, reason: 'network', cleared: false}
        return {ok: false, reason: 'error', cleared: false}
      }
    },

    async verifyActive(): Promise<SessionVerifyResult> {
      const id = snapshot().activeId
      if (!id) return {ok: false, reason: 'signed-out', cleared: false}
      return store.verifySession(id)
    },

    async refreshActive(): Promise<SessionRefreshResult> {
      const id = snapshot().activeId
      if (!id) return {refreshed: false, reason: 'signed-out'}
      if (!readSessions().some(s => s.id === id)) {
        return {refreshed: false, reason: 'unknown-session'}
      }
      // No refresh token is persisted for either family (see the type
      // header): there is nothing to exchange, so this is an honest no-op.
      // Expiry surfaces as 401 on the next `verifyActive`/query and the
      // fix is re-auth, not retry.
      return {refreshed: false, reason: 'unsupported'}
    },

    scopeHealth(id?: string | null): SessionScopeHealth {
      const target = id ?? snapshot().activeId
      if (!target) {
        return {
          needsReauth: false,
          needsUpgrade: false,
          generation: 'signed-out',
          reason: 'signed-out',
          missingScopes: [],
        }
      }
      const session = readSessions().find(s => s.id === target) ?? null
      if (!session) {
        return {
          needsReauth: false,
          needsUpgrade: false,
          generation: 'signed-out',
          reason: 'unknown-session',
          missingScopes: [],
        }
      }
      if (session.family !== 'mastodon') {
        return {
          needsReauth: false,
          needsUpgrade: false,
          generation: 'not-applicable',
          reason: 'misskey-no-scopes',
          missingScopes: [],
        }
      }
      const cached = cachedAppScopes(storage, session.origin)
      if (!cached) {
        return {
          needsReauth: false,
          needsUpgrade: false,
          generation: 'unknown',
          reason: 'no-app-cache',
          missingScopes: [],
        }
      }
      const have = new Set(cached)
      const missing = MASTO_SCOPES.filter(s => !have.has(s))
      if (missing.length === 0) {
        return {needsReauth: false, needsUpgrade: false, generation: 'current', reason: 'current', missingScopes: []}
      }
      const umbrella = new Set(FALLBACK_SCOPES.split(/\s+/).filter(Boolean))
      const generation: SessionScopeGeneration = cached.every(s => umbrella.has(s))
        ? 'pre-scopes'
        : cached.some(s => s.startsWith('write:') || s.startsWith('read:'))
          ? 'granular'
          : 'unknown'
      return {needsReauth: false, needsUpgrade: true, generation, reason: 'stale-scopes', missingScopes: missing}
    },
  }

  return store
}
