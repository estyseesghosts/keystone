// News discussions screen: the `search|<url>` feed of posts referencing
// the article, plus signed-out and bad-link honest states.

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

import {NewsDiscussionsScreen} from './NewsDiscussions'

const mockBackendHolder: {current: any} = {current: null}
const mockRouteParams: {current: {url?: string; title?: string} | undefined} = {current: undefined}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: mockRouteParams.current}),
}))

const HOME_ORIGIN = 'https://app.example'
const ORIGIN = 'https://m.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

async function setup({backend, params}: {backend?: any; params?: {url?: string; title?: string}} = {}) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = backend ?? null
  mockRouteParams.current = params
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  if (backend) {
    await sessionStore.add({
      origin: ORIGIN,
      family: 'mastodon',
      flavor: 'mastodon',
      accountId: 'alice',
      token: 'token-alice',
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
            <NewsDiscussionsScreen />
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
      mockRouteParams.current = undefined
    },
  }
}

const post = makePost({id: 'p1', content: {mfm: 'discussing https://n.example/1', plain: 'discussing'}})

const fullBackend = (searchPosts: jest.Mock) => ({
  family: 'mastodon',
  capabilities: {},
  search: {posts: searchPosts},
})

describe('NewsDiscussions screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup({params: {url: 'https://n.example/1', title: 'Big news'}})
    try {
      expect(await screen.findByText('Sign in to see the discussion.')).toBeTruthy()
      expect(screen.queryByTestId('news-discussions-feed')).toBeNull()
    } finally {
      done()
    }
  })

  it('is honest about an unsafe link', async () => {
    const searchPosts = jest.fn(async () => ({items: [], cursor: null, end: true}))
    const {done} = await setup({backend: fullBackend(searchPosts), params: {url: 'not a url'}})
    try {
      expect(await screen.findByText('This link is not available.')).toBeTruthy()
      expect(searchPosts).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('loads every post referencing the link', async () => {
    const searchPosts = jest.fn(async () => ({items: [post], cursor: null, end: true}))
    const {done} = await setup({
      backend: fullBackend(searchPosts),
      params: {url: 'https://n.example/1', title: 'Big news'},
    })
    try {
      expect(await screen.findByText('Big news')).toBeTruthy()
      // The referenced URL renders as a shortened chip, not raw text.
      expect(screen.getByText('n.example/1')).toBeTruthy()
      expect(searchPosts).toHaveBeenCalledWith('https://n.example/1', expect.anything())
    } finally {
      done()
    }
  })
})
