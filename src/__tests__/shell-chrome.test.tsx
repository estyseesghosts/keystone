import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {
  clearFeedScrolls,
  feedScrollKey,
  getStateFromPathWithBase,
  goBackOrFeed,
  lastFeedTabName,
  linking,
  Navigation,
  normalizeShellBase,
  readFeedScroll,
  recordFeedVisit,
  resetLastFeed,
  saveFeedScroll,
  stripShellBase,
} from '#/Navigation'
import {navigationRef} from '#/navigationRef'
import {Pagehead} from '#/components/Pagehead'
import {i18n} from '#/locale/i18n'
import {paths} from '#/routes'

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
}))

// Switchable shell width: mobile (390) vs full desktop (1280).
const widthHolder: {width: number} = {width: 390}
jest.mock('#/alf/useViewportWidth', () => ({
  useViewportWidth: () => widthHolder.width,
}))

// Stub stack-screen content (not the routes): this file pins shell chrome,
// not screen internals.
jest.mock('#/screens/Settings', () => {
  const React = jest.requireActual('react')
  const {View} = jest.requireActual('react-native')
  return {
    SettingsScreen: () => React.createElement(View, {testID: 'settings-screen'}),
  }
})

jest.mock('#/screens/User', () => {
  const React = jest.requireActual('react')
  const {View} = jest.requireActual('react-native')
  return {
    UserScreen: () => React.createElement(View, {testID: 'user-screen'}),
  }
})

jest.mock('#/screens/Drive', () => {
  const React = jest.requireActual('react')
  const {View} = jest.requireActual('react-native')
  return {
    DriveScreen: () => React.createElement(View, {testID: 'drive-screen'}),
  }
})

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function renderShell(options?: {
  signedIn?: boolean
  family?: 'mastodon' | 'misskey'
  initialState?: {routes: {name: string}[]}
}) {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://app.example',
  })
  const family = options?.family ?? 'mastodon'
  const ready = options?.signedIn
    ? store.add({
        origin: `https://${family}.example`,
        family,
        flavor: family,
        accountId: 'alice',
        token: 'token-a',
        grant: family === 'mastodon' ? 'oauth-pkce' : 'miauth',
        hosting: 'third-party',
      })
    : Promise.resolve()
  return ready.then(() => {
    render(
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <SessionProvider store={store} homeOrigin="https://app.example">
            <Navigation initialState={options?.initialState} />
          </SessionProvider>
        </QueryClientProvider>
      </I18nProvider>,
    )
    return store
  })
}

beforeEach(() => {
  widthHolder.width = 390
  resetLastFeed()
  clearFeedScrolls()
})

describe('base-path hosting (N13)', () => {
  it('normalizes bases to the no-trailing-slash form', () => {
    expect(normalizeShellBase(null)).toBe('/')
    expect(normalizeShellBase('/')).toBe('/')
    expect(normalizeShellBase('/keystone/')).toBe('/keystone')
    expect(normalizeShellBase('keystone')).toBe('/keystone')
  })

  it('strips a non-root base before parsing, root passes through', () => {
    expect(stripShellBase('/notes/abc', '/')).toBe('/notes/abc')
    expect(stripShellBase('/keystone/notes/abc', '/keystone/')).toBe('/notes/abc')
    expect(stripShellBase('/keystone', '/keystone/')).toBe('/')
    expect(stripShellBase('/other/x', '/keystone/')).toBe('/other/x')
  })

  it('resolves deep links under two different base paths', () => {
    for (const base of ['/keystone/', '/app/sub/']) {
      const state = getStateFromPathWithBase(`${normalizeShellBase(base)}/notes/abc`, base, linking.config)
      expect(JSON.stringify(state)).toMatch(/Note/)
      expect(JSON.stringify(state)).toMatch(/"id":"abc"/)
      const home = getStateFromPathWithBase(normalizeShellBase(base), base, linking.config)
      expect(JSON.stringify(home)).toMatch(/Home/)
    }
  })

  it('falls back to root behavior when the base is unresolved', () => {
    const state = getStateFromPathWithBase('/notes/abc', null, linking.config)
    expect(JSON.stringify(state)).toMatch(/"id":"abc"/)
  })

  it('rewrites legacy paths after stripping the base', () => {
    const state = getStateFromPathWithBase('/keystone/local', '/keystone/', linking.config)
    expect(JSON.stringify(state)).toMatch(/Network/)
    expect(JSON.stringify(state)).toMatch(/local/)
  })
})

describe('last-feed fallback + scroll memory (N14)', () => {
  it('falls back to Home when a deep-linked stack has no back history', async () => {
    await renderShell({initialState: {routes: [{name: 'SysDebug'}]}})
    expect(await screen.findByTestId('sys-debug-light')).toBeTruthy()
    expect(navigationRef.canGoBack()).toBe(false)
    fireEvent.press(screen.getByTestId('strip-back'))
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
  })

  it('goes back normally when history exists', async () => {
    await renderShell()
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    act(() => {
      navigationRef.navigate('Settings')
    })
    expect(await screen.findByTestId('settings-screen')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-back'))
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
  })

  it('tracks the last visited feed tab', () => {
    expect(lastFeedTabName()).toBe('Home')
    recordFeedVisit({name: 'Network'})
    expect(lastFeedTabName()).toBe('Network')
    recordFeedVisit({name: 'Note'})
    expect(lastFeedTabName()).toBe('Network')
    expect(goBackOrFeed).toBeDefined()
  })

  it('scopes scroll offsets per session + descriptor', () => {
    const a = feedScrollKey('sess-a', 'timeline|home')
    const b = feedScrollKey('sess-b', 'timeline|home')
    expect(readFeedScroll(a)).toBeUndefined()
    saveFeedScroll(a, 420)
    expect(readFeedScroll(a)).toBe(420)
    expect(readFeedScroll(b)).toBeUndefined()
    clearFeedScrolls()
    expect(readFeedScroll(a)).toBeUndefined()
  })
})

describe('pagehead back affordance (N15)', () => {
  it('renders a back control on rail/full layouts, hidden on mobile', () => {
    widthHolder.width = 1280
    const desktop = render(<Pagehead title="Post" />)
    expect(desktop.getByTestId('pagehead-back')).toBeTruthy()
    desktop.unmount()
    widthHolder.width = 390
    render(<Pagehead title="Post" />)
    // Mobile layout renders nothing (the strip owns the title + back).
    expect(screen.queryByTestId('pagehead-back')).toBeNull()
  })
})

describe('account menu (N16)', () => {
  it('opens a menu with profile + settings entries, profile lands on User', async () => {
    widthHolder.width = 390
    await renderShell({signedIn: true})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-account'))
    expect(screen.getByTestId('strip-account-menu')).toBeTruthy()
    expect(screen.getByTestId('strip-account-menu-profile')).toBeTruthy()
    expect(screen.getByTestId('strip-account-menu-settings')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-account-menu-profile'))
    expect(await screen.findByTestId('user-screen')).toBeTruthy()
  })

  it('settings entry lands on Settings', async () => {
    widthHolder.width = 390
    await renderShell({signedIn: true})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-account'))
    fireEvent.press(screen.getByTestId('strip-account-menu-settings'))
    expect(await screen.findByTestId('settings-screen')).toBeTruthy()
  })

  it('signed-out strip keeps the sign-in entry (no menu)', async () => {
    widthHolder.width = 390
    await renderShell()
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    expect(screen.getByTestId('strip-signin')).toBeTruthy()
    expect(screen.queryByTestId('strip-account')).toBeNull()
  })

  // 0.9 — messaging is gated, not invisible: the entry is discoverable in
  // the account menu on BOTH families, disabled, and says why (client gap).
  // There is deliberately no route behind it yet.
  it('carries a disabled Messages entry with the client-gap reason (mastodon)', async () => {
    widthHolder.width = 390
    await renderShell({signedIn: true, family: 'mastodon'})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-account'))
    const row = screen.getByTestId('strip-account-menu-messages')
    expect(row.props.accessibilityState.disabled).toBe(true)
    expect(row.props.accessibilityLabel).toMatch(/Messaging is not implemented in Keystone yet/i)
    expect(Object.keys(paths)).not.toContain('Messages')
  })

  it('carries the same disabled Messages entry on a Misskey session', async () => {
    widthHolder.width = 390
    await renderShell({signedIn: true, family: 'misskey'})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-account'))
    const row = screen.getByTestId('strip-account-menu-messages')
    expect(row.props.accessibilityState.disabled).toBe(true)
    expect(row.props.accessibilityLabel).toMatch(/not on your server/i)
  })
})

describe('stack destinations (E7 nav)', () => {
  it('mastodon sidebar hides Drive + Antennas (family gate)', async () => {
    widthHolder.width = 1280
    await renderShell({signedIn: true, family: 'mastodon'})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    expect(screen.queryByTestId('sidebar-drive')).toBeNull()
    expect(screen.queryByTestId('sidebar-antennas')).toBeNull()
  })

  it('misskey sidebar shows Drive + Antennas and Drive lands on the page', async () => {
    widthHolder.width = 1280
    await renderShell({signedIn: true, family: 'misskey'})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    expect(screen.getByTestId('sidebar-drive')).toBeTruthy()
    expect(screen.getByTestId('sidebar-antennas')).toBeTruthy()
    fireEvent.press(screen.getByTestId('sidebar-drive'))
    expect(await screen.findByTestId('drive-screen')).toBeTruthy()
  })

  it('misskey sidebar shows Channels (capability + module gate)', async () => {
    widthHolder.width = 1280
    await renderShell({signedIn: true, family: 'misskey'})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    expect(screen.getByTestId('sidebar-channels')).toBeTruthy()
  })

  it('mastodon sidebar hides Channels', async () => {
    widthHolder.width = 1280
    await renderShell({signedIn: true, family: 'mastodon'})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    expect(screen.queryByTestId('sidebar-channels')).toBeNull()
  })

  it('misskey account menu carries Drive (mobile entry point)', async () => {
    widthHolder.width = 390
    await renderShell({signedIn: true, family: 'misskey'})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-account'))
    expect(screen.getByTestId('strip-account-menu-drive')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-account-menu-drive'))
    expect(await screen.findByTestId('drive-screen')).toBeTruthy()
  })

  it('mastodon account menu hides Drive', async () => {
    widthHolder.width = 390
    await renderShell({signedIn: true, family: 'mastodon'})
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-account'))
    expect(screen.queryByTestId('strip-account-menu-drive')).toBeNull()
  })
})
