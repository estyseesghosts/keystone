// Favorites screen: signed-out, unsupported, and the bookmarked posts
// through the real FeedView (`bookmarks` descriptor → `bookmarks.list`
// rows mapped to posts by `fetchFeedPage`).

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {makePost} from '#/components/__tests__/fixtures'

import {FavoritesScreen} from './Favorites'

const mockNavigate = jest.fn()
const mockGoBack = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => mockCanGoBack}),
}))

let mockCanGoBack = true

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

async function setup({backend}: {backend?: any} = {}, locale: 'en' | 'fr' = 'en') {
  mockNavigate.mockClear()
  mockGoBack.mockClear()
  mockCanGoBack = true
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = backend ?? null
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  if (backend) {
    await sessionStore.add({
      origin: ORIGIN,
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'password',
      hosting: 'third-party',
    })
  }
  i18n.load('en', {})
  i18n.activate(locale)
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
            <FavoritesScreen />
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

const post = makePost({id: 'p1', content: {mfm: 'saved post', plain: 'saved post'}})

const fullBackend = () => ({
  family: 'misskey',
  capabilities: {bookmarks: 'supported'},
  bookmarks: {
    list: jest.fn(async () => ({items: [{id: 'r1', post}], cursor: null, end: true})),
  },
})

describe('Favorites screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see your favorites.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without a bookmarks module', async () => {
    const {done} = await setup({backend: {family: 'misskey', capabilities: {}}})
    try {
      expect(await screen.findByText('Favourites are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('renders the bookmarked posts', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('saved post')).toBeTruthy()
      expect(backend.bookmarks.list).toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('renders signed-out chrome through the catalog (translated)', async () => {
    i18n.load('fr', {'favorites.signedOut': 'FR_SIGN_IN_FAVORITES'})
    const {done} = await setup({}, 'fr')
    try {
      expect(await screen.findByText('FR_SIGN_IN_FAVORITES')).toBeTruthy()
    } finally {
      i18n.activate('en')
      done()
    }
  })

  it('header shows Favourites + Saved posts (Misskey)', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Favourites')).toBeTruthy()
      expect(screen.getByText('Saved posts')).toBeTruthy()
      expect(backend.bookmarks.list).toHaveBeenCalled()
      // No clips/* traffic on this screen.
      expect((backend as {clips?: unknown}).clips).toBeUndefined()
    } finally {
      done()
    }
  })

  it('back button returns to Clips', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      mockCanGoBack = true
      fireEvent.press(await screen.findByTestId('favorites-back-clips'))
      expect(mockGoBack).toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('buildRemoveFromFavourites removes and invalidates only the bookmarks feed', async () => {
    const {QueryClient} = await import('@tanstack/react-query')
    const {buildRemoveFromFavourites} = await import('./Favorites')
    const {feedQueryKey} = await import('#/state/queries/keys')
    const remove = jest.fn(async () => undefined)
    const backend = {family: 'misskey', capabilities: {}, bookmarks: {remove}}
    const qc = new QueryClient()
    qc.setQueryData(feedQueryKey('s1', 'bookmarks'), {pages: []})
    qc.setQueryData(feedQueryKey('s1', 'timeline|home'), {pages: []})
    const row = buildRemoveFromFavourites({
      backend: backend as never,
      queryClient: qc,
      sessionId: 's1',
      descriptor: 'bookmarks' as never,
      mastodon: false,
    })
    expect(row.label).toBe('Remove from Favourites')
    await row.run({id: 'p9'} as never)
    expect(remove).toHaveBeenCalledWith('p9')
    expect(qc.getQueryState(feedQueryKey('s1', 'bookmarks'))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(feedQueryKey('s1', 'timeline|home'))?.isInvalidated).not.toBe(true)
    const bm = buildRemoveFromFavourites({
      backend: backend as never,
      queryClient: qc,
      sessionId: 's1',
      descriptor: 'bookmarks' as never,
      mastodon: true,
    })
    expect(bm.label).toBe('Remove from Bookmarks')
  })
})
