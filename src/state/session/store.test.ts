import {
  createMastodonClient,
  createMemoryStore,
  createMisskeyClient,
  getActiveSessionId,
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
