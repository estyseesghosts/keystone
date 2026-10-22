// Home inline composer separator (P6.4): a bordered wrapper bounds the
// inline composer from the first post once the feed loads; nothing
// renders signed out (no composer, no separator).

import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {makePost} from '#/components/__tests__/fixtures'

import {HomeScreen} from './Home'

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

jest.mock('#/components/Composer/CompactComposer', () => {
  const React = jest.requireActual('react')
  const {View} = jest.requireActual('react-native')
  return {
    CompactComposer: () => React.createElement(View, {testID: 'stub-composer'}),
  }
})

// ComposeFab owns its own navigation hook and is shell chrome, not the
// separator under test.
jest.mock('#/components/ComposeFab', () => {
  const React = jest.requireActual('react')
  const {View} = jest.requireActual('react-native')
  return {
    ComposeFab: () => React.createElement(View, {testID: 'stub-fab'}),
  }
})

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

async function setup({signedIn, timeline}: {signedIn: boolean; timeline?: () => Promise<unknown>}) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = timeline ? {timeline, capabilities: {}} : null
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  if (signedIn) {
    await sessionStore.add({
      origin: 'https://m.example',
      family: 'mastodon',
      flavor: 'mastodon',
      accountId: 'alice',
      token: 'token-a',
      grant: 'oauth-pkce',
      hosting: 'third-party',
    })
  }
  const {i18n} = await import('#/locale/i18n')
  i18n.load('en', {})
  i18n.activate('en')
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
            <HomeScreen />
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    },
  }
}

describe('Home inline composer separator', () => {
  it('bounds the composer from the feed once loaded', async () => {
    const post = makePost({id: 'p1', content: {mfm: 'hello', plain: 'hello'}})
    const {done} = await setup({
      signedIn: true,
      timeline: () => Promise.resolve({items: [post], cursor: null, end: true}),
    })
    try {
      expect(await screen.findByText('hello')).toBeTruthy()
      expect(screen.getByTestId('home-composer-separator')).toBeTruthy()
      expect(screen.getByTestId('stub-composer')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('renders no separator signed out', async () => {
    const {done} = await setup({signedIn: false})
    try {
      expect(await screen.findByTestId('home-screen')).toBeTruthy()
      expect(screen.queryByTestId('home-composer-separator')).toBeNull()
    } finally {
      done()
    }
  })
})
