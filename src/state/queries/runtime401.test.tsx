// Runtime 401 cache tests (repair X1.5, sessions-cache 4).
//
// Every fix ships a test that fails before the fix and passes after:
// before this slice `createAppQueryClient` installed no `QueryCache` /
// `MutationCache` `onError` at all, so `verifySession` was never called
// from the cache layer — every "routes" test below fails on the old
// code. Pinning: 403/network/5xx/`signed-out`/unknown/key-less never
// route (they must never drop a session).

import {useQuery} from '@tanstack/react-query'
import {render, waitFor} from '@testing-library/react-native'

import {ApiError, createMemoryStore, type Session} from '@keystone/fedi'

import {clearToasts, toastStore} from '#/lib/toast'
import {navigationRef} from '#/navigationRef'
import {SessionProvider} from '#/state/session/SessionProvider'
import {createSessionStore} from '#/state/session/store'
import type {TokenVault} from '#/storage'

import {
  createAppQueryClient,
  createQueryPersister,
  isRuntime401,
  QueryProvider,
  sessionIdFromKey,
} from './Provider'

const HOME_ORIGIN = 'https://app.example'
const ORIGIN_A = 'https://a.example'
const ORIGIN_B = 'https://b.example'

const SID_A = `${ORIGIN_A} alice`
const SID_B = `${ORIGIN_B} bob`

function memVault(): TokenVault {
  const map = new Map<string, string>()
  const key = (id: string, origin: string) => `${origin} ${id}`
  return {
    getToken: (id, origin) => Promise.resolve(map.get(key(id, origin)) ?? null),
    setToken: (id, origin, token) => {
      map.set(key(id, origin), token)
      return Promise.resolve()
    },
    removeToken: (id, origin) => {
      map.delete(key(id, origin))
      return Promise.resolve()
    },
  }
}

const sessionStub = (id: string, accountId: string): Session =>
  ({id, accountId}) as unknown as Session

function stubRuntime(sessions: Session[], cleared = false) {
  return {
    verifySession: jest.fn(async (_id: string) => ({cleared})),
    list: jest.fn(() => sessions),
  }
}

const boom401 = async (): Promise<never> => {
  throw new ApiError('gone', 401)
}

const realFetch = globalThis.fetch

beforeEach(() => {
  clearToasts()
})

afterEach(() => {
  globalThis.fetch = realFetch
  jest.restoreAllMocks()
})

describe('sessionIdFromKey', () => {
  it('takes the sessionId-first head', () => {
    expect(sessionIdFromKey([SID_A, 'post-feed', 'timeline|home'])).toBe(SID_A)
    expect(sessionIdFromKey([SID_A, 'me'])).toBe(SID_A)
  })
  it('ignores signed-out, empty, and non-string heads', () => {
    expect(sessionIdFromKey(['signed-out', 'post-feed'])).toBeNull()
    expect(sessionIdFromKey(['me', 'signed-out'])).toBe('me')
    expect(sessionIdFromKey([])).toBeNull()
    expect(sessionIdFromKey(undefined)).toBeNull()
    expect(sessionIdFromKey([42, 'x'])).toBeNull()
    expect(sessionIdFromKey(['', 'x'])).toBeNull()
  })
})

describe('isRuntime401', () => {
  it('is true only for ApiError 401', () => {
    expect(isRuntime401(new ApiError('gone', 401))).toBe(true)
    expect(isRuntime401(new ApiError('denied', 403))).toBe(false)
    expect(isRuntime401(new ApiError('boom', 500))).toBe(false)
    expect(isRuntime401(new ApiError('offline', 0))).toBe(false)
    expect(isRuntime401(new Error('gone'))).toBe(false)
    expect(isRuntime401({status: 401})).toBe(false)
    expect(isRuntime401(null)).toBe(false)
  })
})

describe('QueryCache onError routing', () => {
  it('a 401 for a known session calls verifySession with the key id', async () => {
    const rt = stubRuntime([sessionStub(SID_A, 'alice')])
    const client = createAppQueryClient(rt)
    await expect(
      client.fetchQuery({
        queryKey: [SID_A, 'post-feed', 'timeline|home'],
        queryFn: boom401,
        retry: false,
      }),
    ).rejects.toMatchObject({status: 401})
    await waitFor(() => expect(rt.verifySession).toHaveBeenCalledWith(SID_A))
    expect(rt.verifySession).toHaveBeenCalledTimes(1)
  })

  it('concurrent 401s for one session verify once', async () => {
    const rt = stubRuntime([sessionStub(SID_A, 'alice')])
    const client = createAppQueryClient(rt)
    const opts = (kind: string) => ({
      queryKey: [SID_A, kind],
      queryFn: boom401,
      retry: false,
    })
    await Promise.allSettled([client.fetchQuery(opts('a')), client.fetchQuery(opts('b'))])
    await waitFor(() => expect(rt.verifySession).toHaveBeenCalledTimes(1))
  })

  it.each([
    ['403 (scope)', new ApiError('denied', 403)],
    ['5xx', new ApiError('boom', 500)],
    ['network', new TypeError('fetch failed')],
  ])('%s never routes to verifySession', async (_label, err) => {
    const rt = stubRuntime([sessionStub(SID_A, 'alice')])
    const client = createAppQueryClient(rt)
    await expect(
      client.fetchQuery({queryKey: [SID_A, 'post-feed'], queryFn: async () => Promise.reject(err), retry: false}),
    ).rejects.toBe(err)
    await new Promise(r => setTimeout(r, 20))
    expect(rt.verifySession).not.toHaveBeenCalled()
  })

  it('signed-out keys never route', async () => {
    const rt = stubRuntime([sessionStub(SID_A, 'alice')])
    const client = createAppQueryClient(rt)
    await expect(
      client.fetchQuery({queryKey: ['signed-out', 'post-feed'], queryFn: boom401, retry: false}),
    ).rejects.toMatchObject({status: 401})
    // The signed-out `me` key heads with 'me', not a session id — the
    // store lookup (no session 'me') still ignores it.
    await expect(
      client.fetchQuery({queryKey: ['me', 'signed-out'], queryFn: boom401, retry: false}),
    ).rejects.toMatchObject({status: 401})
    await new Promise(r => setTimeout(r, 20))
    expect(rt.verifySession).not.toHaveBeenCalled()
  })

  it('unknown session ids never route (no network for ghosts)', async () => {
    const rt = stubRuntime([sessionStub(SID_A, 'alice')])
    const client = createAppQueryClient(rt)
    await expect(
      client.fetchQuery({queryKey: ['https://ghost.example ghost', 'me'], queryFn: boom401, retry: false}),
    ).rejects.toMatchObject({status: 401})
    await new Promise(r => setTimeout(r, 20))
    expect(rt.verifySession).not.toHaveBeenCalled()
  })

  it('without a store, 401s are ignored', async () => {
    const client = createAppQueryClient(null)
    await expect(
      client.fetchQuery({queryKey: [SID_A, 'post-feed'], queryFn: boom401, retry: false}),
    ).rejects.toMatchObject({status: 401})
    // No store, no crash, nothing else to assert — the rejection above is
    // the whole contract.
  })
})

describe('MutationCache onError routing', () => {
  it('a 401 from a session-keyed mutation verifies that session', async () => {
    const rt = stubRuntime([sessionStub(SID_A, 'alice')])
    const client = createAppQueryClient(rt)
    const mutation = client.getMutationCache().build(client, {
      mutationKey: [SID_A, 'test-op'],
      mutationFn: boom401,
      retry: false,
    })
    await expect(mutation.execute(undefined)).rejects.toMatchObject({status: 401})
    await waitFor(() => expect(rt.verifySession).toHaveBeenCalledWith(SID_A))
  })

  it('a 403 mutation never verifies', async () => {
    const rt = stubRuntime([sessionStub(SID_A, 'alice')])
    const client = createAppQueryClient(rt)
    const mutation = client.getMutationCache().build(client, {
      mutationKey: [SID_A, 'test-op'],
      mutationFn: async () => {
        throw new ApiError('denied', 403)
      },
      retry: false,
    })
    await expect(mutation.execute(undefined)).rejects.toMatchObject({status: 403})
    await new Promise(r => setTimeout(r, 20))
    expect(rt.verifySession).not.toHaveBeenCalled()
  })

  it('a key-less mutation 401 is ignored (never mis-attributed)', async () => {
    const rt = stubRuntime([sessionStub(SID_A, 'alice')])
    const client = createAppQueryClient(rt)
    const mutation = client.getMutationCache().build(client, {
      mutationFn: boom401,
      retry: false,
    })
    await expect(mutation.execute(undefined)).rejects.toMatchObject({status: 401})
    await new Promise(r => setTimeout(r, 20))
    expect(rt.verifySession).not.toHaveBeenCalled()
  })
})

describe('drop toast + Login routing (real store loop)', () => {
  function stubFetch(status: number, body: unknown = {}): void {
    globalThis.fetch = (jest.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), {status})),
    ) as unknown as typeof fetch)
  }

  async function setupStore() {
    const store = createSessionStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: HOME_ORIGIN,
    })
    const session = await store.add({
      origin: ORIGIN_A,
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'alice',
      token: 'token-a',
      grant: 'password',
      hosting: 'third-party',
    })
    return {store, session}
  }

  it('second-401 drops: one toast with the acct, routes to Login when last', async () => {
    const {store, session} = await setupStore()
    stubFetch(401, {error: {message: 'unauthorized', code: 'AUTHENTICATION_FAILED'}})
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    const navigate = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
    const client = createAppQueryClient(store)
    await expect(
      client.fetchQuery({queryKey: [session.id, 'post-feed', 'timeline|home'], queryFn: boom401, retry: false}),
    ).rejects.toMatchObject({status: 401})
    await waitFor(() => expect(store.list()).toHaveLength(0))
    const messages = toastStore.getSnapshot().map(t => t.message)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('alice')
    expect(messages[0]).toContain('expired')
    expect(navigate).toHaveBeenCalledWith('Login')
  })

  it('a surviving verify (me 200) keeps the session with no toast', async () => {
    const {store, session} = await setupStore()
    stubFetch(200, {id: 'alice', username: 'alice', isBot: false, isCat: false})
    const client = createAppQueryClient(store)
    await expect(
      client.fetchQuery({queryKey: [session.id, 'me'], queryFn: boom401, retry: false}),
    ).rejects.toMatchObject({status: 401})
    await waitFor(() => expect(store.list()).toHaveLength(1))
    await new Promise(r => setTimeout(r, 20))
    expect(toastStore.getSnapshot()).toHaveLength(0)
  })

  it('dropping one of two sessions toasts but does not route', async () => {
    const {store} = await setupStore()
    await store.add({
      origin: ORIGIN_B,
      family: 'misskey',
      flavor: 'sharkey',
      accountId: 'bob',
      token: 'token-b',
      grant: 'miauth',
      hosting: 'third-party',
    })
    expect(store.list()).toHaveLength(2)
    stubFetch(401, {error: {message: 'unauthorized', code: 'AUTHENTICATION_FAILED'}})
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    const navigate = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
    const client = createAppQueryClient(store)
    await expect(
      client.fetchQuery({queryKey: [SID_A, 'notifications'], queryFn: boom401, retry: false}),
    ).rejects.toMatchObject({status: 401})
    await waitFor(() => expect(store.list().map(s => s.id)).toEqual([SID_B]))
    expect(toastStore.getSnapshot()).toHaveLength(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('QueryProvider wires the store above it (end to end through hooks)', async () => {
    const {store, session} = await setupStore()
    stubFetch(401, {error: {message: 'unauthorized', code: 'AUTHENTICATION_FAILED'}})
    function Boom({sessionId}: {sessionId: string}) {
      useQuery({queryKey: [sessionId, 'boom'], queryFn: boom401, retry: false})
      return null
    }
    render(
      <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
        <QueryProvider persister={createQueryPersister(createMemoryStore())}>
          <Boom sessionId={session.id} />
        </QueryProvider>
      </SessionProvider>,
    )
    await waitFor(() => expect(store.list()).toHaveLength(0))
    expect(toastStore.getSnapshot()).toHaveLength(1)
  })
})
