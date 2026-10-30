// Filtered notification requests UI (repair X4.5): the entry, the inbox
// list with accept/dismiss actions, and the policy section. Probe-backed:
// unsupported servers hide the entry WITH a reason while the main list
// keeps every item (never a silent vanish); Misskey (no member) hides
// with its own reason.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {
  ApiError,
  createMemoryStore,
  type Backend,
  type Notification,
  type NotificationPolicy,
  type NotificationRequest,
} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {NotificationsScreen} from './Notifications'

const mockBackends = new Map<string, unknown>()
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

const vault: TokenVault = {
  getToken: async () => null,
  setToken: async () => {},
  removeToken: async () => {},
}

function mainNotification(id = 'n1'): Notification {
  return {
    id,
    kind: 'favourite',
    rawType: 'favourite',
    createdAt: '2026-10-20T00:00:00.000Z',
    read: false,
    actors: [],
    post: null,
    reaction: null,
    ext: {},
  }
}

function request(id: string, username: string): NotificationRequest {
  return {
    id,
    createdAt: '2026-10-20T00:00:00.000Z',
    account: {
      id: `u-${id}`,
      username,
      acct: username,
      host: null,
      name: username,
      displayName: username,
      bio: {plain: ''},
      url: null,
      uri: null,
      avatarUrl: null,
      avatarBlurhash: null,
      headerUrl: null,
      headerBlurhash: null,
      backgroundUrl: null,
      followersCount: 0,
      followingCount: 0,
      statusesCount: 0,
      locked: false,
      bot: false,
      cat: false,
      silenced: false,
      suspended: false,
      onlineStatus: null,
      location: null,
      birthday: null,
      createdAt: null,
      updatedAt: null,
      lastFetchedAt: null,
      emojis: {},
      fields: [],
      movedTo: null,
      ffVisibility: null,
      pinnedPostIds: null,
      pinnedPosts: null,
      pinnedPageId: null,
      pinnedPage: null,
      ext: {},
    },
  }
}

function policy(): NotificationPolicy {
  return {
    filterNotFollowing: true,
    filterNotFollowers: false,
    filterNewAccounts: true,
    filterPrivateMentions: false,
    pendingRequestsCount: 2,
    pendingNotificationsCount: 5,
  }
}

async function renderScreen(
  family: 'mastodon' | 'misskey',
  backend: Record<string, unknown>,
  items: Array<Notification> = [mainNotification()],
) {
  mockBackends.clear()
  const store = createSessionStore({storage: createMemoryStore(), vault, homeOrigin: 'https://a.example'})
  const added = await store.add({
    origin: 'https://a.example',
    family,
    flavor: family,
    accountId: 'alice',
    token: 'token-a',
    grant: 'password',
    hosting: 'third-party',
  })
  mockBackends.set(added.id, {
    family,
    capabilities: {},
    notifications: jest.fn(async () => ({items, cursor: null, end: true})),
    markNotificationsRead: jest.fn(async () => {}),
    ...backend,
  } as unknown as Backend)
  i18n.load('en', {})
  i18n.activate('en')
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={new QueryClient()}>
          <SessionProvider store={store} homeOrigin="https://a.example">
            <NotificationsScreen />
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

function supportedBackend(overrides: Record<string, jest.Mock> = {}) {
  const api: Record<string, jest.Mock> = {
    list: jest.fn(async () => ({items: [request('701', 'alice'), request('702', 'bob')], cursor: null, end: true})),
    accept: jest.fn(async () => {}),
    dismiss: jest.fn(async () => {}),
    policy: jest.fn(async () => policy()),
    updatePolicy: jest.fn(async (patch: Partial<NotificationPolicy>) => ({...policy(), ...patch})),
    isSupported: jest.fn(() => true),
    ...overrides,
  }
  return {api, backend: {notificationRequests: api}}
}

describe('NotificationsScreen filtered requests (Mastodon 4.3+)', () => {
  it('shows the entry with the pending badge and the policy rows', async () => {
    const {api} = supportedBackend()
    await renderScreen('mastodon', {notificationRequests: api})
    // Entry + badge (probe resolved through the policy read).
    expect(await screen.findByTestId('notifications-requests-entry')).toBeTruthy()
    expect(await screen.findByText('2 filtered notifications')).toBeTruthy()
    // Policy section renders the four switches.
    expect(screen.getByTestId('notifications-requests-policy-filterNotFollowing')).toBeTruthy()
    expect(screen.getByTestId('notifications-requests-policy-filterPrivateMentions')).toBeTruthy()
    // The main list is untouched (nothing silently vanishes).
    expect(screen.getByTestId('notification-n1')).toBeTruthy()
  })

  it('expands the inbox and accepts a row (row removed, badge refetched)', async () => {
    const {api} = supportedBackend()
    await renderScreen('mastodon', {notificationRequests: api})
    fireEvent.press(await screen.findByTestId('notifications-requests-entry'))
    expect(await screen.findByTestId('notification-request-701')).toBeTruthy()
    fireEvent.press(screen.getByTestId('notification-request-accept-701'))
    await waitFor(() => expect(api.accept).toHaveBeenCalledWith('701'))
    // Row removed locally; badge refetched from the server (mount + refresh).
    await waitFor(() => expect(screen.queryByTestId('notification-request-701')).toBeNull())
    expect(api.policy).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('notification-request-702')).toBeTruthy()
  })

  it('dismisses a row through the backend', async () => {
    const {api} = supportedBackend()
    await renderScreen('mastodon', {notificationRequests: api})
    fireEvent.press(await screen.findByTestId('notifications-requests-entry'))
    fireEvent.press(await screen.findByTestId('notification-request-dismiss-702'))
    await waitFor(() => expect(api.dismiss).toHaveBeenCalledWith('702'))
    await waitFor(() => expect(screen.queryByTestId('notification-request-702')).toBeNull())
  })

  it('saves a toggled policy switch (only defined fields sent)', async () => {
    const {api} = supportedBackend()
    await renderScreen('mastodon', {notificationRequests: api})
    await screen.findByTestId('notifications-requests-policy')
    // filterNotFollowers starts off; flip it on, then save.
    fireEvent.press(screen.getByTestId('notifications-requests-policy-filterNotFollowers-option-on'))
    fireEvent.press(screen.getByTestId('notifications-requests-policy-save'))
    await waitFor(() => expect(api.updatePolicy).toHaveBeenCalledTimes(1))
    expect(api.updatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({filterNotFollowers: true, filterNotFollowing: true}),
    )
  })

  it('omits unknown (null) switches from the save patch', async () => {
    const {api} = supportedBackend({
      policy: jest.fn(async () => ({...policy(), filterPrivateMentions: null})),
    })
    await renderScreen('mastodon', {notificationRequests: api})
    await screen.findByTestId('notifications-requests-policy-filterPrivateMentions-unknown')
    fireEvent.press(screen.getByTestId('notifications-requests-policy-save'))
    await waitFor(() => expect(api.updatePolicy).toHaveBeenCalledTimes(1))
    const patch = api.updatePolicy.mock.calls[0][0] as Record<string, unknown>
    expect('filterPrivateMentions' in patch).toBe(false)
  })

  it('surfaces row action failures without losing the row', async () => {
    const {api} = supportedBackend({accept: jest.fn(async () => { throw new Error('boom') })})
    await renderScreen('mastodon', {notificationRequests: api})
    fireEvent.press(await screen.findByTestId('notifications-requests-entry'))
    fireEvent.press(await screen.findByTestId('notification-request-accept-701'))
    await waitFor(() => expect(screen.getByText('Could not accept that request.')).toBeTruthy())
    expect(screen.getByTestId('notification-request-701')).toBeTruthy()
  })

  it('hides the entry with a reason on unsupported servers — main list intact', async () => {
    const {api} = supportedBackend({
      isSupported: jest.fn(() => null),
      policy: jest.fn(async () => { throw new ApiError('Not Found', 404) }),
    })
    await renderScreen('mastodon', {notificationRequests: api})
    expect(await screen.findByTestId('notifications-requests-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('notifications-requests-entry')).toBeNull()
    // Filtered items stay visible in the main list: nothing silently vanishes.
    expect(screen.getByTestId('notification-n1')).toBeTruthy()
  })

  it('hides with a reason on Misskey (no member), never an inert entry', async () => {
    await renderScreen('misskey', {})
    expect(await screen.findByTestId('notifications-requests-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('notifications-requests-entry')).toBeNull()
    // The list resolves on its own tick (P6.5: the caption no longer
    // re-renders the screen off cache writes) — await it, never assume.
    expect(await screen.findByTestId('notification-n1')).toBeTruthy()
  })
})
