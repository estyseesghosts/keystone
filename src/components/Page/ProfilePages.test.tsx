// P6.5 Pages slice 3: profile Pages tab content (byUser list, empty,
// error + retry).

import {fireEvent, render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore, type Backend} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {ProfilePages} from './ProfilePages'

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
      id: 'u9', name: 'Zoe', username: 'zoe', displayName: 'Zoe', host: null,
      avatarUrl: null, avatarBlurhash: null, isBot: false, isCat: false,
      emojis: {}, onlineStatus: 'online',
    },
    title: 'Zed',
    name: 'zed',
    summary: null,
    hideTitleWhenPinned: false,
    alignCenter: false,
    font: 'sans-serif',
    eyeCatchingImageId: null,
    eyeCatchingImage: null,
    attachedFiles: [],
    blocks: [{kind: 'text', id: 'b1', text: 'hi'}],
    likedCount: 0,
    isLiked: false,
    hasLegacyScript: false,
    url: 'https://a.example/@zoe/pages/zed',
    ...over,
  }
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

function renderList(store: unknown, userId = 'u9') {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider store={store as never} homeOrigin="https://a.example">
          <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
            <ProfilePages userId={userId} testID="pp" />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('ProfilePages', () => {
  it('renders the author cards, current user not excluded', async () => {
    const {store, sessionId} = await signedInStore()
    const byUser = jest.fn(async () => ({
      items: [page({id: 'z1', title: 'Zed'}), page({id: 'z2', title: 'Zed2'})],
      cursor: null,
      end: true,
    }))
    mockBackends.set(sessionId, {family: 'misskey', capabilities: {pages: 'supported'}, pages: {byUser}} as unknown as Backend)
    try {
      renderList(store)
      expect(await screen.findByTestId('pp-z1')).toBeTruthy()
      expect(screen.getByTestId('pp-z2')).toBeTruthy()
      expect(byUser).toHaveBeenCalledWith('u9', {cursor: undefined, limit: 20})
    } finally {
      mockBackends.clear()
    }
  })

  it('honest empty state', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, {
      family: 'misskey',
      capabilities: {pages: 'supported'},
      pages: {byUser: jest.fn(async () => ({items: [], cursor: null, end: true}))},
    } as unknown as Backend)
    try {
      renderList(store)
      expect(await screen.findByText('No pages yet.')).toBeTruthy()
    } finally {
      mockBackends.clear()
    }
  })

  it('error with retry', async () => {
    const {store, sessionId} = await signedInStore()
    const byUser: jest.Mock = jest.fn(async () => {
      throw new Error('down')
    })
    mockBackends.set(sessionId, {family: 'misskey', capabilities: {pages: 'supported'}, pages: {byUser}} as unknown as Backend)
    try {
      renderList(store)
      expect(await screen.findByText('Could not load pages.')).toBeTruthy()
      byUser.mockResolvedValueOnce({items: [], cursor: null, end: true})
      fireEvent.press(screen.getByTestId('pp-retry'))
      expect(await screen.findByText('No pages yet.')).toBeTruthy()
    } finally {
      mockBackends.clear()
    }
  })
})
