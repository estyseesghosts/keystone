import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {Text} from 'react-native'

import {ApiError, createMemoryStore, type Backend} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {makePost} from '#/components/__tests__/fixtures'

import {FeedView} from './HomeFeed'

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

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

describe('FeedView states', () => {
  it('shows the signed-out state without sample data', async () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: HOME_ORIGIN})
    renderWithProviders(
      <FeedView sessionId={null} descriptor="timeline|home" backend={null} testID="feed" />,
      store,
    )
    expect(screen.getByText('Sign in to see this feed.')).toBeTruthy()
    expect(screen.queryByTestId('post-1')).toBeNull()
  })

  it('shows an error with retry, and reports unsupported feeds honestly', async () => {
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
    const timeline = jest.fn(() => Promise.reject(new ApiError('nope', 404, 'NOT_FOUND' as never)))
    const backend = {timeline} as unknown as Backend
    renderWithProviders(
      <FeedView sessionId={added.id} descriptor="timeline|social" backend={backend} retry={false} testID="feed" />,
      store,
    )
    expect(await screen.findByText('Not on this server.')).toBeTruthy()
    expect(timeline).toHaveBeenCalledTimes(1)
    fireEvent.press(screen.getByTestId('feed-retry'))
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(2))
  })

  it('renders rows from the session backend (no wire in src)', async () => {
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
    const post = makePost({id: 'p1', content: {mfm: 'hello timeline', plain: 'hello timeline'}})
    const backend = {
      timeline: jest.fn(() => Promise.resolve({items: [post], cursor: null, end: true})),
    } as unknown as Backend
    renderWithProviders(
      <FeedView sessionId={added.id} descriptor="timeline|home" backend={backend} testID="feed" />,
      store,
    )
    expect(await screen.findByText('hello timeline')).toBeTruthy()
    expect(screen.getByTestId('post-p1')).toBeTruthy()
  })

  it('shows skeletons while the first page loads', () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: HOME_ORIGIN})
    const backend = {
      timeline: jest.fn(() => new Promise(() => {})),
    } as unknown as Backend
    renderWithProviders(
      <FeedView sessionId="sess-x" descriptor="timeline|home" backend={backend} testID="feed" />,
      store,
    )
    expect(screen.getByTestId('feed-skeleton')).toBeTruthy()
    expect(screen.getByTestId('feed-loading')).toBeTruthy()
  })

  it('retries the next page after a failure', async () => {
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
    const post = makePost({id: 'p1', content: {mfm: 'first page', plain: 'first page'}})
    const timeline = jest
      .fn()
      .mockResolvedValueOnce({items: [post], cursor: 'c1', end: false})
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValue({items: [], cursor: null, end: true})
    const backend = {timeline} as unknown as Backend
    renderWithProviders(
      <FeedView sessionId={added.id} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
      store,
    )
    expect(await screen.findByText('first page')).toBeTruthy()
    const list = screen.getByTestId('feed-list')
    ;(list.props as {onEndReached?: () => void}).onEndReached?.()
    expect(await screen.findByTestId('feed-more-retry')).toBeTruthy()
    fireEvent.press(screen.getByTestId('feed-more-retry'))
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(3))
  })

  it('the new-posts pill scrolls to top and dismisses', async () => {
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
    const oldPost = makePost({id: 'p1', content: {mfm: 'old post', plain: 'old post'}})
    const newPost = makePost({id: 'p2', content: {mfm: 'new post', plain: 'new post'}})
    const timeline = jest.fn(() => Promise.resolve({items: [oldPost], cursor: null, end: true}))
    const backend = {timeline} as unknown as Backend
    renderWithProviders(
      <FeedView sessionId={added.id} descriptor="timeline|home" backend={backend} testID="feed" />,
      store,
    )
    expect(await screen.findByText('old post')).toBeTruthy()
    expect(screen.queryByTestId('new-posts-pill')).toBeNull()
    timeline.mockResolvedValue({items: [newPost, oldPost], cursor: null, end: true})
    const list = screen.getByTestId('feed-list')
    const control = (list.props as {refreshControl?: {props: {onRefresh: () => void}}}).refreshControl
    control?.props.onRefresh()
    expect(await screen.findByTestId('new-posts-pill')).toBeTruthy()
    fireEvent.press(screen.getByTestId('new-posts-pill'))
    expect(screen.queryByTestId('new-posts-pill')).toBeNull()
  })

  it('sanity: test renderer works', () => {
    render(
      <ThemeProvider theme="light">
        <Text>ok</Text>
      </ThemeProvider>,
    )
    expect(screen.getByText('ok')).toBeTruthy()
  })
})
