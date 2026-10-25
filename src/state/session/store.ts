import {
  ApiError,
  backendForSession,
  FALLBACK_SCOPES,
  FediError,
  getActiveSessionId,
  loadSessions,
  OAUTH_APPS_KEY,
  readStoredAppSecrets,
  removeSession,
  revokeSessionToken,
  saveSession,
  scopesForFlavor,
  scrubStoredAppSecrets,
  sessionId,
  sessionWithoutToken,
  setActiveSessionId,
  SESSIONS_KEY,
  STORE_VERSION,
  type ServerFamily,
  type ServerFlavor,
  type Session,
  type SessionGrant,
  type SessionHosting,
  type KeyValueStore,
} from '@keystone/fedi'

import {
  readDeviceState,
  writeDeviceState,
  type SecureTokenVault,
  type TokenVault,
} from '#/storage'
import {sweepStaleMisskeyPending} from '#/screens/LoginFlows'
// Repair X6.2 step 7 (deviation: one boot hookup outside the listed files):
// expired local drafts are swept at boot, next to the MiAuth sweep.
import {sweepExpiredDrafts} from '#/storage/drafts'

import {
  clearAllQueries,
  purgeAllPersistedSessions,
  purgeSessionMemory,
  purgeSessionStorage,
  removeSessionQueries,
} from './purge'

// App session store (slice 2.5 + ADR 0011): active-session id + session
// records, persisted through the 2.1 `KeyValueStore` seam so the SAME core
// session logic runs here and in `packages/fedi`.
//
// Layering (async-vs-sync, per the `core/sessions` header):
// - sync seam (MMKV): the session envelope (`keystone_sessions`). On
//   native it is SECRET-FREE — rows persist via `sessionWithoutToken`
//   (`token: ''` means "not hydrated", and fedi accepts that form so a
//   scrub never drops a session). On web the envelope keeps the token copy
//   (dev-grade, owner decision D2).
// - in-memory token map: populated by `add()` and by `hydrate()` (awaited
//   in `Root` before the first request, as today). Every session this
//   store hands out carries its map token; the envelope value is only the
//   web / pre-migration fallback.
// - async vault above the seam (SecureStore native / MMKV web-dev-grade):
//   the OS-secured per-(session id, origin) token copy. Native writes are
//   awaited and report success; a failure emits `onSessionVaultFailed`
//   (codes only — this layer is Lingui-free, the UI localizes the prompt),
//   keeps the session usable in memory for this run, and keeps any
//   pre-migration envelope copy until a read-back verifies. No silent
//   plaintext fallback: next launch asks the user to sign in again.
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
  /** Plain vaults (web/tests) and OS vaults (native SecureStore): the
   * union, because `SecureTokenVault` is deliberately not a subtype of
   * `TokenVault` — narrowed with `isSecureVault` before secure-only use. */
  vault: TokenVault | SecureTokenVault
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

/**
 * An OS-vault failure the caller must surface (ADR 0011). Codes only —
 * this layer is Lingui-free, the UI localizes the prompt. `sessionId` is
 * null for app secrets (per-origin shared credentials, no session).
 * `token` on native means the session runs memory-only until relaunch,
 * then asks the user to sign in again; `appSecret` means the MMKV row
 * copy was kept and revocation falls back to it.
 */
export interface VaultFailure {
  sessionId: string | null
  origin: string
  kind: 'token' | 'appSecret'
}

/** Which scope/permission generation a session belongs to: `pre-scopes`
 * (Mastodon umbrella `read write follow` only — only reachable on
 * Akkoma/Pleroma sessions now, where the triple is NOT enough),
 * `granular` (a granular cache missing at least one expected entry),
 * `current` (every flavor-expected scope present — ADR 0003 + ADR 0005),
 * `stale-permissions` (Misskey-family: a live call answered 403
 * PERMISSION_DENIED, so the stored token predates a permission this build
 * uses — there is no scope diff to run). Scopes in `SCOPES_LATER` are
 * never required, so an app missing only those still reads `current`.
 * Misskey-family sessions before any 403 carry no OAuth scopes
 * (`not-applicable`); no app cache means `unknown` (never a verdict —
 * `verifyActive` is the arbiter). */
export type SessionScopeGeneration =
  | 'current'
  | 'granular'
  | 'pre-scopes'
  | 'stale-permissions'
  | 'unknown'
  | 'not-applicable'
  | 'signed-out'

/** Scope/permission auto-upgrade detection (MD5 + ADR 0003 + ADR 0005):
 * old sessions stay old-scoped until re-auth (OAuth needs the user in a
 * browser — no silent upgrade), so this surfaces `needsUpgrade` + the
 * missing flavor-expected tokens for the sign-in prompt. Extra scopes are
 * fine (only missing matters): a pre-split 26-scope Mastodon token reads
 * `current` against the triple expectation — nothing is revoked.
 * A missing `SCOPES_LATER`
 * scope is never an upgrade reason — those features do not ship yet.
 * Misskey-family sessions have no OAuth scope list to diff; they flip to
 * `needsUpgrade` only after a live 403 PERMISSION_DENIED is recorded via
 * `notePermissionDenied` (clickstone §0.8), and `missingScopes` stays
 * empty because the server never returned one — the prompt says the token
 * predates a permission, it never invents a scope name. `needsReauth`
 * stays false here; it flips only when `verifyActive` proves the token
 * dead (401 → cleared). */
export interface SessionScopeHealth {
  needsReauth: boolean
  needsUpgrade: boolean
  generation: SessionScopeGeneration
  /** Plain code string (Lingui-free layer): `current` / `stale-scopes`
   * / `no-app-cache` / `misskey-no-scopes` / `misskey-stale-permissions`
   * / `signed-out` / `unknown-session`. */
  reason: string
  /** `missingScopes` entries are flavor-expected scopes absent from the
   * cached app (never any `SCOPES_LATER` entry, and always empty on the
   * Misskey-family `misskey-stale-permissions` path — no server-returned
   * list). The expectation is per-flavor (ADR 0005): `mastodon` sessions
   * diff against the umbrella triple, every other flavor against
   * `SCOPES_NOW`. */
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
  /** Best-effort server revoke, then drop envelope + vault entries.
   * Returns false when a Misskey-family revoke failed (non-2xx) so the
   * UI can say the server token may still be valid. Mastodon `false`
   * (no cached app = skipped, never a request) stays silent — same as
   * before, never a failure toast. */
  remove(id: string): Promise<boolean>
  /** Remove the given (default: active) session. False = its server revoke
   * failed (Misskey family); local state still cleared. */
  signOut(id?: string): Promise<boolean>
  /** Revoke + drop every session. The store is empty after this. False =
   * at least one Misskey-family revoke failed; local state still cleared. */
  signOutEverywhere(): Promise<boolean>
  /** Token hydration (async vault layer above the sync seam). Secure vaults
   * (ADR 0011): vault wins, envelope-only tokens migrate in (verified),
   * failures emit. Plain vaults (web, D2): vault-wins overlay, the envelope
   * copy stands. */
  hydrate(): Promise<void>
  /**
   * Subscribe to OS-vault failures (ADR 0011: `sessionVaultFailed`).
   * The UI toasts the localized prompt; the store itself only emits codes.
   */
  onSessionVaultFailed(listener: (failure: VaultFailure) => void): () => void
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
   * exposes the hook — it never runs on import/mount). Repair X1.5:
   * concurrent verifies for one session share a single `me()`
   * (single-flight) and a verify that just ran is reused for 30 s
   * (cool-down, qualified by token); only a fresh `me()` 401 — the
   * second 401 after the query/mutation that triggered the verify —
   * drops the session. */
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
   * read-only: compares the per-origin cached OAuth app scopes against
   * the flavor-expected set (ADR 0005 — the umbrella triple on `mastodon`,
   * `SCOPES_NOW` elsewhere; never the unshipped `SCOPES_LATER` set). */
  scopeHealth(id?: string | null): SessionScopeHealth
  /** Subscription-stable `scopeHealth` for `useSyncExternalStore`: the same
   * object reference is returned until the next store `emit()` (sign-in,
   * sign-out, switch, permission denial). The object is shared — never
   * mutate it. Unknown ids read `unknown-session` (same as `scopeHealth`). */
  scopeHealthSnapshot(id: string): SessionScopeHealth
  /** Record that a live Misskey-family call for this session answered 403
   * PERMISSION_DENIED (clickstone §0.8). In-memory, per session: the
   * evidence is a runtime observation, not durable state, and it must not
   * outlive a fresh sign-in (see `add`). Unknown ids and Mastodon-family
   * sessions are no-ops — Mastodon keeps ADR 0003's scope diff. */
  notePermissionDenied(id: string): void
}

export function createSessionStore(deps: SessionStoreDeps): SessionStore {
  const {storage, vault, homeOrigin} = deps
  const listeners = new Set<() => void>()
  let cached: SessionSnapshot | null = null
  // 0.8: Misskey-family sessions whose token a live call refused with 403
  // PERMISSION_DENIED. Deliberately in-memory: this is evidence from a
  // request in THIS process, not durable account state. Persisting it
  // would need a storage-version bump and could outlive the condition;
  // instead it survives screen unmounts (it lives in the store, the shell
  // subscribes) and is cleared by a fresh `add()` for the same session id
  // (sign-in again) or by removal. After a restart the next refused call
  // re-records it. Set = idempotent, one marker per session.
  const permissionDenied = new Set<string>()
  // Referentially stable `scopeHealth` snapshots for `useSyncExternalStore`
  // subscribers (the shell banner); cleared on every `emit()`.
  const healthSnapshots = new Map<string, SessionScopeHealth>()
  // In-memory token map (ADR 0011): the live secrets. Populated by
  // `add()` (the input token) and by `hydrate()` (the vault copy); every
  // session this store hands out carries its map entry, with the envelope
  // value as the web / pre-migration fallback. Cleared per id on remove.
  const tokens = new Map<string, string>()
  const vaultListeners = new Set<(failure: VaultFailure) => void>()
  // Runtime 401 verification (repair X1.5): one `me()` in flight per
  // session (concurrent 401s share it) and a 30 s cool-down per live
  // token (a verify that just ran is not repeated). Only a fresh 401
  // from `me()` — the second 401 after the query/mutation that
  // triggered the verify — drops the session (via `dropLocal`/purge).
  // 403/network/5xx never drop. Cool-down entries are qualified by
  // token, so a re-added session (new token) always verifies fresh.
  const verifyInFlight = new Map<string, Promise<SessionVerifyResult>>()
  const verifyCooldown = new Map<string, {until: number; token: string; result: SessionVerifyResult}>()
  const VERIFY_COOLDOWN_MS = 30_000
  // Boot cap (repair X3.5): `verifyActive` fails open as `network` after
  // this long, keeping the session. `verifySession` itself is unbounded
  // (X1.5 owns it).
  const VERIFY_ACTIVE_TIMEOUT_MS = 8_000

  // Operation chain (repair X1.2, S5/S6): every read-modify-write that
  // crosses an `await` (`add`, `remove`, `dropLocal`, `hydrate`,
  // `signOutEverywhere`) runs inside `serialize`, so a `remove` can never
  // land between `hydrate`'s vault read and its envelope write (no
  // resurrection), and a second concurrent `hydrate` (the provider mounts
  // once per tree) simply runs after the first instead of interleaving.
  // Sync ops (`switch`, `initialize`, `refresh`) stay outside the chain —
  // they touch no async state.
  let opChain: Promise<void> = Promise.resolve()

  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = opChain.then(work, work)
    opChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  // Recency for D3 (repair X1.2): removing the active session activates
  // the most recently USED remaining session, not merely the list head
  // (`switch` does not reorder the envelope, so the head is only
  // most-recently-ADDED). In-memory only: after a restart the envelope
  // order breaks ties, and no storage shape changes for it.
  const lastUsed = new Map<string, number>()
  let useTick = 0

  function markUsed(id: string): void {
    useTick += 1
    lastUsed.set(id, useTick)
  }

  /** Most recently used of `remaining`. Iterated in envelope order with a
   * strict-greater replacement, so the envelope head wins ties (a fresh
   * boot with no usage history keeps today's order). */
  function mostRecentlyUsed(remaining: Session[]): Session {
    let best = remaining[0]
    for (const session of remaining.slice(1)) {
      if ((lastUsed.get(session.id) ?? 0) > (lastUsed.get(best.id) ?? 0)) best = session
    }
    return best
  }

  // Order-preserving envelope rewrite (repair X1.2, step 4): hydrate must
  // never reorder the list, but fedi's `saveSession` prepends. This writes
  // the envelope in one shot — same `{version, active, sessions}` shape
  // `readStore` validates (`SESSIONS_KEY`, `STORE_VERSION`), rows already
  // normalized — preserving order and the active pointer. Callers re-read
  // first and only pass rows that still exist.
  function rewriteEnvelopeRows(rows: Session[]): void {
    const active = getActiveSessionId(storage, homeOrigin)
    try {
      storage.setItem(SESSIONS_KEY, JSON.stringify({version: STORE_VERSION, active, sessions: rows}))
    } catch {
      // Storage unavailable: the in-memory map still serves this run.
    }
  }

  // D3 (repair X1.2): after erasing sessions, keep a surviving active
  // session untouched (syncing a stale mirror to it); when the removed
  // session WAS active, activate the most recently used remaining one;
  // when none remains, drop to signed-out.
  function fixActiveAfterRemoval(): void {
    const remaining = readSessions()
    if (remaining.length === 0) {
      setActiveSessionId(storage, null, homeOrigin)
      writeMirror(null)
      return
    }
    const resolved = resolveActiveId(getActiveSessionId(storage, homeOrigin), readMirror(), remaining)
    if (resolved) {
      if (getActiveSessionId(storage, homeOrigin) !== resolved) {
        setActiveSessionId(storage, resolved, homeOrigin)
      }
      if (readMirror() !== resolved) writeMirror(resolved)
      return
    }
    const next = mostRecentlyUsed(remaining)
    setActiveSessionId(storage, next.id, homeOrigin)
    writeMirror(next.id)
  }

  /** True for OS-backed vaults (native SecureStore). Plain `TokenVault`
   * stubs (web, tests) run the legacy envelope-keeps-token path.
   * The parameter is the union (not `TokenVault` alone): `SecureTokenVault`
   * is deliberately not a subtype of `TokenVault` (`Promise<boolean>` is
   * not assignable to `Promise<void>`), so the predicate must accept the
   * union for the narrowing to be legal. */
  function isSecureVault(vault: TokenVault | SecureTokenVault): vault is SecureTokenVault {
    return (vault as {secure?: unknown}).secure === true
  }

  function emitVaultFailure(failure: VaultFailure): void {
    for (const listener of [...vaultListeners]) {
      try {
        listener(failure)
      } catch {
        // A failing listener must never break sign-in or boot.
      }
    }
  }

  /** Overlay the in-memory token on one envelope session. */
  function attach(session: Session): Session {
    const memorized = tokens.get(session.id)
    if (memorized) return {...session, token: memorized}
    return session
  }

  /** One stored session with its live token, or null when unknown. */
  function resolveSession(id: string): Session | null {
    const found = readSessions().find(s => s.id === id) ?? null
    return found ? attach(found) : null
  }

  /**
   * Boot migration + hydration for OS vaults (ADR 0011, repair X1.2 step
   * 4). For every stored session: a vault token wins and any envelope
   * duplicate is scrubbed; an envelope-only token is moved into the vault
   * (verified with a read-back, then the row is rewritten tokenless); a
   * failed write keeps the session usable in memory for this run, keeps
   * the envelope copy until verified, and emits. A session with neither
   * fails visibly (re-auth next launch).
   *
   * Every envelope mutation goes through one order-preserving
   * `rewriteEnvelopeRows` at the end (hydrate never reorders), and every
   * write is preceded by a re-read that skips sessions gone or changed
   * under us (S5). The whole body runs inside `serialize` (see `hydrate`).
   */
  async function hydrateSecure(secure: SecureTokenVault): Promise<void> {
    // Rows to scrub, with the envelope token each decision was based on —
    // the final rewrite only touches rows that still carry it (S5).
    const scrubBasis = new Map<string, string>()
    let touched = false
    for (const seen of readSessions()) {
      // Re-read by id immediately before each step: a concurrently
      // removed session is never resurrected, and a changed token wins
      // over the stale snapshot (S5; the chain makes this
      // defense-in-depth, not the only guard).
      const current = readSessions().find(s => s.id === seen.id) ?? null
      if (!current) {
        tokens.delete(seen.id)
        continue
      }
      const envelopeToken = current.token
      let vaultToken: string | null = null
      try {
        vaultToken = await secure.getToken(current.id, current.origin)
      } catch {
        vaultToken = null
      }
      if (vaultToken) {
        if (tokens.get(current.id) !== vaultToken) {
          tokens.set(current.id, vaultToken)
          touched = true
        }
        // The vault wins (existing semantics) — drop any envelope duplicate.
        if (envelopeToken) scrubBasis.set(current.id, envelopeToken)
      } else if (envelopeToken) {
        // Pre-migration (or legacy-writer) row: move it into the vault.
        let stored = false
        try {
          stored = await secure.setToken(current.id, current.origin, envelopeToken)
        } catch {
          stored = false
        }
        if (!stored) {
          try {
            await secure.removeToken(current.id, current.origin)
          } catch {
            // Ignore — the entry is already unusable.
          }
          if (tokens.get(current.id) !== envelopeToken) {
            tokens.set(current.id, envelopeToken)
            touched = true
          }
          emitVaultFailure({sessionId: current.id, origin: current.origin, kind: 'token'})
          continue
        }
        let verified: string | null = null
        try {
          verified = await secure.getToken(current.id, current.origin)
        } catch {
          verified = null
        }
        if (tokens.get(current.id) !== envelopeToken) {
          tokens.set(current.id, envelopeToken)
          touched = true
        }
        if (verified === envelopeToken) {
          scrubBasis.set(current.id, envelopeToken)
        } else {
          emitVaultFailure({sessionId: current.id, origin: current.origin, kind: 'token'})
        }
      } else {
        // Vault entry lost while the envelope is clean: the session cannot
        // authenticate until the user signs in again.
        if (tokens.has(current.id)) {
          tokens.delete(current.id)
          touched = true
        }
        emitVaultFailure({sessionId: current.id, origin: current.origin, kind: 'token'})
      }
    }
    let changed = false
    if (scrubBasis.size > 0) {
      // Final re-read: only rows that still exist AND still carry the
      // envelope token the decision was based on are rewritten, in list
      // order (no resurrection, no reorder, no clobbering a concurrently
      // refreshed token).
      const rows = readSessions()
      const targets = rows.filter(s => s.token && scrubBasis.get(s.id) === s.token)
      if (targets.length > 0) {
        const ids = new Set(targets.map(s => s.id))
        rewriteEnvelopeRows(rows.map(s => (ids.has(s.id) ? sessionWithoutToken(s) : s)))
        changed = true
      }
    }
    if (changed || touched) emit()
  }

  /**
   * Move pre-migration `client_secret`s from `keystone_apps` rows into
   * the vault, then scrub the rows (ADR 0011 step 6). Verified with a
   * read-back; a failed write keeps the MMKV copy and emits. Idempotent.
   */
  async function migrateAppSecrets(secure: SecureTokenVault): Promise<void> {
    const pending = readStoredAppSecrets(storage)
    for (const [origin, secret] of Object.entries(pending)) {
      if (!secret) continue
      let stored = false
      try {
        stored = await secure.setAppSecret(origin, secret)
      } catch {
        stored = false
      }
      if (!stored) {
        try {
          await secure.removeAppSecret(origin)
        } catch {
          // Ignore — the entry is already unusable.
        }
        emitVaultFailure({sessionId: null, origin, kind: 'appSecret'})
        continue
      }
      let verified: string | null = null
      try {
        verified = await secure.getAppSecret(origin)
      } catch {
        verified = null
      }
      if (verified === secret) {
        scrubStoredAppSecrets(storage, [origin])
      } else {
        emitVaultFailure({sessionId: null, origin, kind: 'appSecret'})
      }
    }
  }

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
      const sessions = readSessions().map(attach)
      cached = {
        sessions,
        activeId: resolveActiveId(getActiveSessionId(storage, homeOrigin), readMirror(), sessions),
      }
    }
    return cached
  }

  function emit(): void {
    cached = null
    // Subscription snapshots must change with the store, so drop the
    // cached `scopeHealth` objects too (see `scopeHealthSnapshot`).
    healthSnapshots.clear()
    for (const listener of [...listeners]) listener()
  }

  async function revoke(session: Session): Promise<boolean> {
    // Mastodon revocation needs the app secret: prefer the vault copy
    // (post-migration rows carry no secret), fall back to the MMKV row.
    // A throwing vault must never break local sign-out.
    let vaultSecret: string | null = null
    if (isSecureVault(vault)) {
      try {
        vaultSecret = await vault.getAppSecret(session.origin)
      } catch {
        vaultSecret = null
      }
    }
    const ok = await revokeSessionToken(session, {
      fetchImpl: deps.revokeFetch ?? fetch,
      store: storage,
      ...(vaultSecret ? {appSecret: vaultSecret} : {}),
    })
    // Only Misskey-family failures surface: a Mastodon `false` is the
    // no-cached-app skip (no request was ever sent), silent as before.
    return session.family === 'mastodon' ? true : ok
  }

  /** Drop a session WITHOUT server revoke (dead-token path: revoking with
   * a 401 token is a doomed round-trip; local state still clears).
   * Serialized with `hydrate`/`remove` (S5) and purges every trace (X1.2
   * step 2); D3 applies when the dropped session was active. */
  async function dropLocal(id: string): Promise<void> {
    return serialize(async () => {
      const activeBefore = resolveActiveId(
        getActiveSessionId(storage, homeOrigin),
        readMirror(),
        readSessions(),
      )
      const existing = readSessions().find(s => s.id === id)
      if (!existing) return
      await removeSessionQueries(id)
      removeSession(storage, id, homeOrigin)
      permissionDenied.delete(id)
      tokens.delete(id)
      lastUsed.delete(id)
      try {
        await vault.removeToken(id, existing.origin)
      } catch {
        // Local state clears regardless of vault failure.
      }
      purgeSessionStorage(storage, id)
      purgeSessionMemory(id)
      if (activeBefore === id) fixActiveAfterRemoval()
      else if (readMirror() === id) writeMirror(activeBefore)
      emit()
    })
  }

  /** Uncached scope/permission health for one session id (or the active
   * one). Kept as a closure function so `scopeHealth` stays fresh per call
   * while `scopeHealthSnapshot` can hold one stable object per emit. */
  function computeScopeHealth(target: string | null): SessionScopeHealth {
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
      // 0.8: Misskey has no OAuth scope list stored anywhere — the token
      // carries a permission set chosen at sign-in and the server never
      // returns it. A recorded 403 PERMISSION_DENIED is therefore the
      // only honest upgrade signal: needsUpgrade with an EMPTY
      // missingScopes (no invented scope names) and the prompt "this
      // token predates a permission Keystone now uses". Before any 403
      // the session stays not-applicable.
      if (permissionDenied.has(session.id)) {
        return {
          needsReauth: false,
          needsUpgrade: true,
          generation: 'stale-permissions',
          reason: 'misskey-stale-permissions',
          missingScopes: [],
        }
      }
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
    // Diff against the flavor-expected set only (ADR 0005): `mastodon`
    // sessions expect the umbrella triple, Akkoma/Pleroma/unknown expect
    // SCOPES_NOW. Extra scopes are fine — only missing matters — so a
    // pre-split 26-scope Mastodon token reads `current`, and a token
    // lacking a SCOPES_LATER scope is current too (that feature does not
    // ship yet, ADR 0003).
    const expected = scopesForFlavor(session.flavor)
    const missing = expected.filter(s => !have.has(s))
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
      // Serialized (X1.2): the envelope write and the vault write must not
      // interleave with a concurrent `hydrate` (spurious vault-failure
      // emit) or `signOutEverywhere` (fresh sign-in swallowed).
      return serialize(async () => {
        // A fresh sign-in replaces the credential: any earlier refusal no
        // longer describes this token (same id — id is origin + account).
        permissionDenied.delete(session.id)
        if (isSecureVault(vault)) {
          // Secret-free envelope (ADR 0011): the token lives in the OS vault
          // (+ this run's memory map), never in MMKV.
          saveSession(storage, sessionWithoutToken(session), homeOrigin)
          let stored = false
          try {
            stored = await vault.setToken(session.id, session.origin, session.token)
          } catch {
            stored = false
          }
          if (!stored) {
            // Clear a possibly stale entry so it can never win later; the
            // session stays usable in memory for this run (the failure is
            // surfaced, and next launch asks to sign in again).
            try {
              await vault.removeToken(session.id, session.origin)
            } catch {
              // Ignore — the entry is already unusable.
            }
            tokens.set(session.id, session.token)
            emitVaultFailure({sessionId: session.id, origin: session.origin, kind: 'token'})
          } else {
            tokens.set(session.id, session.token)
          }
        } else {
          // Web / dev vault (D2): the envelope keeps the token copy, as today.
          saveSession(storage, session, homeOrigin)
          await vault.setToken(session.id, session.origin, session.token)
          tokens.set(session.id, session.token)
        }
        setActiveSessionId(storage, session.id, homeOrigin)
        writeMirror(session.id)
        markUsed(session.id)
        emit()
        return session
      })
    },

    switch(id: string): boolean {
      if (!readSessions().some(s => s.id === id)) return false
      setActiveSessionId(storage, id, homeOrigin)
      writeMirror(id)
      markUsed(id)
      emit()
      return true
    },

    async remove(id: string): Promise<boolean> {
      return serialize(async () => {
        const activeBefore = resolveActiveId(
          getActiveSessionId(storage, homeOrigin),
          readMirror(),
          readSessions(),
        )
        const existing = resolveSession(id)
        if (!existing) return true
        const revoked = await revoke(existing)
        // Re-read: a concurrent erase already dropped the row (S5). The
        // chain makes this defense-in-depth — no store op interleaves.
        if (!readSessions().some(s => s.id === id)) return revoked
        await removeSessionQueries(id)
        removeSession(storage, id, homeOrigin)
        permissionDenied.delete(id)
        tokens.delete(id)
        lastUsed.delete(id)
        try {
          await vault.removeToken(id, existing.origin)
        } catch {
          // Local state clears regardless of vault failure.
        }
        purgeSessionStorage(storage, id)
        purgeSessionMemory(id)
        if (activeBefore === id) fixActiveAfterRemoval()
        else if (readMirror() === id) writeMirror(activeBefore)
        emit()
        return revoked
      })
    },

    async signOut(id?: string): Promise<boolean> {
      const target = id ?? store.activeId()
      if (!target) return true
      return store.remove(target)
    },

    async signOutEverywhere(): Promise<boolean> {
      return serialize(async () => {
        const snapshot = readSessions().map(attach)
        const removedIds = new Set(snapshot.map(s => s.id))
        // Parallel revokes with the per-revoke timeout kept (revoke never
        // throws; allSettled is belt-and-braces). Sequential awaits here
        // used to stall a fresh sign-in for 8s per account (S6).
        const outcomes = await Promise.allSettled(snapshot.map(session => revoke(session)))
        const revoked = outcomes.every(r => r.status === 'fulfilled' && r.value)
        // Re-read per id: a session added while revokes were in flight is
        // NOT in the snapshot and survives with its active pointer (S6).
        for (const session of snapshot) {
          if (!readSessions().some(s => s.id === session.id)) continue
          await removeSessionQueries(session.id)
          removeSession(storage, session.id, homeOrigin)
          permissionDenied.delete(session.id)
          tokens.delete(session.id)
          lastUsed.delete(session.id)
          try {
            await vault.removeToken(session.id, session.origin)
          } catch {
            // Local state clears regardless of vault failure.
          }
          purgeSessionStorage(storage, session.id)
          purgeSessionMemory(session.id)
        }
        await clearAllQueries()
        purgeAllPersistedSessions(storage)
        // Clear the active pointer/mirror ONLY when the active id is among
        // the removed ids (S6); D3 applies to whatever remains.
        const remaining = readSessions()
        const resolved = resolveActiveId(
          getActiveSessionId(storage, homeOrigin),
          readMirror(),
          remaining,
        )
        if (!resolved || removedIds.has(resolved)) fixActiveAfterRemoval()
        else if (readMirror() !== resolved) writeMirror(resolved)
        emit()
        return revoked
      })
    },

    async hydrate(): Promise<void> {
      // Serialized with erase paths (S5/S6): a concurrent `remove` can
      // neither resurrect through the writes below nor lose a fresh token
      // to a stale overlay. Two concurrent `hydrate` calls (the provider
      // mounts once per tree; StrictMode remounts) simply run in order —
      // the second sees the first's work and no-ops.
      return serialize(async () => {
        // Boot sweep (repair X1.3 S10): abandoned MiAuth rows never hold
        // tokens (host/scheme/session only) but accumulate forever — drop
        // rows older than 15 minutes before hydrating.
        sweepStaleMisskeyPending(storage)
        // Repair X6.2 step 7: local drafts older than 30 days are dropped
        // at boot (best-effort; expiry is also enforced on every read).
        try {
          for (const s of readSessions()) sweepExpiredDrafts(storage, s.id)
        } catch {
          // A failed sweep never blocks sign-in or hydration.
        }
        if (isSecureVault(vault)) {
          await hydrateSecure(vault)
          await migrateAppSecrets(vault)
          return
        }
        // Web / dev vault (D2): vault-wins overlay, envelope copy stands.
        // Collect overlays first (re-reading per session, skipping rows
        // gone or refreshed under us — S5), then apply in ONE
        // order-preserving rewrite (hydrate never reorders). Each overlay
        // carries the envelope token it was computed from (`seen`, the
        // pre-await snapshot); a row refreshed since keeps its fresh token
        // in both the envelope and the map.
        const overlay = new Map<string, {basis: string; next: string}>()
        let touched = false
        for (const seen of readSessions()) {
          let vaultToken: string | null = null
          try {
            vaultToken = await vault.getToken(seen.id, seen.origin)
          } catch {
            vaultToken = null
          }
          const current = readSessions().find(s => s.id === seen.id) ?? null
          if (!current) {
            if (tokens.has(seen.id)) {
              tokens.delete(seen.id)
              touched = true
            }
            continue
          }
          const refreshed = current.token !== seen.token
          if (!refreshed && vaultToken != null && vaultToken !== '' && vaultToken !== seen.token) {
            overlay.set(current.id, {basis: seen.token, next: vaultToken})
          }
          const live = refreshed ? current.token : vaultToken || current.token
          if (live) {
            if (tokens.get(current.id) !== live) {
              tokens.set(current.id, live)
              touched = true
            }
          } else if (tokens.has(current.id)) {
            tokens.delete(current.id)
            touched = true
          }
        }
        let changed = false
        if (overlay.size > 0) {
          const rows = readSessions()
          const applicable = rows.filter(s => {
            const pending = overlay.get(s.id)
            return pending !== undefined && s.token === pending.basis && s.token !== pending.next
          })
          if (applicable.length > 0) {
            const nextById = new Map<string, string>()
            for (const s of applicable) {
              const pending = overlay.get(s.id)
              if (pending) nextById.set(s.id, pending.next)
            }
            rewriteEnvelopeRows(
              rows.map(s => {
                const next = nextById.get(s.id)
                return next !== undefined ? {...s, token: next} : s
              }),
            )
            changed = true
          }
        }
        if (changed || touched) emit()
      })
    },

    onSessionVaultFailed(listener: (failure: VaultFailure) => void): () => void {
      vaultListeners.add(listener)
      return () => {
        vaultListeners.delete(listener)
      }
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
      // Single-flight (repair X1.5): concurrent 401s for one session
      // share a single `me()` instead of each dropping independently.
      const shared = verifyInFlight.get(id)
      if (shared) return shared
      const work: Promise<SessionVerifyResult> = (async (): Promise<SessionVerifyResult> => {
        const session = resolveSession(id)
        if (!session) return {ok: false, reason: 'unknown-session', cleared: false}
        // Cool-down (repair X1.5): a verify that just ran for this live
        // token is reused for 30 s instead of hitting the server again.
        // The token qualifies the entry — a re-added session (new token)
        // always verifies fresh.
        const cooled = verifyCooldown.get(id)
        if (cooled && cooled.token === session.token && Date.now() < cooled.until) {
          return cooled.result
        }
        let backend: ReturnType<typeof backendForSession>
        try {
          backend = backendForSession(session)
        } catch {
          return {ok: false, reason: 'error', cleared: false}
        }
        const remember = (result: SessionVerifyResult): SessionVerifyResult => {
          verifyCooldown.set(id, {until: Date.now() + VERIFY_COOLDOWN_MS, token: session.token, result})
          return result
        }
        try {
          await backend.me()
          return remember({ok: true, reason: 'ok', cleared: false})
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            // The second 401 (the trigger already 401'd): the token is
            // dead, so drop the session through the X1.2 purge path.
            verifyCooldown.delete(id)
            await dropLocal(id)
            return {ok: false, reason: 'unauthorized', cleared: true}
          }
          if (err instanceof ApiError && err.status === 403) {
            // Scope/permission failure: the token may still be valid for its
            // old surface — never clear, surface `forbidden` + `scopeHealth`.
            return remember({ok: false, reason: 'forbidden', cleared: false})
          }
          if (isNetworkFailure(err)) return remember({ok: false, reason: 'network', cleared: false})
          return remember({ok: false, reason: 'error', cleared: false})
        }
      })()
      verifyInFlight.set(id, work)
      try {
        return await work
      } finally {
        if (verifyInFlight.get(id) === work) verifyInFlight.delete(id)
      }
    },

    async verifyActive(): Promise<SessionVerifyResult> {
      const id = snapshot().activeId
      if (!id) return {ok: false, reason: 'signed-out', cleared: false}
      // Boot cap (repair X3.5): a stalled `me()` must never leave a blank
      // app. Fail open as `network` after 8 s — the session is kept, and a
      // timeout never drops it. (X1.5 owns `verifySession`; this only bounds
      // the boot call.)
      const timeout: SessionVerifyResult = {ok: false, reason: 'network', cleared: false}
      let timer: ReturnType<typeof setTimeout> | undefined
      const cap = new Promise<SessionVerifyResult>(resolve => {
        timer = setTimeout(() => resolve(timeout), VERIFY_ACTIVE_TIMEOUT_MS)
      })
      try {
        return await Promise.race([store.verifySession(id), cap])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
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
      return computeScopeHealth(id ?? snapshot().activeId)
    },

    scopeHealthSnapshot(id: string): SessionScopeHealth {
      // `useSyncExternalStore` requires a referentially stable snapshot;
      // `scopeHealth` builds a fresh object per call. Cache one object per
      // session until the next `emit()` (sign-in/out, switch, permission
      // denial), then recompute. Do not mutate the returned object.
      const existing = healthSnapshots.get(id)
      if (existing) return existing
      const next = computeScopeHealth(id)
      healthSnapshots.set(id, next)
      return next
    },

    notePermissionDenied(id: string): void {
      const session = readSessions().find(s => s.id === id)
      if (!session) return
      // Mastodon keeps ADR 0003's cached-scope diff. A 403 there can also
      // be a per-action refusal (e.g. blocked target), so it must not
      // masquerade as a stale-scope verdict.
      if (session.family === 'mastodon') return
      if (permissionDenied.has(id)) return
      permissionDenied.add(id)
      emit()
    },
  }

  return store
}
