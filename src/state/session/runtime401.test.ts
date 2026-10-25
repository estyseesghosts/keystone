// Runtime 401 store tests (repair X1.5, sessions-cache 4).
//
// Fail-before / pass-after (fail on the old code, which verified every
// time with no sharing):
// - concurrent `verifySession` calls for one session share a single `me()`
//   (single-flight) — before: one `me()` per caller (both the ok and the
//   401-drop variants).
// - a verify that just ran is reused for 30 s (cool-down) — before: every
//   call hits the network.
// Pinning (unchanged behaviour, passes before and after):
// - the cool-down expires after 30 s (a later verify hits `me()` again)
//   and is qualified by token (re-adding with a new token verifies fresh).
// - 5xx never drops; switching sessions performs no verification on its
//   own (inactive sessions verify lazily, on their next failure).

import {createMemoryStore, type KeyValueStore} from '@keystone/fedi'

import {type TokenVault} from '#/storage'

import {createSessionStore, type NewSessionInput} from './store'

const HOME_ORIGIN = 'https://app.example'
const ORIGIN_A = 'https://a.example'
const ORIGIN_B = 'https://b.example'

function stubVault(initial: Record<string, string> = {}): {vault: TokenVault; map: Map<string, string>} {
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

const mePayload = {id: 'alice', username: 'alice', isBot: false, isCat: false}

function setup() {
  const storage: KeyValueStore = createMemoryStore()
  const {vault} = stubVault()
  const fetchMock = jest.fn(
    () => Promise.resolve(new Response(JSON.stringify(mePayload), {status: 200})),
  ) as unknown as jest.Mock
  globalThis.fetch = fetchMock as unknown as typeof fetch
  const store = createSessionStore({storage, vault, homeOrigin: HOME_ORIGIN})
  return {storage, store, fetchMock}
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  jest.restoreAllMocks()
})

function stubMe(fetchMock: jest.Mock, status: number, body: unknown = {}): void {
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), {status})),
  )
}

describe('verifySession single-flight (concurrent 401s verify once)', () => {
  it('two concurrent verifies share one me()', async () => {
    const {store, fetchMock} = setup()
    const a = await store.add(sessionA())
    const p1 = store.verifySession(a.id)
    const p2 = store.verifySession(a.id)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual({ok: true, reason: 'ok', cleared: false})
    expect(r2).toEqual({ok: true, reason: 'ok', cleared: false})
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('two concurrent 401 verifies share one me() and drop once', async () => {
    const {store, fetchMock} = setup()
    const a = await store.add(sessionA())
    stubMe(fetchMock, 401, {error: {message: 'unauthorized', code: 'AUTHENTICATION_FAILED'}})
    const p1 = store.verifySession(a.id)
    const p2 = store.verifySession(a.id)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual({ok: false, reason: 'unauthorized', cleared: true})
    expect(r2).toEqual({ok: false, reason: 'unauthorized', cleared: true})
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.list()).toHaveLength(0)
  })
})

describe('verifySession cool-down (30 s per live token)', () => {
  it('a verify that just ran is reused instead of re-hitting me()', async () => {
    const {store, fetchMock} = setup()
    const a = await store.add(sessionA())
    await expect(store.verifySession(a.id)).resolves.toEqual({
      ok: true,
      reason: 'ok',
      cleared: false,
    })
    await expect(store.verifySession(a.id)).resolves.toEqual({
      ok: true,
      reason: 'ok',
      cleared: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('the cool-down expires after 30 s', async () => {
    const {store, fetchMock} = setup()
    const a = await store.add(sessionA())
    await expect(store.verifySession(a.id)).resolves.toEqual({
      ok: true,
      reason: 'ok',
      cleared: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const now = Date.now()
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now + 31_000)
    try {
      await expect(store.verifySession(a.id)).resolves.toEqual({
        ok: true,
        reason: 'ok',
        cleared: false,
      })
    } finally {
      spy.mockRestore()
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('re-adding with a new token verifies fresh (cool-down is token-qualified)', async () => {
    const {store, fetchMock} = setup()
    const a = await store.add(sessionA())
    await expect(store.verifySession(a.id)).resolves.toEqual({
      ok: true,
      reason: 'ok',
      cleared: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const again = await store.add({...sessionA(), token: 'token-a-new'})
    expect(again.id).toBe(a.id)
    await expect(store.verifySession(again.id)).resolves.toEqual({
      ok: true,
      reason: 'ok',
      cleared: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('verifySession never-drops (pinning)', () => {
  it('5xx never drops', async () => {
    const {store, fetchMock} = setup()
    const a = await store.add(sessionA())
    stubMe(fetchMock, 500, {error: {message: 'boom', code: 'INTERNAL_ERROR'}})
    await expect(store.verifySession(a.id)).resolves.toEqual({
      ok: false,
      reason: 'error',
      cleared: false,
    })
    expect(store.list().map(s => s.id)).toEqual([a.id])
  })

  it('switching sessions performs no verification on its own (lazy)', async () => {
    const {store, fetchMock} = setup()
    await store.add(sessionA())
    await store.add(sessionB())
    fetchMock.mockClear()
    expect(store.switch(`${ORIGIN_A} alice`)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.list()).toHaveLength(2)
  })
})
