import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {Text} from 'react-native'

import {ApiError, createMemoryStore, type Backend} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {FeedView} from './HomeFeed'

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function renderWithProviders(ui: React.ReactElement, store: ReturnType<typeof createSessionStore>) {
  return render(
    <ThemeProvider theme="light">
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
          {ui}
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
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
    const post = {
      id: 'p1',
      createdAt: '2026-10-20T00:00:00.000Z',
      author: {id: 'alice', username: 'alice', acct: 'alice', host: null, name: 'Alice', displayName: 'Alice'},
      accountId: 'alice',
      content: {plain: 'hello timeline'},
      cw: null,
      visibility: {kind: 'public', localOnly: false, raw: 'public'},
      counts: {replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0},
      reactions: null,
      favourite: null,
      media: [],
      mediaIds: [],
      poll: null,
      card: null,
      quote: null,
      quoteState: null,
      quoteUnavailable: false,
      renote: null,
      reply: null,
      replyToId: null,
      renoteId: null,
      uri: null,
      url: null,
      emojis: {},
      mentions: [],
      tags: [],
      editedAt: null,
      filtered: [],
      pinned: false,
      ext: {},
    }
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

  it('sanity: test renderer works', () => {
    render(
      <ThemeProvider theme="light">
        <Text>ok</Text>
      </ThemeProvider>,
    )
    expect(screen.getByText('ok')).toBeTruthy()
  })
})
