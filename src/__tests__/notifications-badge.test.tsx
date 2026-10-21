// N18: the shell badge is cache-derived (no streaming counter). The guard
// keeps provider-less trees rendering; the count reads the newest cached
// page per query key, `read: null` never counts.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react-native'

import {NotificationsUnreadBadge} from '#/Navigation'
import type {Notification} from '@keystone/fedi'

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
}))

const S1 = 'session-1'

function unreadClient(items: Array<Pick<Notification, 'id' | 'read'>>): QueryClient {
  const qc = new QueryClient()
  qc.setQueryData([S1, 'notifications', 'all|grouped:1'], {
    pages: [
      {
        items: items.map(n => ({...n, kind: 'mention', actors: [], createdAt: '2026-10-21T00:00:00.000Z'})),
        cursor: null,
        end: true,
      },
    ],
    pageParams: [undefined],
  })
  return qc
}

function renderBadge(qc: QueryClient | null, sessionId: string | null, compact = false) {
  const badge = <NotificationsUnreadBadge sessionId={sessionId} compact={compact} />
  return render(qc ? <QueryClientProvider client={qc}>{badge}</QueryClientProvider> : badge)
}

describe('NotificationsUnreadBadge (N18)', () => {
  it('renders nothing without a query client (never crashes provider-less trees)', () => {
    renderBadge(null, S1)
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
  })

  it('renders nothing when signed out', () => {
    renderBadge(new QueryClient(), null)
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
  })

  it('counts only read === false (read/null are not unread)', () => {
    renderBadge(
      unreadClient([
        {id: 'n1', read: false},
        {id: 'n2', read: true},
        {id: 'n3', read: null},
        {id: 'n4', read: false},
      ]),
      S1,
    )
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('2')
  })

  it('caps at 99+', () => {
    const items = Array.from({length: 100}, (_, i) => ({id: `n${i}`, read: false as const}))
    renderBadge(unreadClient(items), S1)
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('99+')
  })

  it('renders nothing when everything is read', () => {
    renderBadge(unreadClient([{id: 'n1', read: true}]), S1)
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
  })

  it('compact renders a dot without a count', () => {
    renderBadge(unreadClient([{id: 'n1', read: false}]), S1, true)
    const dot = screen.getByTestId('notifications-badge')
    expect(dot).toBeTruthy()
    expect(dot).not.toHaveTextContent('1')
  })
})
