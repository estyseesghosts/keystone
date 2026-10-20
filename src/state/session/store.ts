import {
  getActiveSessionId,
  loadSessions,
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
  }

  return store
}
