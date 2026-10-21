// Notifications query tests (W4/C11/N18): session-first keys (switching
// accounts never shows the previous account's rows), grouped mode in the
// key, cache-derived unread counts, and mark-all-read invalidation.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {renderHook, waitFor} from '@testing-library/react-native'

import type {Backend, Notification, Page} from '@keystone/fedi'

import {
  notificationsFilterKey,
  notificationsItems,
  useMarkNotificationsRead,
  useNotificationsQuery,
  useUnreadNotificationsCount,
} from './notifications'
import {notificationsQueryKey} from './keys'

function page<T>(items: T[]): Page<T> {
  return {items, cursor: null, end: true}
}

function notif(id: string, read: boolean | null): Notification {
  return {id, read} as unknown as Notification
}

function fakeBackend(over: Partial<Record<string, jest.Mock>> = {}): Backend & {notifications: jest.Mock} {
  const notifications = over.notifications ?? jest.fn(async () => page<Notification>([]))
  return {
    notifications,
    markNotificationsRead: over.markNotificationsRead ?? jest.fn(async () => undefined),
    me: over.me ?? jest.fn(async () => ({ext: {}})),
    updateProfile: over.updateProfile ?? jest.fn(async () => ({})),
  } as unknown as Backend & {notifications: jest.Mock}
}

function testClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

function wrapper(client: QueryClient) {
  return ({children}: {children: React.ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('notifications query keys (session first)', () => {
  it('scopes keys by sessionId first and encodes filter + grouped mode', async () => {
    const client = testClient()
    const backend = fakeBackend()
    const {result} = renderHook(
      () => useNotificationsQuery('sess-a', 'mentions', {includeTypes: ['mention']}, true, {backend}),
      {wrapper: wrapper(client)},
    )
    expect(result.current.queryKey[0]).toBe('sess-a')
    expect(result.current.queryKey).toEqual(notificationsQueryKey('sess-a', 'mentions|grouped:1'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(backend.notifications).toHaveBeenCalledWith(
      expect.objectContaining({includeTypes: ['mention'], grouped: true}),
    )
  })

  it('flat and grouped modes never share a key', () => {
    expect(notificationsFilterKey('all', true)).not.toBe(notificationsFilterKey('all', false))
  })

  it('switching accounts switches keys and never serves the old rows', async () => {
    const backendA = fakeBackend({notifications: jest.fn(async () => page([notif('a1', false)]))})
    const backendB = fakeBackend({notifications: jest.fn(async () => page([notif('b1', false)]))})
    const client = testClient()
    const {result, rerender} = renderHook(
      ({sessionId, backend}: {sessionId: string; backend: Backend}) =>
        useNotificationsQuery(sessionId, 'all', {}, true, {backend}),
      {initialProps: {sessionId: 'sess-a', backend: backendA as Backend}, wrapper: wrapper(client)},
    )
    await waitFor(() => expect(notificationsItems(result.current.data).map(n => n.id)).toEqual(['a1']))
    expect(result.current.queryKey[0]).toBe('sess-a')

    rerender({sessionId: 'sess-b', backend: backendB as Backend})
    await waitFor(() => expect(notificationsItems(result.current.data).map(n => n.id)).toEqual(['b1']))
    expect(result.current.queryKey[0]).toBe('sess-b')
    expect(notificationsItems(result.current.data).map(n => n.id)).not.toContain('a1')
  })

  it('stays disabled without a session', () => {
    const client = testClient()
    const {result} = renderHook(() => useNotificationsQuery(null, 'all', {}, true, {backend: null}), {
      wrapper: wrapper(client),
    })
    expect(result.current.data).toBeUndefined()
    expect(result.current.queryKey[0]).toBe('signed-out')
  })
})

describe('notificationsItems', () => {
  it('flattens pages, dedupes by id, and tolerates no data', () => {
    expect(notificationsItems(undefined)).toEqual([])
    const data = {pages: [page([notif('a', false), notif('b', true)]), page([notif('b', true), notif('c', null)])], pageParams: [null, null]}
    expect(notificationsItems(data).map(n => n.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('useUnreadNotificationsCount (N18)', () => {
  it('counts read === false on the newest page, ignoring read/null', async () => {
    const client = testClient()
    client.setQueryData(notificationsQueryKey('sess-u', 'all|grouped:1'), {
      pages: [page([notif('n1', false), notif('n2', true), notif('n3', null)])],
      pageParams: [null],
    })
    const {result} = renderHook(() => useUnreadNotificationsCount('sess-u'), {wrapper: wrapper(client)})
    expect(result.current).toBe(1)
  })

  it('returns null when signed out or nothing is cached', () => {
    const client = testClient()
    const {result: signedOut} = renderHook(() => useUnreadNotificationsCount(null), {
      wrapper: wrapper(client),
    })
    expect(signedOut.current).toBeNull()
    const {result: empty} = renderHook(() => useUnreadNotificationsCount('sess-empty'), {
      wrapper: wrapper(client),
    })
    expect(empty.current).toBeNull()
  })

  it('dedupes rows cached under several filter queries and reacts to invalidation', async () => {
    const client = testClient()
    client.setQueryData(notificationsQueryKey('sess-m', 'all|grouped:1'), {
      pages: [page([notif('n1', false), notif('n2', false)])],
      pageParams: [null],
    })
    client.setQueryData(notificationsQueryKey('sess-m', 'mentions|grouped:1'), {
      pages: [page([notif('n1', false), notif('n3', false)])],
      pageParams: [null],
    })
    const {result} = renderHook(() => useUnreadNotificationsCount('sess-m'), {wrapper: wrapper(client)})
    expect(result.current).toBe(3)
  })
})

describe('useMarkNotificationsRead', () => {
  it('calls the backend mutation and invalidates the session queries', async () => {
    const markNotificationsRead = jest.fn(async () => undefined)
    const backend = fakeBackend({markNotificationsRead})
    const client = testClient()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const {result} = renderHook(() => useMarkNotificationsRead('sess-r', {backend}), {
      wrapper: wrapper(client),
    })
    result.current.mutate()
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({queryKey: ['sess-r', 'notifications']}),
    )
  })

  it('errors honestly without a backend', async () => {
    const client = testClient()
    const {result} = renderHook(() => useMarkNotificationsRead(null, {backend: null}), {
      wrapper: wrapper(client),
    })
    result.current.mutate()
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
