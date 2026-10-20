import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {Navigation} from '#/Navigation'
import {navigationRef} from '#/navigationRef'
import {i18n} from '#/locale/i18n'

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
}))

// Stub the Settings *screen content* (not the route): this regression test
// pins shell-chrome behaviour — the tab bar staying mounted and the strip
// back working while a stack screen is focused — which is identical for
// every pushed screen. The stub keeps the test green and focused while the
// settings pages are under construction next door.
jest.mock('#/screens/Settings', () => {
  const React = jest.requireActual('react')
  const {View} = jest.requireActual('react-native')
  return {
    SettingsScreen: () => React.createElement(View, {testID: 'settings-screen'}),
  }
})

// Pin the phone layout: the trap is the mobile bottom bar unmounting with
// `Main` while a stack screen (Settings) is focused. Same mock the
// integration suite uses for the mobile shell.
jest.mock('#/alf/useViewportWidth', () => ({
  useViewportWidth: () => 390,
}))

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function renderShell() {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://app.example',
  })
  render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider store={store} homeOrigin="https://app.example">
          <Navigation />
        </SessionProvider>
      </QueryClientProvider>
    </I18nProvider>,
  )
}

function goSettings() {
  act(() => {
    navigationRef.navigate('Settings')
  })
}

describe('Settings escape (regression)', () => {
  it('keeps the tab bar mounted on Settings so a tab always escapes', async () => {
    renderShell()
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    goSettings()
    expect(await screen.findByTestId('settings-screen')).toBeTruthy()
    // Pre-fix the tab bar unmounts with Main here, stranding the user.
    expect(screen.getByTestId('tab-Home')).toBeTruthy()
    fireEvent.press(screen.getByTestId('tab-Home'))
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
  })

  it('the strip back button leaves Settings', async () => {
    renderShell()
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    goSettings()
    expect(await screen.findByTestId('settings-screen')).toBeTruthy()
    fireEvent.press(screen.getByTestId('strip-back'))
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
  })

  it('switches tabs from inside Main', async () => {
    renderShell()
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    fireEvent.press(screen.getByTestId('tab-Explore'))
    expect(await screen.findByText('Explore — not built')).toBeTruthy()
    fireEvent.press(screen.getByTestId('tab-Home'))
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
  })
})
