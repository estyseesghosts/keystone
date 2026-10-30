// Notifications query tests (W4/C11/N18, P6.5): session-first keys
// (switching accounts never shows the previous account's rows), grouped
// mode in the key, the server-authoritative unread count
// (`useNotificationsCountQuery` + `useUnreadBadge`), the live +1 patch,
// and mark-all-read invalidation (notifications + count + me).

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {renderHook, waitFor} from '@testing-library/react-native'

import {ApiError, type Account, type Backend, type Notification, type Page} from '@keystone/fedi'

import {
  notificationsFilterKey,
  notificationsItems,
  unreadPresence,
  useMarkNotificationsRead,
  useNotificationsCountQuery,
  useNotificationsQuery,
  useUnreadBadge,
  useUnreadNotificationsCount,
} from './notifications'
import {ingestLiveNotification} from '#/state/streaming'
import {meQueryKey, notificationsCountQueryKey, notificationsQueryKey} from './keys'

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
    notificationsUnreadCount:
      over.notificationsUnreadCount ?? jest.fn(async () => 0),
    markNotificationsRead: over.markNotificationsRead ?? jest.fn(async () => undefined),
    me: over.me ?? jest.fn(async () => ({ext: {}})),
    updateProfile: over.updateProfile ?? jest.fn(async () => ({})),
  } as unknown as Backend & {notifications: jest.Mock}
}

function unsupportedErr(): ApiError {
  return new ApiError(
    'Notification unread count is not on this server.',
    404,
    'errors.unsupported.notification_unread_count',
  )
}

function meWithPresence(hasUnread: boolean): Account {
  return {ext: {me: {hasUnreadNotification: hasUnread}}} as unknown as Account
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

describe('useNotificationsCountQuery (P6.5)', () => {
  it('keys the count by session id first', async () => {
    const client = testClient()
    const backend = fakeBackend({notificationsUnreadCount: jest.fn(async () => 3)})
    const {result} = renderHook(() => useNotificationsCountQuery('sess-c', {backend}), {
      wrapper: wrapper(client),
    })
    expect(result.current.queryKey).toEqual(notificationsCountQueryKey('sess-c'))
    expect(result.current.queryKey[0]).toBe('sess-c')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBe(3)
  })

  it('switching sessions never returns the other session count', async () => {
    const backendA = fakeBackend({notificationsUnreadCount: jest.fn(async () => 2)})
    const backendB = fakeBackend({notificationsUnreadCount: jest.fn(async () => 9)})
    const client = testClient()
    const {result, rerender} = renderHook(
      ({sessionId, backend}: {sessionId: string; backend: Backend}) =>
        useNotificationsCountQuery(sessionId, {backend, retry: 0}),
      {initialProps: {sessionId: 'sess-a', backend: backendA as Backend}, wrapper: wrapper(client)},
    )
    await waitFor(() => expect(result.current.data).toBe(2))
    rerender({sessionId: 'sess-b', backend: backendB as Backend})
    await waitFor(() => expect(result.current.data).toBe(9))
    expect(client.getQueryData(notificationsCountQueryKey('sess-a'))).toBe(2)
    expect(client.getQueryData(notificationsCountQueryKey('sess-b'))).toBe(9)
  })

  it('a backend without the member reads as unsupported (never a throw-wall)', async () => {
    const client = testClient()
    const backend = fakeBackend()
    delete (backend as {notificationsUnreadCount?: unknown}).notificationsUnreadCount
    const {result} = renderHook(() => useNotificationsCountQuery('sess-old', {backend, retry: 0}), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const {result: badge} = renderHook(() => useUnreadBadge('sess-old'), {wrapper: wrapper(client)})
    expect(badge.current).toBeNull()
  })
})

describe('useUnreadBadge (P6.5)', () => {
  it('unsupported + presence reads dot; unsupported without presence reads null', async () => {
    const failing = jest.fn(async () => {
      throw unsupportedErr()
    })
    // With a presence signal (Misskey-family me flag).
    const withSignal = testClient()
    withSignal.setQueryData(meQueryKey('sess-dot'), meWithPresence(true))
    const backend = fakeBackend({notificationsUnreadCount: failing})
    const w1 = wrapper(withSignal)
    const countHook = renderHook(() => useNotificationsCountQuery('sess-dot', {backend, retry: 0}), {
      wrapper: w1,
    })
    await waitFor(() => expect(countHook.result.current.isError).toBe(true))
    const {result: dot} = renderHook(() => useUnreadBadge('sess-dot'), {wrapper: w1})
    expect(dot.current).toEqual({kind: 'dot'})

    // Without any signal: nothing to show, never a guessed dot.
    const bare = testClient()
    const w2 = wrapper(bare)
    const countHook2 = renderHook(() => useNotificationsCountQuery('sess-bare', {backend, retry: 0}), {
      wrapper: w2,
    })
    await waitFor(() => expect(countHook2.result.current.isError).toBe(true))
    const {result: none} = renderHook(() => useUnreadBadge('sess-bare'), {wrapper: w2})
    expect(none.current).toBeNull()
  })

  it('a cached read === false row is a presence signal for the dot', async () => {
    const backend = fakeBackend({notificationsUnreadCount: jest.fn(async () => {
      throw unsupportedErr()
    })})
    const client = testClient()
    client.setQueryData(notificationsQueryKey('sess-row', 'all|grouped:1'), {
      pages: [page([notif('n1', false)])],
      pageParams: [null],
    })
    const w = wrapper(client)
    const countHook = renderHook(() => useNotificationsCountQuery('sess-row', {backend, retry: 0}), {
      wrapper: w,
    })
    await waitFor(() => expect(countHook.result.current.isError).toBe(true))
    const {result} = renderHook(() => useUnreadBadge('sess-row'), {wrapper: w})
    expect(result.current).toEqual({kind: 'dot'})
  })

  it('count 0 reads null (never a zero badge)', () => {
    const client = testClient()
    client.setQueryData(notificationsCountQueryKey('sess-zero'), 0)
    const {result} = renderHook(() => useUnreadBadge('sess-zero'), {wrapper: wrapper(client)})
    expect(result.current).toBeNull()
    const {result: count} = renderHook(() => useUnreadNotificationsCount('sess-zero'), {
      wrapper: wrapper(client),
    })
    expect(count.current).toBeNull()
  })

  it('a warm me seeds the number before the round trip', async () => {
    const client = testClient()
    client.setQueryData(meQueryKey('sess-warm'), {
      ext: {me: {unreadNotificationsCount: 4}},
    } as unknown as Account)
    // No backend at all (disabled query): the seed still paints.
    const {result} = renderHook(() => useUnreadBadge('sess-warm'), {wrapper: wrapper(client)})
    expect(result.current).toEqual({kind: 'count', count: 4})
  })
})

describe('unreadPresence (pure)', () => {
  it('reads the me flag, then cached rows; read/null never count', () => {
    expect(unreadPresence([], meWithPresence(true))).toBe(true)
    expect(unreadPresence([], meWithPresence(false))).toBe(false)
    expect(unreadPresence([], null)).toBe(false)
    const data = {pages: [page([notif('a', false), notif('b', true), notif('c', null)])], pageParams: [null]}
    expect(unreadPresence([data], null)).toBe(true)
    const read = {pages: [page([notif('a', true)])], pageParams: [null]}
    expect(unreadPresence([read], null)).toBe(false)
  })
})

describe('useUnreadNotificationsCount (N18, P6.5 server count)', () => {
  it('returns the server count (not cache rows)', async () => {
    const client = testClient()
    const backend = fakeBackend({notificationsUnreadCount: jest.fn(async () => 3)})
    const {result} = renderHook(() => useUnreadNotificationsCount('sess-s'), {
      wrapper: wrapper(client),
    })
    expect(result.current).toBeNull()
    // Mount the answering query (the badge and the screen share the key).
    renderHook(() => useNotificationsCountQuery('sess-s', {backend}), {wrapper: wrapper(client)})
    await waitFor(() => expect(client.getQueryData(notificationsCountQueryKey('sess-s'))).toBe(3))
    // Cache rows with different unread totals never leak into the number.
    client.setQueryData(notificationsQueryKey('sess-s', 'all|grouped:1'), {
      pages: [page([notif('n1', false), notif('n2', false)])],
      pageParams: [null],
    })
    const {result: after} = renderHook(() => useUnreadNotificationsCount('sess-s'), {
      wrapper: wrapper(client),
    })
    expect(after.current).toBe(3)
  })

  it('returns null when signed out or nothing answered yet', () => {
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

  it('unsupported reads null (the dot lives on useUnreadBadge, not here)', async () => {
    const client = testClient()
    const backend = fakeBackend({
      notificationsUnreadCount: jest.fn(async () => {
        throw unsupportedErr()
      }),
    })
    renderHook(() => useNotificationsCountQuery('sess-u2', {backend, retry: 0}), {
      wrapper: wrapper(client),
    })
    const {result} = renderHook(() => useUnreadNotificationsCount('sess-u2'), {
      wrapper: wrapper(client),
    })
    await waitFor(() =>
      expect(client.getQueryState(notificationsCountQueryKey('sess-u2'))?.status).toBe('error'),
    )
    expect(result.current).toBeNull()
  })
})

describe('live arrivals patch the count (P6.5)', () => {
  function seedList(client: QueryClient, sessionId: string) {
    client.setQueryData(notificationsQueryKey(sessionId, notificationsFilterKey('all', true)), {
      pages: [page<Notification>([])],
      pageParams: [null],
    })
  }

  it('a new id increments once; a duplicate never increments', () => {
    const client = testClient()
    seedList(client, 'sess-l')
    client.setQueryData(notificationsCountQueryKey('sess-l'), 3)
    const first = ingestLiveNotification(client, 'sess-l', notif('live-1', null))
    expect(first.prepended).toBe(1)
    expect(client.getQueryData(notificationsCountQueryKey('sess-l'))).toBe(4)
    const dupe = ingestLiveNotification(client, 'sess-l', notif('live-1', null))
    expect(dupe.prepended).toBe(0)
    expect(client.getQueryData(notificationsCountQueryKey('sess-l'))).toBe(4)
  })

  it('never fabricates a count that is not cached', () => {
    const client = testClient()
    seedList(client, 'sess-n')
    const res = ingestLiveNotification(client, 'sess-n', notif('live-9', null))
    expect(res.prepended).toBe(1)
    expect(client.getQueryData(notificationsCountQueryKey('sess-n'))).toBeUndefined()
  })
})

describe('useMarkNotificationsRead', () => {
  it('calls the backend mutation and invalidates notifications, count, and me', async () => {
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
    expect(invalidate).toHaveBeenCalledWith({queryKey: notificationsCountQueryKey('sess-r')})
    expect(invalidate).toHaveBeenCalledWith({queryKey: meQueryKey('sess-r')})
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
