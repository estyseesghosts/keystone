// P6.5 Pages slice 2: query keys are session-scoped, listings page,
// own/liked lists gate on module presence, note fetch disables cleanly.

import {renderHook, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore, type Backend} from '@keystone/fedi'

import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import type {TokenVault} from '#/storage'

import {
  pageQueryKey,
  pagesQueryKey,
} from './keys'
import {
  useFeaturedPages,
  useLikedPages,
  useMyPages,
  usePageNote,
  usePageQuery,
  usePagesByUser,
} from './pages'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function pagesModule(over: Record<string, unknown> = {}) {
  return {
    show: jest.fn(async ({id}: {id: string}) => ({
      id,
      title: 'T',
      name: 't',
      blocks: [],
    })),
    byUser: jest.fn(async () => ({items: [], cursor: null, end: true})),
    featured: jest.fn(async () => []),
    mine: jest.fn(async () => ({items: [], cursor: null, end: true})),
    liked: jest.fn(async () => ({items: [], cursor: null, end: true})),
    like: jest.fn(async () => undefined),
    unlike: jest.fn(async () => undefined),
    pin: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    ...over,
  }
}

function backend(pages?: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  return {family: 'misskey', capabilities: {pages: 'supported'}, ...(pages ? {pages} : {}), ...extra} as unknown as Backend
}

async function twoSessions() {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://a.example',
  })
  for (const accountId of ['alice', 'bob']) {
    await store.add({
      origin: 'https://a.example',
      family: 'misskey',
      flavor: 'misskey',
      accountId,
      token: `token-${accountId}`,
      grant: 'miauth',
      hosting: 'third-party',
    })
  }
  const ids = store.getSnapshot().sessions.map(s => s.id)
  return {store, ids}
}

function wrapper(store: unknown, client = new QueryClient({defaultOptions: {queries: {retry: false}}})) {
  return ({children}: {children: React.ReactNode}) => (
    <SessionProvider store={store as never} homeOrigin="https://a.example">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionProvider>
  )
}

describe('page query keys', () => {
  it('scope every key by session first', () => {
    expect(pageQueryKey('s1', 'p1')[0]).toBe('s1')
    expect(pagesQueryKey('s1', 'mine')[0]).toBe('s1')
    expect(pageQueryKey('s1', 'p1')).not.toEqual(pageQueryKey('s2', 'p1'))
    expect(pagesQueryKey('s1', 'mine')).not.toEqual(pagesQueryKey('s1', 'liked'))
  })
})

describe('usePageQuery', () => {
  it('fetches by id and stays disabled without a session or module', async () => {
    const {store, ids} = await twoSessions()
    const b = backend(pagesModule());
    (b.pages as unknown as {show: jest.Mock}).show.mockResolvedValueOnce({id: 'p1', title: 'T'});
    const {result} = renderHook(() => usePageQuery(ids[0]!, 'p1', {backend: b}), {
      wrapper: wrapper(store),
    })
    await waitFor(() => expect(result.current.data?.id).toBe('p1'))
    const signedOut = renderHook(() => usePageQuery(null, 'p1', {backend: b}), {
      wrapper: wrapper(store),
    })
    expect(signedOut.result.current.fetchStatus).toBe('idle')
    const noModule = renderHook(() => usePageQuery(ids[0]!, 'p1', {backend: backend(null)}), {
      wrapper: wrapper(store),
    })
    expect(noModule.result.current.fetchStatus).toBe('idle')
  })

  it('never serves the other account\u2019s page (session-first keys)', async () => {
    const {store, ids} = await twoSessions()
    const bA = backend(pagesModule());
    (bA.pages as unknown as {show: jest.Mock}).show.mockResolvedValue({id: 'p-a'});
    const bB = backend(pagesModule());
    (bB.pages as unknown as {show: jest.Mock}).show.mockResolvedValue({id: 'p-b'});
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const w = wrapper(store, client)
    const a = renderHook(() => usePageQuery(ids[0]!, 'p', {backend: bA}), {wrapper: w})
    const b = renderHook(() => usePageQuery(ids[1]!, 'p', {backend: bB}), {wrapper: w})
    await waitFor(() => expect(a.result.current.data?.id).toBe('p-a'))
    await waitFor(() => expect(b.result.current.data?.id).toBe('p-b'))
  })
})

describe('paged listings', () => {
  it('pages byUser through the cursor', async () => {
    const {store, ids} = await twoSessions()
    const b = backend(pagesModule());
    (b.pages as unknown as {byUser: jest.Mock}).byUser
      .mockResolvedValueOnce({items: [{id: 'a'}], cursor: 'c1', end: false})
      .mockResolvedValueOnce({items: [{id: 'b'}], cursor: null, end: true})
    const {result} = renderHook(() => usePagesByUser(ids[0]!, 'u9', {backend: b}), {
      wrapper: wrapper(store),
    })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    expect((b.pages as unknown as {byUser: jest.Mock}).byUser).toHaveBeenCalledWith('u9', {cursor: undefined, limit: 20})
    await result.current.fetchNextPage()
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
  })

  it('hides own/liked lists where the module is absent (Pinetree)', async () => {
    const {store, ids} = await twoSessions()
    const b = backend({show: jest.fn(), byUser: jest.fn(), featured: jest.fn()})
    const w = wrapper(store)
    const mine = renderHook(() => useMyPages(ids[0]!, {backend: b}), {wrapper: w})
    const liked = renderHook(() => useLikedPages(ids[0]!, {backend: b}), {wrapper: w})
    expect(mine.result.current.fetchStatus).toBe('idle')
    expect(liked.result.current.fetchStatus).toBe('idle')
  })

  it('featured is a single fetch', async () => {
    const {store, ids} = await twoSessions()
    const b = backend(pagesModule())
    const {result} = renderHook(() => useFeaturedPages(ids[0]!, {backend: b}), {
      wrapper: wrapper(store),
    })
    await waitFor(() => expect(result.current.data).toEqual([]))
    expect((b.pages as unknown as {featured: jest.Mock}).featured).toHaveBeenCalledTimes(1)
  })
})

describe('usePageNote', () => {
  it('stays disabled without a note id', async () => {
    const {store, ids} = await twoSessions()
    const b = backend(undefined, {post: jest.fn()})
    const {result} = renderHook(() => usePageNote(ids[0]!, null, {backend: b}), {
      wrapper: wrapper(store),
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect((b as unknown as {post: jest.Mock}).post).not.toHaveBeenCalled()
  })
})
