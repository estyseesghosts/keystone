import {Text} from 'react-native'
import {QueryClient} from '@tanstack/react-query'
import {render, renderHook, screen, waitFor} from '@testing-library/react-native'

import {
  createMemoryStore,
  type Backend,
  type Notification,
  type Page,
  type Post,
} from '@keystone/fedi'

import {
  QUERY_BUSTER,
  QUERY_PERSIST_MAX_AGE,
} from './stale'
import {QUERY_PERSIST_KEY, QueryProvider, createQueryPersister} from './Provider'
import {feedItems, fetchFeedPage, usePostFeedQuery} from './usePostFeedQuery'

// Feed query tests (slice 3.2): the dispatch matrix plus the plan §3 known
// lesson — switching accounts must never show the previous account's
// timeline (query keys carry the sessionId first, so the cache cannot).

function page<T>(items: T[]): Page<T> {
  return {items, cursor: null, end: true}
}

function post(id: string): Post {
  return {id} as unknown as Post
}

function notif(id: string, p: Post | null): Notification {
  return {id, post: p} as unknown as Notification
}

function mockBackend(): Backend & {
  timeline: jest.Mock
  accountPosts: jest.Mock
  accountFeaturedPosts: jest.Mock
  searchPosts: jest.Mock
  searchTags: jest.Mock
  explorePosts: jest.Mock
  notifications: jest.Mock
} {
  const timeline = jest.fn(async () => page([post('t1')]))
  const accountPosts = jest.fn(async () => page([post('u1')]))
  const accountFeaturedPosts = jest.fn(async () => page([post('f1')]))
  const searchPosts = jest.fn(async () => page([post('s1')]))
  const searchTags = jest.fn(async () => page([post('g1')]))
  const explorePosts = jest.fn(async () => page([post('e1')]))
  const notifications = jest.fn(async () => page([notif('n1', post('m1')), notif('n2', null)]))
  const backend = {
    timeline,
    accountPosts,
    accountFeaturedPosts,
    search: {
      posts: searchPosts,
      tags: searchTags,
      accounts: jest.fn(async () => page([])),
    },
    notifications,
    lists: {timeline: jest.fn(async () => page([post('l1')]))},
    antennas: {notes: jest.fn(async () => page([post('a1')]))},
    clips: {notes: jest.fn(async () => page([post('c1')]))},
    explore: {posts: explorePosts},
    bookmarks: {list: jest.fn(async () => ({items: [{id: 'b1', post: post('p1')}], cursor: null, end: true}))},
  } as unknown as Backend
  return Object.assign(backend, {
    timeline,
    accountPosts,
    accountFeaturedPosts,
    searchPosts,
    searchTags,
    explorePosts,
    notifications,
  })
}

function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {queries: {retry: false, gcTime: 60_000}},
  })
}

describe('fetchFeedPage dispatch', () => {
  it('routes timelines to backend.timeline', async () => {
    const b = mockBackend()
    const result = await fetchFeedPage(b, {kind: 'timeline', timeline: 'home'}, null, 20)
    expect(b.timeline).toHaveBeenCalledWith('home', {cursor: null, limit: 20})
    expect(result.items.map(p => p.id)).toEqual(['t1'])
  })

  it('routes named feeds to their sub-modules', async () => {
    const b = mockBackend()
    await fetchFeedPage(b, {kind: 'list', id: 'l'}, null)
    expect((b.lists as Backend['lists'])?.timeline).toHaveBeenCalledWith('l', {cursor: null, limit: 20})
    await fetchFeedPage(b, {kind: 'antenna', id: 'a'}, null)
    expect(b.antennas?.notes).toHaveBeenCalled()
    await fetchFeedPage(b, {kind: 'clip', id: 'c'}, null)
    expect(b.clips?.notes).toHaveBeenCalled()
    await fetchFeedPage(b, {kind: 'tag', tag: 'x'}, null)
    expect(b.searchTags).toHaveBeenCalledWith('x', {cursor: null, limit: 20})
    await fetchFeedPage(b, {kind: 'search', query: 'q'}, null)
    expect(b.searchPosts).toHaveBeenCalledWith('q', {cursor: null, limit: 20})
    await fetchFeedPage(b, {kind: 'explore'}, null)
    expect(b.explorePosts).toHaveBeenCalledWith({cursor: null, limit: 20})
  })

  it('maps bookmarks rows to posts', async () => {
    const b = mockBackend()
    const result = await fetchFeedPage(b, {kind: 'bookmarks'}, null)
    expect(result.items.map(p => p.id)).toEqual(['p1'])
  })

  it('maps mentions through notifications and drops post-less rows', async () => {
    const b = mockBackend()
    const result = await fetchFeedPage(b, {kind: 'mentions'}, null)
    expect(b.notifications).toHaveBeenCalledWith(
      expect.objectContaining({includeTypes: ['mention', 'reply']}),
    )
    expect(result.items.map(p => p.id)).toEqual(['m1'])
  })

  it('sends explicit tab flags for user feeds', async () => {
    const b = mockBackend()
    await fetchFeedPage(b, {kind: 'user', id: 'u', tab: 'posts'}, null)
    expect(b.accountPosts).toHaveBeenCalledWith(
      'u',
      expect.objectContaining({withReplies: false, withRenotes: false}),
    )
    await fetchFeedPage(b, {kind: 'user', id: 'u', tab: 'replies'}, null)
    expect(b.accountPosts).toHaveBeenCalledWith(
      'u',
      expect.objectContaining({withReplies: true, withRenotes: false}),
    )
    await fetchFeedPage(b, {kind: 'user', id: 'u', tab: 'media'}, null)
    expect(b.accountPosts).toHaveBeenCalledWith(
      'u',
      expect.objectContaining({withFiles: true, withRenotes: false}),
    )
    await fetchFeedPage(b, {kind: 'user', id: 'u', tab: 'featured'}, null)
    expect(b.accountFeaturedPosts).toHaveBeenCalledWith('u', expect.anything())
  })

  it('answers honest 404s for unsupported modules and channels', async () => {
    const b = mockBackend()
    const bare = {...b, lists: undefined, antennas: undefined, clips: undefined, bookmarks: undefined, explore: undefined} as unknown as Backend
    await expect(fetchFeedPage(bare, {kind: 'list', id: 'l'}, null)).rejects.toMatchObject({
      code: 'errors.unsupported.lists',
    })
    await expect(fetchFeedPage(bare, {kind: 'antenna', id: 'a'}, null)).rejects.toMatchObject({
      code: 'errors.unsupported.antennas',
    })
    await expect(fetchFeedPage(bare, {kind: 'clip', id: 'c'}, null)).rejects.toMatchObject({
      code: 'errors.unsupported.clips',
    })
    await expect(fetchFeedPage(bare, {kind: 'bookmarks'}, null)).rejects.toMatchObject({
      code: 'errors.unsupported.bookmarks',
    })
    await expect(fetchFeedPage(bare, {kind: 'explore'}, null)).rejects.toMatchObject({
      code: 'errors.unsupported.explore',
    })
    await expect(fetchFeedPage(b, {kind: 'channel', id: 'ch'}, null)).rejects.toMatchObject({
      code: 'errors.unsupported.channel',
    })
  })
})

describe('feedItems', () => {
  it('flattens pages and tolerates no data', () => {
    expect(feedItems(undefined)).toEqual([])
    expect(feedItems({pages: [page([post('a')]), page([post('b')])], pageParams: [null, null]})).toEqual([
      expect.objectContaining({id: 'a'}),
      expect.objectContaining({id: 'b'}),
    ])
  })

  it('dedupes overlapping page edges, keeping the newest occurrence', () => {
    expect(
      feedItems({
        pages: [page([post('a'), post('b')]), page([post('b'), post('c')])],
        pageParams: [null, null],
      }).map(p => p.id),
    ).toEqual(['a', 'b', 'c'])
  })
})

describe('usePostFeedQuery account isolation (plan §3 lesson)', () => {
  it('switching accounts never shows the previous account timeline', async () => {
    const backendA = {timeline: jest.fn(async () => page([post('a1')]))} as unknown as Backend
    const backendB = {timeline: jest.fn(async () => page([post('b1')]))} as unknown as Backend
    const client = testClient()
    const wrapper = ({children}: {children: React.ReactNode}) => (
      <QueryProvider client={client} persister={createQueryPersister(createMemoryStore())}>
        {children}
      </QueryProvider>
    )
    const {result, rerender} = renderHook(
      ({sessionId, backend}: {sessionId: string; backend: Backend}) =>
        usePostFeedQuery(sessionId, 'timeline|home', {backend}),
      {initialProps: {sessionId: 'sess-a', backend: backendA}, wrapper},
    )
    await waitFor(() => expect(feedItems(result.current.data).map(p => p.id)).toEqual(['a1']))
    expect(result.current.queryKey[0]).toBe('sess-a')

    rerender({sessionId: 'sess-b', backend: backendB})
    await waitFor(() => expect(feedItems(result.current.data).map(p => p.id)).toEqual(['b1']))
    expect(result.current.queryKey[0]).toBe('sess-b')
    expect(feedItems(result.current.data).map(p => p.id)).not.toContain('a1')
    expect(backendB.timeline).toHaveBeenCalled()
  })

  it('stays disabled without a session and throws on a bad descriptor', async () => {
    const client = testClient()
    const wrapper = ({children}: {children: React.ReactNode}) => (
      <QueryProvider client={client} persister={createQueryPersister(createMemoryStore())}>
        {children}
      </QueryProvider>
    )
    const backend = mockBackend()
    const {result} = renderHook(() => usePostFeedQuery(null, 'timeline|home', {backend}), {wrapper})
    expect(result.current.data).toBeUndefined()
    expect(result.current.queryKey[0]).toBe('signed-out')

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      renderHook(() => usePostFeedQuery('sess-a', 'bogus|descriptor|x', {backend}), {wrapper}),
    ).toThrow()
    spy.mockRestore()
  })
})

describe('QueryProvider persistence', () => {
  it('renders children and persists under the stable key', async () => {
    const store = createMemoryStore()
    const persister = createQueryPersister(store)
    const client = testClient()
    client.setQueryData(['sess-a', 'post-feed', 'timeline|home'], {
      pages: [page([post('a1')])],
      pageParams: [null],
    })
    render(
      <QueryProvider client={client} persister={persister}>
        <Text testID="child">child</Text>
      </QueryProvider>,
    )
    expect(screen.getByTestId('child')).toBeTruthy()

    const {dehydrate} = await import('@tanstack/react-query')
    await persister.persistClient({
      buster: QUERY_BUSTER,
      timestamp: Date.now(),
      clientState: dehydrate(client),
    })
    expect(store.getItem(QUERY_PERSIST_KEY)).not.toBeNull()
    expect(QUERY_PERSIST_MAX_AGE).toBeGreaterThan(0)
  })
})
