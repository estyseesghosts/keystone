// Network tab visibility follows the reader's feed prefs reactively: a
// mounted screen re-renders when Settings → Feeds toggles change (P2).

import {act, render, screen} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {feedPrefsStore} from '#/state/feedPrefs'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {NetworkScreen} from './Network'

const mockRouteHolder: {current: {params?: unknown}} = {current: {}}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn(), setParams: jest.fn()}),
  useRoute: () => mockRouteHolder.current,
}))

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

async function setup() {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  // Known prefs baseline (the store singleton caches per test file).
  feedPrefsStore.set({showLocal: false, showFederated: true})
  mockBackendHolder.current = {
    family: 'misskey',
    timeline: jest.fn(async () => ({items: [], cursor: null, end: true})),
  }
  mockRouteHolder.current = {}
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  await sessionStore.add({
    origin: 'https://m.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-alice',
    grant: 'password',
    hosting: 'third-party',
  })
  const rendered = render(
    <ThemeProvider theme="light">
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          <NetworkScreen />
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return {
    done: () => {
      rendered.unmount()
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
      mockRouteHolder.current = {}
    },
  }
}

describe('NetworkScreen feed prefs (P2)', () => {
  it('shows Social + Federated tabs by default on the Misskey family', async () => {
    const {done} = await setup()
    try {
      expect(await screen.findByTestId('network-screen')).toBeTruthy()
      expect(screen.getByTestId('network-tab-social')).toBeTruthy()
      expect(screen.getByTestId('network-tab-federated')).toBeTruthy()
      expect(screen.queryByTestId('network-tab-local')).toBeNull()
    } finally {
      done()
    }
  })

  it('re-renders a mounted screen when the store changes', async () => {
    const {done} = await setup()
    try {
      expect(await screen.findByTestId('network-tab-federated')).toBeTruthy()
      // The same call FeedsSection makes on toggle — the mounted tab bar
      // must follow without remounting.
      act(() => {
        feedPrefsStore.set({showFederated: false})
      })
      expect(screen.queryByTestId('network-tab-federated')).toBeNull()
      expect(screen.getByTestId('network-tab-social')).toBeTruthy()
      act(() => {
        feedPrefsStore.set({showLocal: true})
      })
      expect(screen.getByTestId('network-tab-local')).toBeTruthy()
    } finally {
      done()
    }
  })
})
