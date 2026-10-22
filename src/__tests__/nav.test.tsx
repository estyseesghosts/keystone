import {getStateFromPath} from '@react-navigation/native'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {getStateFromPathWithBase, linking, Navigation, stripShellBase} from '#/Navigation'
import {
  AUTH_CALLBACK_PATH,
  AUTH_CALLBACK_PATHS,
  callbackCleanHref,
  isAuthCallbackPath,
  LEGACY_AUTH_CALLBACK_PATH,
  linkingScreens,
  paths,
  rewriteLegacyPath,
} from '#/routes'
import {i18n} from '#/locale/i18n'
import {Root} from '#/Root'
import {redirectUriFor} from '#/screens/Login'

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
    expect(await screen.findByText('Sign in to explore.')).toBeTruthy()
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
    for (const name of ['Note', 'Tag', 'List', 'Lists', 'Clip', 'Clips', 'Antenna', 'Antennas', 'Channel', 'Channels', 'Drive', 'Favorites', 'Followers', 'Following', 'FollowRequests', 'ProfileEdit', 'Settings', 'Login', 'AuthCallback', 'KeystoneCallback', 'SysDebug', 'Compose'] as const) {
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

  it('maps the W5 screens to routes', () => {
    const clips = getStateFromPath('/clips', linking.config)
    expect(JSON.stringify(clips)).toMatch(/Clips/)
    const clip = getStateFromPath('/clips/c1', linking.config)
    expect(JSON.stringify(clip)).toMatch(/"id":"c1"/)
    const drive = getStateFromPath('/drive', linking.config)
    expect(JSON.stringify(drive)).toMatch(/Drive/)
    const fav = getStateFromPath('/favorites', linking.config)
    expect(JSON.stringify(fav)).toMatch(/Favorites/)
    const followers = getStateFromPath('/users/u1/followers', linking.config)
    expect(JSON.stringify(followers)).toMatch(/Followers/)
    const section = getStateFromPath('/settings/mutes', linking.config)
    expect(JSON.stringify(section)).toMatch(/Settings/)
    expect(JSON.stringify(section)).toMatch(/mutes/)
    const exploreTab = getStateFromPath('/explore/tags', linking.config)
    expect(JSON.stringify(exploreTab)).toMatch(/Explore/)
    expect(JSON.stringify(exploreTab)).toMatch(/tags/)
    const channels = getStateFromPath('/channels', linking.config)
    expect(JSON.stringify(channels)).toMatch(/Channels/)
    const channel = getStateFromPath('/channels/ch1', linking.config)
    expect(JSON.stringify(channel)).toMatch(/Channel/)
    expect(JSON.stringify(channel)).toMatch(/"id":"ch1"/)
  })

  it('routes the edit-history screen under the note (clickstone §1.7)', () => {
    const history = getStateFromPath('/notes/p1/history', linking.config)
    expect(JSON.stringify(history)).toMatch(/NoteHistory/)
    expect(JSON.stringify(history)).toMatch(/"id":"p1"/)
    // The plain note route still wins for its own path.
    const note = getStateFromPath('/notes/p1', linking.config)
    expect(JSON.stringify(note)).toMatch(/"name":"Note"/)
    expect((linkingScreens() as Record<string, string>).NoteHistory).toBe('notes/:id/history')
  })

  it('accepts both the canonical and the v1 root OAuth callback paths (clickstone §1.13)', () => {
    const canonical = getStateFromPath('/auth/callback?code=c1&state=s1', linking.config)
    expect(JSON.stringify(canonical)).toMatch(/AuthCallback/)
    expect(JSON.stringify(canonical)).toMatch(/"code":"c1"/)
    expect(JSON.stringify(canonical)).toMatch(/"state":"s1"/)

    // v1's root-base callback URL: a real route (same screen), not a
    // rewrite — the alias keeps the URL the instance was registered with.
    const legacy = getStateFromPath('/keystone/callback?code=c1&state=s1', linking.config)
    expect(JSON.stringify(legacy)).toMatch(/KeystoneCallback/)
    expect(JSON.stringify(legacy)).toMatch(/"code":"c1"/)

    expect(paths.AuthCallback).toBe(AUTH_CALLBACK_PATH)
    expect(paths.KeystoneCallback).toBe(LEGACY_AUTH_CALLBACK_PATH)
    expect((linkingScreens() as Record<string, string>).KeystoneCallback).toBe('keystone/callback')

    // Neither callback is a legacy rewrite target.
    for (const path of AUTH_CALLBACK_PATHS) {
      expect(rewriteLegacyPath(path)).toBe(path)
    }
    expect(isAuthCallbackPath('/keystone/callback')).toBe(true)
    expect(isAuthCallbackPath('/auth/callback?code=c1')).toBe(true)
    // The base-prefixed canonical form is NOT itself a callback path: it
    // strips to the canonical path first, so it is not double-handled.
    expect(isAuthCallbackPath('/keystone/auth/callback')).toBe(false)
  })

  it('resolves either callback under a deployed base without mangling it', () => {
    for (const path of [
      '/auth/callback?code=c1&state=s1',
      '/keystone/auth/callback?code=c1&state=s1',
    ]) {
      const state = getStateFromPathWithBase(path, '/keystone/', linking.config)
      expect(JSON.stringify(state)).toMatch(/AuthCallback/)
      expect(JSON.stringify(state)).toMatch(/"code":"c1"/)
    }
    // The v1 root URL survives a base whose own prefix is `/keystone`
    // (stripping would otherwise leave `/callback`, which matches nothing).
    const legacy = getStateFromPathWithBase('/keystone/callback?code=c1&state=s1', '/keystone/', linking.config)
    expect(JSON.stringify(legacy)).toMatch(/KeystoneCallback/)
    expect(JSON.stringify(legacy)).toMatch(/"code":"c1"/)
    // Base stripping leaves the callback path alone (no double-prefix), and
    // the stripped-away `/callback` shape resolves to nothing.
    expect(stripShellBase('/keystone/callback', '/keystone/')).toBe('/keystone/callback')
    expect(getStateFromPath('/callback', linking.config)).toBeUndefined()
  })

  it('cleans the callback URL after the exchange for both paths', () => {
    expect(callbackCleanHref('https://app.example/auth/callback?code=c1&state=s1')).toBe('/auth/callback')
    expect(callbackCleanHref('https://app.example/keystone/callback?code=c1&state=s1')).toBe(
      '/keystone/callback',
    )
    // The deploy base stays in the address bar (the app is mounted there).
    expect(callbackCleanHref('https://app.example/keystone/auth/callback?code=c1#frag')).toBe(
      '/keystone/auth/callback',
    )
    // Unusable URL → the canonical path, never a URL carrying the code.
    expect(callbackCleanHref(null)).toBe(AUTH_CALLBACK_PATH)
  })

  it('registers one stable callback URI for login (no path change)', () => {
    // Native (jest runs the iOS preset): the app-scheme URL for the
    // canonical path; web composition is asserted in LoginFlows.test.ts.
    expect(redirectUriFor()).toBe('keystone://auth/callback')
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
