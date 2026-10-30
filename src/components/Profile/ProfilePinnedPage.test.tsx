// P6.5 Pages slice 7: profile pinned section — packed render, fetch
// path, hidden title, absent/error null.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore, type Account} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {makeAccount} from '#/components/__tests__/fixtures'

import {ProfilePinnedPage} from './ProfilePinnedPage'

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
    id: 'p9',
    createdAt: '2026-10-26T12:00:00.000Z',
    updatedAt: '2026-10-26T12:00:00.000Z',
    author: makeAccount(),
    title: 'Pinned',
    name: 'pinned',
    summary: null,
    font: 'sans-serif',
    alignCenter: false,
    hideTitleWhenPinned: false,
    eyeCatchingImageId: null,
    eyeCatchingImage: null,
    attachedFiles: [],
    blocks: [{kind: 'text', id: 'b1', text: 'hi'}],
    likedCount: 0,
    isLiked: undefined,
    hasLegacyScript: false,
    url: 'https://a.example/@alice/pages/pinned',
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

function renderPinned(account: Account, sessionId: string | null, store: unknown) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider store={store as never} homeOrigin="https://a.example">
          <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
            <ProfilePinnedPage account={account} sessionId={sessionId} testID="pin" />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('ProfilePinnedPage', () => {
  it('renders nothing without a pinned id', async () => {
    const {store, sessionId} = await signedInStore()
    const {toJSON} = renderPinned(makeAccount({pinnedPageId: null, pinnedPage: null}), sessionId, store)
    expect(toJSON()).toBeNull()
  })

  it('renders the packed page directly with an Open button', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, {family: 'misskey', capabilities: {pages: 'supported'}, pages: {show: jest.fn()}})
    try {
      renderPinned(
        makeAccount({pinnedPageId: 'p9', pinnedPage: page() as never}),
        sessionId,
        store,
      )
      expect(await screen.findByTestId('pin-view')).toBeTruthy()
      expect(screen.getByTestId('pin-open')).toBeTruthy()
      expect(screen.getByText('Pinned')).toBeTruthy()
    } finally {
      mockBackends.clear()
    }
  })

  it('fetches when the pack is absent (Pinetree path)', async () => {
    const {store, sessionId} = await signedInStore()
    const show = jest.fn(async () => page({id: 'p9', title: 'Fetched'}))
    mockBackends.set(sessionId, {family: 'misskey', capabilities: {pages: 'supported'}, pages: {show}})
    try {
      renderPinned(makeAccount({pinnedPageId: 'p9', pinnedPage: null}), sessionId, store)
      expect(await screen.findByText('Fetched')).toBeTruthy()
      expect(show).toHaveBeenCalledWith({id: 'p9'})
    } finally {
      mockBackends.clear()
    }
  })

  it('failed fetch renders nothing', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, {
      family: 'misskey',
      capabilities: {pages: 'supported'},
      pages: {
        show: jest.fn(async () => {
          throw new Error('gone')
        }),
      },
    })
    try {
      const {toJSON} = renderPinned(makeAccount({pinnedPageId: 'p9', pinnedPage: null}), sessionId, store)
      await waitFor(
        () => {
          expect(toJSON()).toBeNull()
        },
        {timeout: 15000},
      )
    } finally {
      mockBackends.clear()
    }
  })

  it('honours hideTitleWhenPinned', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, {family: 'misskey', capabilities: {pages: 'supported'}, pages: {show: jest.fn()}})
    try {
      renderPinned(
        makeAccount({pinnedPageId: 'p9', pinnedPage: page({hideTitleWhenPinned: true}) as never}),
        sessionId,
        store,
      )
      expect(await screen.findByTestId('pin-view')).toBeTruthy()
      expect(screen.queryByText('Pinned')).toBeNull()
    } finally {
      mockBackends.clear()
    }
  })

  it('collapses and expands', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, {family: 'misskey', capabilities: {pages: 'supported'}, pages: {show: jest.fn()}})
    try {
      renderPinned(makeAccount({pinnedPageId: 'p9', pinnedPage: page() as never}), sessionId, store)
      expect(await screen.findByTestId('pin-view')).toBeTruthy()
      fireEvent.press(screen.getByTestId('pin-toggle'))
      expect(screen.queryByTestId('pin-view')).toBeNull()
      fireEvent.press(screen.getByTestId('pin-toggle'))
      expect(screen.getByTestId('pin-view')).toBeTruthy()
    } finally {
      mockBackends.clear()
    }
  })
})
