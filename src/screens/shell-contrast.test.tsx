// Shell contrast regression (contrast sweep, stream C): every
// pull-to-refresh spinner resolves to the theme palette in BOTH themes,
// and the modal scrims stay fixed-black in both themes while their cards
// follow the theme background. Guards black-on-dark / white-on-light
// regressions in the screens/shell layer.

import {render, screen} from '@testing-library/react-native'
import {FlatList, StyleSheet} from 'react-native'

import {createMemoryStore} from '@keystone/fedi'

import {overlayChrome, themes, type ThemeName} from '#/alf/themes'
import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {ListsScreen} from './Lists'
import {ProfileEditorScreen} from './ProfileEditor'

const mockNavigate = jest.fn()
const mockGoBack = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useRoute: () => ({params: {}}),
}))

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

const HOME_ORIGIN = 'https://app.example'
const ORIGIN = 'https://m.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

async function renderWithSession(ui: React.ReactElement, theme: ThemeName) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  await sessionStore.add({
    origin: ORIGIN,
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-alice',
    grant: 'password',
    hosting: 'third-party',
  })
  render(
    <ThemeProvider theme={theme}>
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        {ui}
      </SessionProvider>
    </ThemeProvider>,
  )
  return () => {
    __setStorageForTests({storage: restore})
    mockBackendHolder.current = null
  }
}

async function renderSignedOut(ui: React.ReactElement, theme: ThemeName) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = null
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  render(
    <ThemeProvider theme={theme}>
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        {ui}
      </SessionProvider>
    </ThemeProvider>,
  )
  return () => {
    __setStorageForTests({storage: restore})
  }
}

const fullBackend = () => ({
  family: 'misskey',
  capabilities: {lists: 'supported'},
  lists: {
    list: jest.fn(async () => [{id: 'l1', name: 'Friends'}]),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(async () => undefined),
  },
})

describe.each(['light', 'dark'] as const)('shell contrast (%s theme)', theme => {
  it('themes the Lists pull-to-refresh spinner to the palette', async () => {
    mockBackendHolder.current = fullBackend()
    const done = await renderWithSession(<ListsScreen />, theme)
    try {
      // Wait for the loaded branch (the refresh control only mounts there).
      await screen.findByText('Friends')
      const list = screen.UNSAFE_getByType(FlatList)
      const refresh = list.props.refreshControl.props as {
        tintColor?: string
        colors?: string[]
        progressBackgroundColor?: string
      }
      expect(refresh.tintColor).toBe(themes[theme].palette.muted)
      expect(refresh.colors).toEqual([themes[theme].palette.muted])
      expect(refresh.progressBackgroundColor).toBe(themes[theme].palette.bg)
    } finally {
      done()
    }
  })

  it('keeps the ProfileEditor scrim fixed while the card follows the theme', async () => {
    const done = await renderSignedOut(<ProfileEditorScreen />, theme)
    try {
      // Signed out renders the overlay shell: backdrop + card, no backend.
      const backdrop = await screen.findByTestId('profile-editor-backdrop')
      const card = await screen.findByTestId('profile-editor-card')
      const backdropStyle = StyleSheet.flatten(backdrop.props.style)
      const cardStyle = StyleSheet.flatten(card.props.style)
      // Fixed light-on-dark chrome: identical in both themes.
      expect(backdropStyle.backgroundColor).toBe(overlayChrome.backdrop)
      // Paired background: the card always matches the theme surface.
      expect(cardStyle.backgroundColor).toBe(themes[theme].palette.bg)
    } finally {
      done()
    }
  })
})
