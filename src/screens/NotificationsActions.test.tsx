// Mastodon dismiss/clear UI (clickstone §1.11). Per-row dismiss and the
// clear-all confirm exist ONLY where the server has the routes; a 404/405
// hides them with an honest reason instead of showing an error wall (and
// Misskey — no dismiss endpoint — never renders them at all).

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {ApiError, createMemoryStore, type Backend, type Notification} from '@keystone/fedi'

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

function notification(id = 'n1'): Notification {
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

async function renderScreen(
  family: 'mastodon' | 'misskey',
  backend: Record<string, unknown>,
) {
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
    notifications: jest.fn(async () => ({items: [notification()], cursor: null, end: true})),
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

describe('NotificationsScreen dismiss/clear (Mastodon)', () => {
  it('dismisses one row through the backend', async () => {
    const dismissNotification = jest.fn(async () => {})
    await renderScreen('mastodon', {
      markNotificationsRead: jest.fn(async () => {}),
      dismissNotification,
      clearNotifications: jest.fn(async () => {}),
    })
    const button = await screen.findByTestId('notification-dismiss-n1')
    fireEvent.press(button)
    await waitFor(() => expect(dismissNotification).toHaveBeenCalledWith('n1'))
  })

  it('confirms before clearing every notification', async () => {
    const clearNotifications = jest.fn(async () => {})
    await renderScreen('mastodon', {
      markNotificationsRead: jest.fn(async () => {}),
      dismissNotification: jest.fn(async () => {}),
      clearNotifications,
    })
    await screen.findByTestId('notification-dismiss-n1')

    // Opening the confirm never clears anything by itself.
    fireEvent.press(screen.getByTestId('notifications-clear'))
    expect(clearNotifications).not.toHaveBeenCalled()
    expect(screen.getByTestId('notifications-clear-confirm')).toBeTruthy()

    fireEvent.press(screen.getByTestId('notifications-clear-cancel'))
    expect(clearNotifications).not.toHaveBeenCalled()
    expect(screen.queryByTestId('notifications-clear-confirm')).toBeNull()

    fireEvent.press(screen.getByTestId('notifications-clear'))
    fireEvent.press(screen.getByTestId('notifications-clear-confirm-action'))
    await waitFor(() => expect(clearNotifications).toHaveBeenCalledTimes(1))
  })

  it('hides dismiss with a reason when the server answers 404', async () => {
    const dismissNotification = jest.fn(async () => {
      throw new ApiError('Not Found', 404)
    })
    await renderScreen('mastodon', {
      markNotificationsRead: jest.fn(async () => {}),
      dismissNotification,
      clearNotifications: jest.fn(async () => {}),
    })
    fireEvent.press(await screen.findByTestId('notification-dismiss-n1'))
    await waitFor(() => expect(screen.getByTestId('notifications-dismiss-unsupported')).toBeTruthy())
    // The actions are HIDDEN once the server proved it lacks the route —
    // never left inert, never an error wall.
    expect(screen.queryByTestId('notification-dismiss-n1')).toBeNull()
  })

  it('hides clear with a reason when the server answers 405', async () => {
    const clearNotifications = jest.fn(async () => {
      throw new ApiError('Method Not Allowed', 405)
    })
    await renderScreen('mastodon', {
      markNotificationsRead: jest.fn(async () => {}),
      dismissNotification: jest.fn(async () => {}),
      clearNotifications,
    })
    await screen.findByTestId('notification-dismiss-n1')
    fireEvent.press(screen.getByTestId('notifications-clear'))
    fireEvent.press(screen.getByTestId('notifications-clear-confirm-action'))
    await waitFor(() => expect(screen.getByTestId('notifications-clear-unsupported')).toBeTruthy())
    expect(screen.queryByTestId('notifications-clear')).toBeNull()
  })

  it('never renders the actions on Misskey (no dismiss endpoint)', async () => {
    await renderScreen('misskey', {
      markNotificationsRead: jest.fn(async () => {}),
    })
    await screen.findByTestId('notification-time-n1')
    expect(screen.queryByTestId('notification-dismiss-n1')).toBeNull()
    expect(screen.queryByTestId('notifications-clear')).toBeNull()
  })
})
