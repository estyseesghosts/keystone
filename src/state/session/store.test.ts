import {
  createMastodonClient,
  createMemoryStore,
  createMisskeyClient,
  getActiveSessionId,
  SCOPES_LATER,
  SCOPES_NOW,
  OAUTH_APPS_KEY,
  setActiveSessionId,
  type KeyValueStore,
} from '@keystone/fedi'

import {readDeviceState, type TokenVault} from '#/storage'

import {createSessionStore, resolveActiveId, type NewSessionInput} from './store'

const HOME_ORIGIN = 'https://app.example'
const ORIGIN_A = 'https://a.example'
const ORIGIN_B = 'https://b.example'

function stubVault(initial: Record<string, string> = {}): {
  vault: TokenVault
  map: Map<string, string>
} {
  const map = new Map<string, string>(Object.entries(initial))
  const key = (id: string, origin: string) => `${origin} ${id}`
  return {
    map,
    vault: {
      getToken: (id, origin) => Promise.resolve(map.get(key(id, origin)) ?? null),
      setToken: (id, origin, token) => {
        map.set(key(id, origin), token)
        return Promise.resolve()
      },
      removeToken: (id, origin) => {
        map.delete(key(id, origin))
        return Promise.resolve()
      },
    },
  }
}

function stubRevoke() {
  const calls: Array<{url: string; init: RequestInit}> = []
  const fetchImpl = jest.fn((url: string, init?: RequestInit) => {
    calls.push({url, init: init ?? {}})
    return Promise.resolve(new Response('{}', {status: 200}))
  }) as unknown as typeof fetch
  return {calls, fetchImpl}
}

const sessionA = (over: Partial<NewSessionInput> = {}): NewSessionInput => ({
  origin: ORIGIN_A,
  family: 'misskey',
  flavor: 'misskey',
  accountId: 'alice',
  token: 'token-a',
  grant: 'password',
  hosting: 'third-party',
  ...over,
})

const sessionB = (over: Partial<NewSessionInput> = {}): NewSessionInput => ({
  origin: ORIGIN_B,
  family: 'misskey',
  flavor: 'sharkey',
  accountId: 'bob',
  token: 'token-b',
  grant: 'miauth',
  hosting: 'third-party',
  ...over,
})

function setup() {
  const storage: KeyValueStore = createMemoryStore()
  const {vault, map} = stubVault()
  const {calls, fetchImpl} = stubRevoke()
  const store = createSessionStore({storage, vault, homeOrigin: HOME_ORIGIN, revokeFetch: fetchImpl})
  return {storage, vault, map, calls, store}
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('add / switch / active', () => {
  it('add persists the envelope, the vault, and activates', async () => {
    const {storage, map, store} = setup()
    const session = await store.add(sessionA())
    expect(session.id).toBe(`${ORIGIN_A} alice`)
    expect(store.list()).toHaveLength(1)
    expect(store.activeId()).toBe(session.id)
    expect(store.active()?.token).toBe('token-a')
    // Envelope copy (sync seam) + vault copy (async layer above it).
    expect(storage.getItem('keystone_sessions')).toContain('token-a')
    expect(map.get(`${ORIGIN_A} ${session.id}`)).toBe('token-a')
    // Device mirror follows the switch.
    expect(readDeviceState(storage).activeSessionId).toBe(session.id)
  })

  it('switch moves the active session; unknown ids never activate ghosts', async () => {
    const {store} = setup()
    const a = await store.add(sessionA())
    const b = await store.add(sessionB())
    expect(store.activeId()).toBe(b.id)
    expect(store.switch(a.id)).toBe(true)
    expect(store.activeId()).toBe(a.id)
    expect(store.switch('https://gone.example ghost')).toBe(false)
    expect(store.activeId()).toBe(a.id)
  })

  it('add persists detection evidence with the session (W1/S1)', async () => {
    const {store} = setup()
    const session = await store.add(
      sessionA({evidence: {translatorAvailable: true, version: '2026.10.1-alpha.0'}}),
    )
    expect(session.evidence).toEqual({translatorAvailable: true, version: '2026.10.1-alpha.0'})
    expect(store.active()?.evidence).toEqual({translatorAvailable: true, version: '2026.10.1-alpha.0'})
  })

  it('switching accounts never shows the previous account data', async () => {
    const {store} = setup()
    await store.add(sessionA())
    const b = await store.add(sessionB())
    expect(store.active()).toMatchObject({id: b.id, origin: ORIGIN_B, token: 'token-b'})
    expect(store.active()?.origin).not.toBe(ORIGIN_A)
    expect(store.active()?.token).not.toBe('token-a')
  })
})

describe('remove / sign-out', () => {
  it('remove revokes at the session origin, then drops envelope + vault', async () => {
    const {storage, map, calls, store} = setup()
    const a = await store.add(sessionA())
    await store.add(sessionB())
    await store.remove(a.id)
    // Revoke went to A's origin carrying A's token — and only there.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${ORIGIN_A}/api/i/revoke-token`)
    expect(JSON.parse(String(calls[0].init.body))).toEqual({i: 'token-a'})
    expect(store.list().map(s => s.id)).not.toContain(a.id)
    expect(map.has(`${ORIGIN_A} ${a.id}`)).toBe(false)
    expect(storage.getItem('keystone_sessions')).not.toContain('token-a')
  })

  it('removing the active session clears the pointer and mirror', async () => {
    const {storage, store} = setup()
    const a = await store.add(sessionA())
    await store.remove(a.id)
    expect(store.activeId()).toBeNull()
    expect(store.active()).toBeNull()
    expect(readDeviceState(storage).activeSessionId).toBeNull()
  })

  it('removing an unknown id is a no-op (never revokes)', async () => {
    const {calls, store} = setup()
    await store.add(sessionA())
    await store.remove('https://gone.example ghost')
    expect(calls).toHaveLength(0)
    expect(store.list()).toHaveLength(1)
  })

  it('signOut defaults to the active session', async () => {
    const {store} = setup()
    await store.add(sessionA())
    const b = await store.add(sessionB())
    expect(store.activeId()).toBe(b.id)
    await store.signOut()
    expect(store.list().map(s => s.id)).toEqual([`${ORIGIN_A} alice`])
    expect(store.activeId()).toBeNull()
  })

  it('signOutEverywhere revokes each session and empties the store', async () => {
    const {storage, map, calls, store} = setup()
    await store.add(sessionA())
    await store.add(sessionB())
    await store.signOutEverywhere()
    expect(calls).toHaveLength(2)
    expect(calls.map(c => c.url).sort()).toEqual(
      [`${ORIGIN_A}/api/i/revoke-token`, `${ORIGIN_B}/api/i/revoke-token`].sort(),
    )
    expect(store.list()).toHaveLength(0)
    expect(store.activeId()).toBeNull()
    expect(map.size).toBe(0)
    expect(readDeviceState(storage).activeSessionId).toBeNull()
  })
})

describe('hydrate (vault wins)', () => {
  it('a vault token overwrites a stale envelope copy', async () => {
    const storage: KeyValueStore = createMemoryStore()
    const {vault} = stubVault({[`${ORIGIN_A} ${ORIGIN_A} alice`]: 'vault-fresh'})
    const store = createSessionStore({storage, vault, homeOrigin: HOME_ORIGIN})
    await store.add(sessionA()) // envelope + vault now hold token-a…
    await vault.setToken(`${ORIGIN_A} alice`, ORIGIN_A, 'vault-fresh') // …vault rotates
    await store.hydrate()
    expect(store.list()[0].token).toBe('vault-fresh')
  })

  it('a missing vault value keeps the envelope copy', async () => {
    const {store} = setup()
    await store.add(sessionA())
    await store.hydrate()
    expect(store.list()[0].token).toBe('token-a')
  })
})

describe('resolveActiveId', () => {
  const sessions = [
    {...sessionA(), id: `${ORIGIN_A} alice`},
    {...sessionB(), id: `${ORIGIN_B} bob`},
  ]

  it('prefers the envelope pointer', () => {
    expect(resolveActiveId(`${ORIGIN_A} alice`, `${ORIGIN_B} bob`, sessions)).toBe(
      `${ORIGIN_A} alice`,
    )
  })

  it('falls back to the mirror when the envelope pointer is missing', () => {
    expect(resolveActiveId(null, `${ORIGIN_B} bob`, sessions)).toBe(`${ORIGIN_B} bob`)
  })

  it('ignores stale pointers instead of resolving ghosts', () => {
    expect(resolveActiveId('https://gone.example ghost', null, sessions)).toBeNull()
    expect(resolveActiveId(null, 'https://gone.example ghost', sessions)).toBeNull()
  })
})

describe('initialize (boot mirror recovery)', () => {
  it('adopts the mirror when the envelope pointer is missing', async () => {
    const {storage, store} = setup()
    await store.add(sessionA())
    const id = store.activeId()
    // Simulate an envelope that lost its pointer (mirror intact).
    setActiveSessionId(storage, null, HOME_ORIGIN)
    store.refresh()
    expect(store.activeId()).toBe(id) // mirror fallback reads through
    store.initialize() // …and persists back into the envelope
    expect(getActiveSessionId(storage, HOME_ORIGIN)).toBe(id)
  })
})

describe('cross-origin token isolation (store level)', () => {
  it("A's requests never carry B's token or origin and vice versa", async () => {
    const {store} = setup()
    await store.add(sessionA())
    await store.add(sessionB())
    const [b, a] = store.list()
    expect(a.origin).toBe(ORIGIN_A)
    expect(b.origin).toBe(ORIGIN_B)

    const calls: Array<{url: string; init: RequestInit}> = []
    globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
      calls.push({url, init: init ?? {}})
      return Promise.resolve(new Response('{}', {status: 200}))
    }) as unknown as typeof fetch

    await createMisskeyClient(a).call('i', {})
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${ORIGIN_A}/api/i`)
    const bodyA = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(bodyA.i).toBe('token-a')
    expect(String(calls[0].init.body)).not.toContain('token-b')
    expect(calls[0].url).not.toContain(ORIGIN_B)

    calls.length = 0
    await createMisskeyClient(b).call('i', {})
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${ORIGIN_B}/api/i`)
    const bodyB = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(bodyB.i).toBe('token-b')
    expect(String(calls[0].init.body)).not.toContain('token-a')
    expect(calls[0].url).not.toContain(ORIGIN_A)
  })

  it('a Mastodon session Bearers only its own origin', async () => {
    const {store} = setup()
    await store.add(sessionA())
    await store.add({
      origin: ORIGIN_B,
      family: 'mastodon',
      flavor: 'mastodon',
      accountId: 'bob',
      token: 'masto-b',
      grant: 'oauth-pkce',
      hosting: 'third-party',
    })
    const masto = store.list().find(s => s.family === 'mastodon')
    expect(masto).toBeTruthy()

    const calls: Array<{url: string; init: RequestInit}> = []
    globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
      calls.push({url, init: init ?? {}})
      return Promise.resolve(new Response('{}', {status: 200}))
    }) as unknown as typeof fetch

    await createMastodonClient(masto!.origin, masto!.token).post('/api/v1/accounts', {})
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${ORIGIN_B}/api/v1/accounts`)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer masto-b')
    expect(calls[0].url).not.toContain(ORIGIN_A)
  })
})

describe('verifySession / verifyActive (MD5 boot re-verify)', () => {
  const mePayload = {id: 'alice', username: 'alice', isBot: false, isCat: false}

  function stubMe(status: number, body: unknown = {}): void {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), {status})),
    ) as unknown as typeof fetch
  }

  it('signed out verifies as signed-out (never an error)', async () => {
    const {store} = setup()
    await expect(store.verifyActive()).resolves.toEqual({
      ok: false,
      reason: 'signed-out',
      cleared: false,
    })
  })

  it('unknown ids never resolve', async () => {
    const {store} = setup()
    await store.add(sessionA())
    await expect(store.verifySession('https://gone.example ghost')).resolves.toEqual({
      ok: false,
      reason: 'unknown-session',
      cleared: false,
    })
  })

  it('a live token verifies ok and stays stored', async () => {
    const {store} = setup()
    const a = await store.add(sessionA())
    stubMe(200, mePayload)
    await expect(store.verifyActive()).resolves.toEqual({ok: true, reason: 'ok', cleared: false})
    expect(store.list().map(s => s.id)).toEqual([a.id])
    expect(store.activeId()).toBe(a.id)
  })

  it('401 drops the dead session (clear on 401) and nothing else', async () => {
    const {storage, map, store} = setup()
    const a = await store.add(sessionA())
    const b = await store.add(sessionB())
    stubMe(401, {error: {message: 'unauthorized', code: 'AUTHENTICATION_FAILED'}})
    await expect(store.verifySession(a.id)).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
      cleared: true,
    })
    expect(store.list().map(s => s.id)).toEqual([b.id])
    expect(map.has(`${ORIGIN_A} ${a.id}`)).toBe(false)
    expect(storage.getItem('keystone_sessions')).not.toContain('token-a')
  })

  it('401 on the active session clears the pointer and mirror', async () => {
    const {storage, store} = setup()
    await store.add(sessionA())
    stubMe(401, {error: {message: 'unauthorized', code: 'AUTHENTICATION_FAILED'}})
    await expect(store.verifyActive()).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
      cleared: true,
    })
    expect(store.activeId()).toBeNull()
    expect(readDeviceState(storage).activeSessionId).toBeNull()
  })

  it('403 never clears (scope failure, not a dead token)', async () => {
    const {store} = setup()
    const a = await store.add(sessionA())
    stubMe(403, {error: {message: 'forbidden', code: 'PERMISSION_DENIED'}})
    await expect(store.verifyActive()).resolves.toEqual({
      ok: false,
      reason: 'forbidden',
      cleared: false,
    })
    expect(store.list().map(s => s.id)).toEqual([a.id])
  })

  it('network failure never clears', async () => {
    const {store} = setup()
    const a = await store.add(sessionA())
    globalThis.fetch = jest.fn(() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch
    await expect(store.verifyActive()).resolves.toEqual({
      ok: false,
      reason: 'network',
      cleared: false,
    })
    expect(store.list().map(s => s.id)).toEqual([a.id])
  })
})

describe('refreshActive (MD5 honest no-op)', () => {
  it('signed out reports signed-out', async () => {
    const {store} = setup()
    await expect(store.refreshActive()).resolves.toEqual({refreshed: false, reason: 'signed-out'})
  })

  it('a stored session reports unsupported (no refresh token persisted)', async () => {
    const {store} = setup()
    await store.add(sessionA())
    await expect(store.refreshActive()).resolves.toEqual({refreshed: false, reason: 'unsupported'})
  })
})

describe('scopeHealth (MD5 scope generations)', () => {
  const mastoInput = (over: Record<string, unknown> = {}) => ({
    origin: ORIGIN_B,
    family: 'mastodon' as const,
    flavor: 'mastodon' as const,
    accountId: 'bob',
    token: 'masto-b',
    grant: 'oauth-pkce' as const,
    hosting: 'third-party' as const,
    ...over,
  })

  function cacheScopes(storage: KeyValueStore, origin: string, scopes: string): void {
    storage.setItem(
      OAUTH_APPS_KEY,
      JSON.stringify({[origin]: {client_id: 'id', client_secret: 'secret', scopes}}),
    )
  }

  it('signed out reports signed-out', async () => {
    const {store} = setup()
    expect(store.scopeHealth()).toMatchObject({needsReauth: false, needsUpgrade: false, generation: 'signed-out'})
  })

  it('misskey-family sessions carry no OAuth scopes', async () => {
    const {store} = setup()
    await store.add(sessionA())
    expect(store.scopeHealth()).toMatchObject({
      needsReauth: false,
      needsUpgrade: false,
      generation: 'not-applicable',
      reason: 'misskey-no-scopes',
      missingScopes: [],
    })
  })

  // 0.8 — Misskey has no OAuth scope diff to run: its app tokens carry a
  // permission set. The honest signal is a live 403 PERMISSION_DENIED,
  // recorded per session by the app layer. Before that signal the old
  // `misskey-no-scopes` answer stands; after it the session MUST report
  // `needsUpgrade` with an empty `missingScopes` (the server never returned
  // a scope list, so none may be invented).
  it('a Misskey permission denial marks the session for upgrade, with no invented scopes', async () => {
    const {store} = setup()
    const a = await store.add(sessionA())
    store.notePermissionDenied(a.id)
    expect(store.scopeHealth()).toEqual({
      needsReauth: false,
      needsUpgrade: true,
      generation: 'stale-permissions',
      reason: 'misskey-stale-permissions',
      missingScopes: [],
    })
    // The old unconditional answer would fail this assertion.
    expect(store.scopeHealth()).not.toMatchObject({
      needsUpgrade: false,
      reason: 'misskey-no-scopes',
    })
  })

  it('the upgrade marker is per session, not per store', async () => {
    const {store} = setup()
    const a = await store.add(sessionA())
    const b = await store.add(sessionB())
    store.notePermissionDenied(a.id)
    expect(store.scopeHealth(a.id).needsUpgrade).toBe(true)
    expect(store.scopeHealth(b.id)).toMatchObject({
      needsUpgrade: false,
      generation: 'not-applicable',
      reason: 'misskey-no-scopes',
    })
    // Active session is B; the banner reads B and stays quiet.
    expect(store.scopeHealth()).toMatchObject({needsUpgrade: false})
    store.switch(a.id)
    expect(store.scopeHealth().needsUpgrade).toBe(true)
  })

  it('signing in again clears the marker for that session', async () => {
    const {store} = setup()
    const a = await store.add(sessionA())
    store.notePermissionDenied(a.id)
    expect(store.scopeHealth(a.id).needsUpgrade).toBe(true)
    // Same origin + account id → same session id, fresh token (re-auth).
    const again = await store.add({...sessionA(), token: 'token-a-new'})
    expect(again.id).toBe(a.id)
    expect(store.scopeHealth(a.id).needsUpgrade).toBe(false)
    expect(store.scopeHealth(a.id).reason).toBe('misskey-no-scopes')
  })

  it('marking an unknown or signed-out session is a no-op', () => {
    const {store} = setup()
    store.notePermissionDenied('https://gone.example nobody')
    expect(store.scopeHealth('https://gone.example nobody')).toMatchObject({
      reason: 'unknown-session',
      needsUpgrade: false,
    })
  })

  it('mastodon without an app cache is unknown (never a verdict)', async () => {
    const {store} = setup()
    await store.add(mastoInput())
    expect(store.scopeHealth()).toMatchObject({
      needsReauth: false,
      needsUpgrade: false,
      generation: 'unknown',
      reason: 'no-app-cache',
    })
  })

  it('current scopes verify clean', async () => {
    const {storage, store} = setup()
    const b = await store.add(mastoInput())
    cacheScopes(storage, ORIGIN_B, SCOPES_NOW.join(' '))
    expect(store.scopeHealth()).toEqual({
      needsReauth: false,
      needsUpgrade: false,
      generation: 'current',
      reason: 'current',
      missingScopes: [],
    })
    expect(store.scopeHealth(b.id).generation).toBe('current')
  })

  it('NOW scopes plus LATER scopes still reads current, missing LATER never upgrades', async () => {
    const {storage, store} = setup()
    await store.add(mastoInput())
    // A token that already carries the whole NOW set (plus, say, a LATER
    // DMs scope) is current: LATER features are not shipped (ADR 0003).
    cacheScopes(storage, ORIGIN_B, [...SCOPES_NOW, 'read:conversations'].join(' '))
    expect(store.scopeHealth()).toEqual({
      needsReauth: false,
      needsUpgrade: false,
      generation: 'current',
      reason: 'current',
      missingScopes: [],
    })
  })

  it('missing LATER scopes alone never trigger needsUpgrade', async () => {
    const {storage, store} = setup()
    await store.add(mastoInput())
    cacheScopes(storage, ORIGIN_B, SCOPES_NOW.join(' '))
    const health = store.scopeHealth()
    expect(health.needsUpgrade).toBe(false)
    // No LATER-only scope (push, admin:read, conversations…) is ever
    // demanded from an adequate token. write:reports moved into NOW with
    // the report chooser (clickstone §1.5).
    for (const later of SCOPES_LATER) expect(health.missingScopes).not.toContain(later)
    expect(SCOPES_LATER.length).toBeGreaterThan(0)
  })

  it('write:reports is a NOW scope: a current token has it, an old one upgrades', async () => {
    const {storage, store} = setup()
    await store.add(mastoInput())
    // Current token: the cached app carries the whole NOW set, including
    // the report scope shipped in clickstone §1.5.
    expect(SCOPES_NOW).toContain('write:reports')
    expect(SCOPES_LATER).not.toContain('write:reports')
    cacheScopes(storage, ORIGIN_B, SCOPES_NOW.join(' '))
    expect(store.scopeHealth()).toEqual({
      needsReauth: false,
      needsUpgrade: false,
      generation: 'current',
      reason: 'current',
      missingScopes: [],
    })
    // A token minted before the slice lacks the scope; ADR 0003 follow-up
    // (b) says that is the intended upgrade prompt, not a special case.
    cacheScopes(
      storage,
      ORIGIN_B,
      SCOPES_NOW.filter(s => s !== 'write:reports').join(' '),
    )
    const old = store.scopeHealth()
    expect(old.needsUpgrade).toBe(true)
    expect(old.reason).toBe('stale-scopes')
    expect(old.missingScopes).toEqual(['write:reports'])
  })

  it('a token missing exactly one NOW scope reports exactly that scope', async () => {
    const {storage, store} = setup()
    await store.add(mastoInput())
    const withoutFilters = SCOPES_NOW.filter(s => s !== 'write:filters')
    cacheScopes(storage, ORIGIN_B, withoutFilters.join(' '))
    expect(store.scopeHealth()).toEqual({
      needsReauth: false,
      needsUpgrade: true,
      generation: 'granular',
      reason: 'stale-scopes',
      missingScopes: ['write:filters'],
    })
  })

  it('granular-only cache reads as the W4 generation with missing umbrellas', async () => {
    const {storage, store} = setup()
    await store.add(mastoInput())
    const granular = SCOPES_NOW.filter(s => s !== 'read' && s !== 'write' && s !== 'follow')
    cacheScopes(storage, ORIGIN_B, granular.join(' '))
    expect(store.scopeHealth()).toEqual({
      needsReauth: false,
      needsUpgrade: true,
      generation: 'granular',
      reason: 'stale-scopes',
      missingScopes: ['read', 'write', 'follow'],
    })
  })

  it('umbrella-only cache reads as the pre-scopes generation', async () => {
    const {storage, store} = setup()
    await store.add(mastoInput())
    cacheScopes(storage, ORIGIN_B, 'read write follow')
    const health = store.scopeHealth()
    expect(health.generation).toBe('pre-scopes')
    expect(health.needsUpgrade).toBe(true)
    expect(health.needsReauth).toBe(false)
    expect(health.missingScopes).toContain('read:accounts')
    // Every missing entry is a NOW scope; LATER scopes are never demanded.
    expect(health.missingScopes).toEqual(
      SCOPES_NOW.filter(s => s !== 'read' && s !== 'write' && s !== 'follow'),
    )
  })
})

describe('MK7 legacy migration at boot (W8)', () => {
  it('initialize() surfaces sessions migrated from legacy keys', () => {
    const storage = createMemoryStore({
      keystone_token_misskey: 'legacy-token',
    })
    const {vault} = stubVault()
    const store = createSessionStore({storage, vault, homeOrigin: HOME_ORIGIN})
    store.initialize()
    const sessions = store.list()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].token).toBe('legacy-token')
    expect(sessions[0].family).toBe('misskey')
  })
})
