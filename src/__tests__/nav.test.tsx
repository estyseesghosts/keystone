import {getStateFromPath} from '@react-navigation/native'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {linking, Navigation} from '#/Navigation'
import {linkingScreens, paths, rewriteLegacyPath} from '#/routes'
import {i18n} from '#/locale/i18n'
import {Root} from '#/Root'

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
}))

// Pin the phone shell (the primary target). Jest's default window (750px)
// is the rail cut point, where tab entries render as icons without labels.
jest.mock('#/alf/useViewportWidth', () => ({
  useViewportWidth: () => 390,
}))

// Seed for the plan §3.3 provider-regression guard: the app boots and
// renders. Slice 3.4 replaced the Home placeholder with the real Home
// screen (signed-out honest state); fixture-backed tests land per slice.
describe('App', () => {
  it('boots into the Home screen', async () => {
    render(<Root />)
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
  })
})

describe('Navigation', () => {
  it('switches tabs', async () => {
    render(<Root />)
    fireEvent.press(await screen.findByTestId('tab-Explore'))
    expect(await screen.findByText('Explore — not built')).toBeTruthy()
  })

  it('maps Keystone URLs to routes', () => {
    const sys = getStateFromPath('/sys/debug', linking.config)
    expect(JSON.stringify(sys)).toMatch(/SysDebug/)

    const note = getStateFromPath('/notes/abc', linking.config)
    expect(JSON.stringify(note)).toMatch(/"id":"abc"/)

    const network = getStateFromPath('/network/social', linking.config)
    expect(JSON.stringify(network)).toMatch(/Network/)
    expect(JSON.stringify(network)).toMatch(/social/)
  })

  it('routes the canonical federated tab and aliases the old global name', () => {
    const fed = getStateFromPath('/network/federated', linking.config)
    expect(JSON.stringify(fed)).toMatch(/Network/)
    expect(JSON.stringify(fed)).toMatch(/federated/)

    // Pre-W1 `/network/global` still resolves, as federated.
    const old = getStateFromPath('/network/global', linking.config)
    expect(JSON.stringify(old)).toMatch(/Network/)
    // The alias normalizes at the screen layer (`networkTabFromParam`);
    // the link layer keeps the raw param so existing URLs resolve.
    expect(JSON.stringify(old)).toMatch(/global/)
  })

  it('redirects legacy sidebar and search URLs to their canonical targets', () => {
    const local = linking.getStateFromPath?.('/local', linking.config)
    expect(JSON.stringify(local)).toMatch(/Network/)
    expect(JSON.stringify(local)).toMatch(/local/)

    const social = linking.getStateFromPath?.('/social', linking.config)
    expect(JSON.stringify(social)).toMatch(/Network/)
    expect(JSON.stringify(social)).toMatch(/social/)

    const global = linking.getStateFromPath?.('/global', linking.config)
    expect(JSON.stringify(global)).toMatch(/Network/)
    expect(JSON.stringify(global)).toMatch(/federated/)

    const search = linking.getStateFromPath?.('/search', linking.config)
    expect(JSON.stringify(search)).toMatch(/Explore/)

    const tagged = linking.getStateFromPath?.('/search?tag=cats', linking.config)
    expect(JSON.stringify(tagged)).toMatch(/Explore/)
    expect(JSON.stringify(tagged)).toMatch(/cats/)
  })

  it('derives every linking leaf from the canonical paths table (no drift)', () => {
    const strip = (p: string) => (p === '/' ? '' : p.replace(/^\//, ''))
    const screens = linkingScreens() as Record<string, unknown>
    const main = (screens.Main as {screens: Record<string, string>}).screens
    for (const name of ['Home', 'Network', 'Explore', 'Notifications', 'User'] as const) {
      expect(main[name]).toBe(strip(paths[name]))
    }
    for (const name of ['Note', 'Tag', 'List', 'Settings', 'Login', 'AuthCallback', 'SysDebug', 'Compose'] as const) {
      expect(screens[name]).toBe(strip(paths[name]))
    }
    // Legacy rewrites land on canonical paths table entries.
    expect(rewriteLegacyPath('/local')).toBe('/network/local')
    expect(rewriteLegacyPath('/social')).toBe('/network/social')
    expect(rewriteLegacyPath('/global')).toBe('/network/federated')
    expect(rewriteLegacyPath('/search')).toBe('/explore')
    expect(rewriteLegacyPath('/search?tag=cats')).toBe('/explore?tag=cats')
    expect(rewriteLegacyPath('/network/federated')).toBe('/network/federated')
  })

  it('accepts an initial state (deep-link landing)', () => {
    render(
      <I18nProvider i18n={i18n}>
        <Navigation
          initialState={{
            routes: [{name: 'SysDebug'}],
          }}
        />
      </I18nProvider>,
    )
    expect(screen.getByTestId('sys-debug-light')).toBeTruthy()
  })
})
