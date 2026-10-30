// P6.5 Pages slice 2: reader states (loading / error + retry / signed
// out / unsupported), related pages, owner gating via the shared
// components (covered in PageView.test).

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {PageScreen} from './Page'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: {id: 'p1'}}),
  useNavigation: () => ({navigate: jest.fn(), setParams: jest.fn()}),
}))

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

const mockBackends = new Map<string, unknown>()

i18n.load('en', {})
i18n.activate('en')

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function page(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    createdAt: '2026-10-26T12:00:00.000Z',
    updatedAt: '2026-10-26T12:00:00.000Z',
    author: {
      id: 'u1', name: 'Alice', username: 'alice', displayName: 'Alice', host: null,
      avatarUrl: null, avatarBlurhash: null, isBot: false, isCat: false,
      emojis: {}, onlineStatus: 'online',
    },
    title: 'Hello',
    name: 'hello',
    summary: null,
    hideTitleWhenPinned: false,
    alignCenter: false,
    font: 'sans-serif',
    eyeCatchingImageId: null,
    eyeCatchingImage: null,
    attachedFiles: [],
    blocks: [{kind: 'text', id: 'b1', text: 'hi'}],
    likedCount: 2,
    isLiked: false,
    url: 'https://a.example/@alice/pages/hello',
    ...over,
  }
}

function fakeBackend(over: Record<string, unknown> = {}) {
  const pages = {
    show: jest.fn(async () => page()),
    byUser: jest.fn(async () => ({items: [], cursor: null, end: true})),
    featured: jest.fn(async () => []),
    like: jest.fn(async () => undefined),
    unlike: jest.fn(async () => undefined),
    pin: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    ...over,
  }
  return {family: 'misskey', capabilities: {pages: 'supported'}, pages}
}

async function signedInStore() {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://a.example',
  })
  await store.add({
    origin: 'https://a.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-alice',
    grant: 'miauth',
    hosting: 'third-party',
  })
  const sessionId = store.getSnapshot().sessions[0]?.id as string
  return {store, sessionId}
}

function renderScreen(store: unknown, qc = new QueryClient({defaultOptions: {queries: {retry: false}}})) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider store={store as never} homeOrigin="https://a.example">
          <QueryClientProvider client={qc}>
            <PageScreen />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('PageScreen', () => {
  it('shows loading, then the page with actions and related', async () => {
    const {store, sessionId} = await signedInStore()
    const backend = fakeBackend({
      byUser: jest.fn(async () => ({
        items: [page({id: 'p2', title: 'Other'}), page({id: 'p1', title: 'Hello'})],
        cursor: null,
        end: true,
      })),
    })
    mockBackends.set(sessionId, backend)
    try {
      renderScreen(store)
      expect(screen.getByTestId('page-loading')).toBeTruthy()
      expect(await screen.findByTestId('page-view')).toBeTruthy()
      expect(screen.getByTestId('page-actions-p1')).toBeTruthy()
      // The card renders the title twice (title + summary fallback), so
      // assert the card node, not the ambiguous text.
      expect(await screen.findByTestId('page-related-p2')).toBeTruthy()
      expect(screen.getByText('More pages by Alice')).toBeTruthy()
      // Current page excluded from related.
      expect(screen.queryByTestId('page-related-p1')).toBeNull()
    } finally {
      mockBackends.clear()
    }
  })

  it('maps NO_SUCH_PAGE to not-found with retry', async () => {
    const {ApiError} = jest.requireActual('@keystone/fedi') as typeof import('@keystone/fedi')
    const {store, sessionId} = await signedInStore()
    const backend = fakeBackend({
      show: jest.fn(async () => {
        throw new ApiError('nope', 404, 'errors.pages.notFound');
      }),
    })
    mockBackends.set(sessionId, backend)
    try {
      renderScreen(store)
      expect(await screen.findByText('Page not found or not visible.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('page-retry'))
      await waitFor(() => expect(backend.pages.show).toHaveBeenCalledTimes(2))
    } finally {
      mockBackends.clear()
    }
  })

  it('signed-out trees get the sign-in prompt, unsupported gets the reason', async () => {
    const {createSessionStore: createStore} = await import('#/state/session/store')
    const empty = createStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: 'https://a.example',
    })
    const {unmount} = renderScreen(empty)
    expect(screen.getByText('Sign in to see this page.')).toBeTruthy()
    unmount()

    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, {family: 'mastodon', capabilities: {}})
    try {
      renderScreen(store)
      expect(await screen.findByText('Pages are not available on this server.')).toBeTruthy()
    } finally {
      mockBackends.clear()
    }
  })
})
