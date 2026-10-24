import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore, type Backend} from '@keystone/fedi'
import {ApiError} from '@keystone/fedi'

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
  useRoute: () => ({params: mockRouteParams.current}),
}))

const mockRouteParams: {current: {id: string} | undefined} = {current: {id: 'alice'}}

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
    // Scrolled past the tabs: the pinned overlay copy mounts above the
    // list; the in-flow copy stays mounted but AT-hidden (no jump).
    fireEvent.scroll(screen.getByTestId('feed-list'), {
      nativeEvent: {
        contentOffset: {x: 0, y: 900},
        contentSize: {width: 390, height: 5000},
        layoutMeasurement: {width: 390, height: 800},
      },
    })
    expect(screen.getByTestId('feed-sticky-bar')).toBeTruthy()
    expect(screen.getByTestId('profile-tabs')).toBeTruthy()
    expect(
      screen.getAllByTestId('profile-tabs', {includeHiddenElements: true}),
    ).toHaveLength(2)
    // The recent-reactions block is gone: never mounted, never fetched.
    expect(screen.queryByTestId('account-reactions')).toBeNull()
    expect(accountReactions).not.toHaveBeenCalled()
    // Self actions survive the move into the header.
    expect(screen.getByTestId('profile-edit')).toBeTruthy()
  })

  it('names server rate limiting honestly, and retry recovers', async () => {
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
    const limit = new ApiError('Too many requests.', 429, 'errors.network.apiError')
    const account = jest
      .fn()
      .mockRejectedValueOnce(limit)
      .mockResolvedValue(
        makeAccount({id: 'alice', username: 'alice', acct: 'alice', displayName: 'Alice', name: 'Alice'}),
      )
    const backend = {
      capabilities: {},
      account,
      relationships: jest.fn(async () => []),
      accountPosts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      accountReactions: jest.fn(async () => ({items: [], cursor: null, end: true})),
    } as unknown as Backend
    mockBackends.set(added.id, backend)
    renderWithProviders(<UserScreen />, store)

    // A 429 is throttling, never "deleted, suspended, or unreachable".
    expect(await screen.findByTestId('profile-rate-limited')).toBeTruthy()
    expect(screen.getByText(/throttling requests/)).toBeTruthy()
    expect(screen.queryByText(/deleted, suspended/)).toBeNull()
    // Retry re-fetches and the profile lands.
    fireEvent.press(screen.getByTestId('profile-retry'))
    expect(await screen.findByTestId('profile-header')).toBeTruthy()
    expect(account).toHaveBeenCalledTimes(2)
  })

  it('keeps the generic copy for non-rate-limit failures', async () => {
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
    const backend = {
      capabilities: {},
      account: jest.fn(async () => {
        throw new ApiError('Not found.', 404, 'errors.shape.noAccountFound')
      }),
      relationships: jest.fn(async () => []),
      accountPosts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      accountReactions: jest.fn(async () => ({items: [], cursor: null, end: true})),
    } as unknown as Backend
    mockBackends.set(added.id, backend)
    renderWithProviders(<UserScreen />, store)

    expect(await screen.findByText('Could not load this profile.')).toBeTruthy()
    expect(screen.queryByTestId('profile-rate-limited')).toBeNull()
  })

  it('resets to the posts tab when navigating to another profile (R2.4)', async () => {
    mockRouteParams.current = {id: 'alice'}
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: HOME_ORIGIN})
    const added = await store.add({
      origin: 'https://a.example',
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'carol',
      token: 'token-a',
      grant: 'password',
      hosting: 'third-party',
    })
    const backend = {
      capabilities: {},
      account: jest.fn(async ({id}: {id: string}) =>
        makeAccount({id, username: id, acct: id, displayName: id[0].toUpperCase() + id.slice(1), name: id}),
      ),
      relationships: jest.fn(async () => []),
      accountPosts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      accountReactions: jest.fn(async () => ({items: [], cursor: null, end: true})),
    } as unknown as Backend
    mockBackends.set(added.id, backend)
    i18n.load('en', {})
    i18n.activate('en')
    const qc = new QueryClient()
    const ui = () => (
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <QueryClientProvider client={qc}>
            <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
              <UserScreen />
            </SessionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>
    )
    const tree = render(ui())
    expect(await screen.findByTestId('profile-body')).toBeTruthy()
    // Leave posts for a tab the next profile may hide, then navigate:
    // the same mounted screen must start the new profile on posts.
    // (The tabs mount with the feed, past the skeleton; switching tabs
    // refetches the feed, so the tabs briefly unmount — wait through it.)
    expect(await screen.findByTestId('profile-tab-media', {}, {timeout: 10000})).toBeTruthy()
    fireEvent.press(screen.getByTestId('profile-tab-media'))
    await waitFor(() => {
      expect(screen.getByTestId('profile-tab-media').props.accessibilityState.selected).toBe(true)
    })
    mockRouteParams.current = {id: 'bob'}
    // A fresh element forces the mounted tree to re-render and re-read
    // the route (same instance, new target — the User(A)→User(B) path).
    tree.rerender(ui())
    expect(await screen.findByText('Bob', {}, {timeout: 10000})).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByTestId('profile-tab-posts').props.accessibilityState.selected).toBe(true)
    })
    tree.unmount()
    mockRouteParams.current = {id: 'alice'}
  })
})
