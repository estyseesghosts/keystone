// P6.5: the shell badge renders the SERVER count (the count query), `99+`
// cap, the presence-dot fallback, and nothing when signed out or
// provider-less. Rewritten from the cache-derived N18 suite: the count
// source changed (cache rows → count query), the six cases kept.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, render, renderHook, screen, waitFor} from '@testing-library/react-native'

import {NotificationsUnreadBadge} from '#/Navigation'
import {ingestLiveNotification} from '#/state/streaming'
import {useNotificationsCountQuery} from '#/state/queries/notifications'
import {meQueryKey, notificationsCountQueryKey, notificationsQueryKey} from '#/state/queries/keys'
import {ApiError, type Account, type Backend, type Notification} from '@keystone/fedi'

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
}))

const S1 = 'session-1'

function testClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

function seedCount(qc: QueryClient, sessionId: string, count: number): void {
  qc.setQueryData(notificationsCountQueryKey(sessionId), count)
}

function seedCacheRows(qc: QueryClient, sessionId: string, reads: Array<boolean | null>): void {
  qc.setQueryData(notificationsQueryKey(sessionId, 'all|grouped:1'), {
    pages: [
      {
        items: reads.map((read, i) => ({
          id: `row-${i}`,
          kind: 'mention',
          actors: [],
          createdAt: '2026-10-21T00:00:00.000Z',
          read,
        })),
        cursor: null,
        end: true,
      },
    ],
    pageParams: [undefined],
  })
}

function seedAllPage(qc: QueryClient, sessionId: string): void {
  qc.setQueryData(notificationsQueryKey(sessionId, 'all|grouped:1'), {
    pages: [{items: [], cursor: null, end: true}],
    pageParams: [undefined],
  })
}

function renderBadge(qc: QueryClient | null, sessionId: string | null, compact = false) {
  const badge = <NotificationsUnreadBadge sessionId={sessionId} compact={compact} />
  return render(qc ? <QueryClientProvider client={qc}>{badge}</QueryClientProvider> : badge)
}

describe('NotificationsUnreadBadge (P6.5 server count)', () => {
  it('renders nothing without a query client (never crashes provider-less trees)', () => {
    renderBadge(null, S1)
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
  })

  it('renders nothing when signed out', () => {
    renderBadge(testClient(), null)
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
  })

  it('renders the server count, not cache rows', () => {
    const qc = testClient()
    seedCount(qc, S1, 5)
    // Cache rows disagree (2 unread rows) — the server number wins.
    seedCacheRows(qc, S1, [false, false, true])
    renderBadge(qc, S1)
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('5')
  })

  it('caps at 99+', () => {
    const qc = testClient()
    seedCount(qc, S1, 100)
    renderBadge(qc, S1)
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('99+')
  })

  it('dot fallback: unsupported endpoint + presence signal renders a dot, never a number', async () => {
    const qc = testClient()
    qc.setQueryData(meQueryKey(S1), {
      ext: {me: {hasUnreadNotification: true}},
    } as unknown as Account)
    const backend = {
      notificationsUnreadCount: jest.fn(async () => {
        throw new ApiError(
          'Notification unread count is not on this server.',
          404,
          'errors.unsupported.notification_unread_count',
        )
      }),
    } as unknown as Backend
    const wrapper = ({children}: {children: React.ReactNode}) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const countHook = renderHook(() => useNotificationsCountQuery(S1, {backend, retry: 0}), {
      wrapper,
    })
    await waitFor(() => expect(countHook.result.current.isError).toBe(true))
    renderBadge(qc, S1)
    const dot = screen.getByTestId('notifications-badge')
    expect(dot).toBeTruthy()
    expect(dot).not.toHaveTextContent('1')
    expect(dot).not.toHaveTextContent('0')
  })

  it('live arrival bumps the visible number by one', () => {
    const qc = testClient()
    seedCount(qc, S1, 3)
    seedAllPage(qc, S1)
    renderBadge(qc, S1)
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('3')
    act(() => {
      ingestLiveNotification(qc, S1, {id: 'live-1'} as Notification)
    })
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('4')
  })

  it('accessible label carries the count', () => {
    const qc = testClient()
    seedCount(qc, S1, 3)
    renderBadge(qc, S1)
    const badge = screen.getByTestId('notifications-badge') as unknown as {props: {accessibilityLabel?: unknown}}
    expect(badge.props.accessibilityLabel).toContain('3')
  })
})
