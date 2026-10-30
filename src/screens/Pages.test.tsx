// P6.5 Pages slice 3: index tabs per flavor, empty states, paging,
// new-page entry, signed-out/unsupported.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore, type Backend} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {PagesScreen} from './Pages'

const mockNavigate = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate}),
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
    hasLegacyScript: false,
    url: 'https://a.example/@alice/pages/hello',
    ...over,
  }
}

function pagesMod(over: Record<string, unknown> = {}) {
  return {
    show: jest.fn(async () => page()),
    byUser: jest.fn(async () => ({items: [], cursor: null, end: true})),
    featured: jest.fn(async () => []),
    mine: jest.fn(async () => ({items: [], cursor: null, end: true})),
    liked: jest.fn(async () => ({items: [], cursor: null, end: true})),
    like: jest.fn(async () => undefined),
    unlike: jest.fn(async () => undefined),
    pin: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    ...over,
  }
}

function fakeBackend(pages?: Record<string, unknown> | null, family = 'misskey') {
  return {family, capabilities: {pages: 'supported'}, ...(pages ? {pages} : {})} as unknown as Backend
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
            <PagesScreen />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('PagesScreen', () => {
  beforeEach(() => mockNavigate.mockClear())

  it('misskey: featured loads, tabs switch to mine/liked with empty states', async () => {
    const {store, sessionId} = await signedInStore()
    const pages = pagesMod({
      featured: jest.fn(async () => [page({id: 'f1', title: 'Feat'})]),
    })
    mockBackends.set(sessionId, fakeBackend(pages))
    try {
      renderScreen(store)
      expect(await screen.findByTestId('pages-featured-f1')).toBeTruthy()
      fireEvent.press(screen.getByTestId('pages-tab-mine'))
      expect(await screen.findByText("You haven't created any pages yet.")).toBeTruthy()
      fireEvent.press(screen.getByTestId('pages-tab-liked'))
      expect(await screen.findByText("You haven't liked any pages yet.")).toBeTruthy()
    } finally {
      mockBackends.clear()
    }
  })

  it('pages mine through the cursor', async () => {
    const {store, sessionId} = await signedInStore()
    const mine: jest.Mock = jest.fn(async () => ({items: [], cursor: null, end: true}))
    mine
      .mockResolvedValueOnce({items: [page({id: 'm1', title: 'Mine1'})], cursor: 'c1', end: false})
      .mockResolvedValueOnce({items: [page({id: 'm2', title: 'Mine2'})], cursor: null, end: true})
    mockBackends.set(sessionId, fakeBackend(pagesMod({mine})))
    try {
      renderScreen(store)
      fireEvent.press(screen.getByTestId('pages-tab-mine'))
      expect(await screen.findByTestId('pages-mine-m1')).toBeTruthy()
      expect(mine).toHaveBeenCalledWith({cursor: undefined, limit: 20})
    } finally {
      mockBackends.clear()
    }
  })

  it('new button opens the editor', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, fakeBackend(pagesMod()))
    try {
      renderScreen(store)
      expect(await screen.findByTestId('pages-featured-empty')).toBeTruthy()
      fireEvent.press(screen.getByTestId('pages-new'))
      expect(mockNavigate).toHaveBeenCalledWith('PageEdit')
    } finally {
      mockBackends.clear()
    }
  })

  it('pinetree: personal tabs hide with one line why', async () => {
    const {store, sessionId} = await signedInStore()
    const pages = pagesMod()
    delete (pages as Record<string, unknown>).mine
    delete (pages as Record<string, unknown>).liked
    mockBackends.set(sessionId, fakeBackend(pages))
    try {
      renderScreen(store)
      expect(await screen.findByTestId('pages-featured-empty')).toBeTruthy()
      expect(screen.queryByTestId('pages-tab-mine')).toBeNull()
      expect(screen.queryByTestId('pages-tab-liked')).toBeNull()
      expect(screen.getByTestId('pages-personal-unavailable')).toBeTruthy()
    } finally {
      mockBackends.clear()
    }
  })

  it('mastodon: unsupported reason; signed-out: sign-in prompt', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, fakeBackend(null, 'mastodon'))
    try {
      const {unmount} = renderScreen(store)
      expect(await screen.findByText('Pages are not available on this server.')).toBeTruthy()
      unmount()
    } finally {
      mockBackends.clear()
    }
    const {createSessionStore: createStore} = await import('#/state/session/store')
    const empty = createStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: 'https://a.example',
    })
    renderScreen(empty)
    expect(screen.getByText('Sign in to see pages.')).toBeTruthy()
  })
})
