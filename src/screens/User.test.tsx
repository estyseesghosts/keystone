import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {createMemoryStore, type Backend} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {makeAccount, makePost} from '#/components/__tests__/fixtures'

import {UserScreen} from './User'

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn()}),
  useRoute: () => ({params: {id: 'alice'}}),
}))

const mockBackends = new Map<string, unknown>()
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

function renderWithProviders(ui: React.ReactElement, store: ReturnType<typeof createSessionStore>) {
  i18n.load('en', {})
  i18n.activate('en')
  return render(
    <I18nProvider i18n={i18n}>
    <ThemeProvider theme="light">
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
          {ui}
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
    </I18nProvider>,
  )
}

describe('UserScreen scroll layout (bio scrolls, tabs stick, no reactions)', () => {
  it('mounts the bio as feed header content, pins the tabs, and drops the reactions block', async () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: HOME_ORIGIN})
    const added = await store.add({
      origin: 'https://a.example',
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'alice',
      token: 'token-a',
      grant: 'password',
      hosting: 'third-party',
    })
    const post = makePost({id: 'p1', content: {mfm: 'hello profile', plain: 'hello profile'}})
    const accountPosts = jest.fn(async () => ({items: [post], cursor: null, end: true}))
    const accountReactions = jest.fn(async () => ({items: [], cursor: null, end: true}))
    const backend = {
      capabilities: {},
      account: jest.fn(async () =>
        makeAccount({id: 'alice', username: 'alice', acct: 'alice', displayName: 'Alice', name: 'Alice'}),
      ),
      relationships: jest.fn(async () => []),
      accountPosts,
      accountReactions,
    } as unknown as Backend
    mockBackends.set(added.id, backend)
    renderWithProviders(<UserScreen />, store)

    // The profile feed loads through the shared FeedView.
    expect(await screen.findByText('hello profile')).toBeTruthy()
    expect(accountPosts).toHaveBeenCalled()
    // Bio scrolls away with the feed: it is list header content, tabs
    // in-flow directly under it at rest, nothing pinned yet.
    expect(screen.getByTestId('feed-scroll-header')).toBeTruthy()
    expect(screen.getByTestId('profile-header')).toBeTruthy()
    expect(screen.getByTestId('profile-tabs')).toBeTruthy()
    expect(screen.queryByTestId('feed-sticky-bar')).toBeNull()
    // Scrolled past the tabs: the single pinned copy mounts above the list.
    fireEvent.scroll(screen.getByTestId('feed-list'), {
      nativeEvent: {
        contentOffset: {x: 0, y: 900},
        contentSize: {width: 390, height: 5000},
        layoutMeasurement: {width: 390, height: 800},
      },
    })
    expect(screen.getByTestId('feed-sticky-bar')).toBeTruthy()
    expect(screen.getAllByTestId('profile-tabs')).toHaveLength(1)
    // The recent-reactions block is gone: never mounted, never fetched.
    expect(screen.queryByTestId('account-reactions')).toBeNull()
    expect(accountReactions).not.toHaveBeenCalled()
    // Self actions survive the move into the header.
    expect(screen.getByTestId('profile-edit')).toBeTruthy()
  })
})
