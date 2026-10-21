import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {ApiError, buildCapabilities, createMemoryStore, type Backend, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {draftsKeyFor, listDrafts} from '#/storage/drafts'

import {Composer} from './Composer'

jest.mock('./pickMedia', () => ({pickMedia: jest.fn(async () => [])}))
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  fetchComposeLimits: jest.fn(async () => ({maxChars: 20, maxMedia: 4, maxPollOptions: 4})),
}))

const session = (family: 'misskey' | 'mastodon', flavor: string): Session =>
  ({
    id: 'https://s.example me',
    origin: 'https://s.example',
    family,
    flavor,
    accountId: 'me',
    token: 'tok',
  }) as unknown as Session

function backendFor(flavor: 'sharkey' | 'mastodon', extra: Partial<Backend> = {}) {
  return {
    family: flavor === 'mastodon' ? 'mastodon' : 'misskey',
    capabilities: buildCapabilities(flavor),
    createPost: jest.fn().mockResolvedValue({
      id: 'new',
      author: {id: 'me'},
      counts: {replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0},
    }),
    customEmojis: jest.fn().mockResolvedValue([{name: 'blobcat', url: 'u'}]),
    search: {},
    uploadMedia: jest.fn(),
    ...extra,
  } as unknown as Backend
}

function setup(flavor: 'sharkey' | 'mastodon', extra: Partial<Backend> = {}, props = {}) {
  const store = createMemoryStore()
  const backend = backendFor(flavor, extra)
  const onClose = jest.fn()
  const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
  const s = session(flavor === 'mastodon' ? 'mastodon' : 'misskey', flavor)
  render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <Composer session={s} backend={backend} store={store} onClose={onClose} {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return {store, backend, onClose, s}
}

describe('Composer', () => {
  it('hides unsupported controls and counts against the server limit', async () => {
    setup('mastodon')
    expect(screen.queryByTestId('composer-schedule-toggle')).toBeNull()
    expect(screen.queryByTestId('composer-local-only')).toBeNull()
    fireEvent.changeText(screen.getByTestId('composer-text'), 'a'.repeat(25))
    await waitFor(() => expect(screen.getByTestId('composer-counter')).toHaveTextContent('25 / 20'))
    expect(screen.getByTestId('composer-submit')).toBeDisabled()
  })

  it('posts through the session backend with raw visibility and clears the draft', async () => {
    const {backend, store, s, onClose} = setup('sharkey')
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-vis-home'))
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(backend.createPost).toHaveBeenCalledWith({
      text: 'hello',
      visibility: {kind: 'quiet', localOnly: false, raw: 'home'},
    })
    expect(listDrafts(store, s.id)).toEqual([])
  })

  it('autosaves a draft keyed by session and restores it', async () => {
    jest.useFakeTimers()
    try {
      const first = setup('sharkey')
      fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
      jest.advanceTimersByTime(500)
      const saved = listDrafts(first.store, first.s.id)
      expect(saved).toHaveLength(1)
      expect(first.store.getItem(draftsKeyFor(first.s.id))).toContain('keep me')
    } finally {
      jest.useRealTimers()
    }
  })

  it('restores a saved draft by id', () => {
    const store = createMemoryStore()
    const sid = 'https://s.example me'
    store.setItem(
      draftsKeyFor(sid),
      JSON.stringify({
        version: 1,
        drafts: [{id: 'dd', updatedAt: 1, text: 'from before', visibilityRaw: 'followers'}],
      }),
    )
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <Composer
            session={session('misskey', 'sharkey')}
            backend={backendFor('sharkey')}
            store={store}
            draftId="dd"
            onClose={() => {}}
          />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('composer-text').props.value).toBe('from before')
  })

  it('clears the inline composer after posting (no onClose)', async () => {
    const store = createMemoryStore()
    const backend = backendFor('sharkey')
    const s = session('misskey', 'sharkey')
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <Composer session={s} backend={backend} store={store} />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(backend.createPost).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('composer-text').props.value).toBe(''))
    expect(listDrafts(store, s.id)).toEqual([])
  })

  it('recovers from quote refusal by posting without the quote', async () => {
    const quote = {id: 'q1', author: {acct: 'quoted'}} as never
    const store = createMemoryStore()
    const s = session('misskey', 'sharkey')
    const createPost = jest
      .fn()
      .mockRejectedValueOnce(new ApiError('QUOTE_DISABLED', 403, 'QUOTE_DISABLED_FOR_USER' as never))
      .mockResolvedValue({id: 'new', author: {id: 'me'}, counts: {replies: 0, boosts: 0, quotes: 0}})
    const backend = backendFor('sharkey', {createPost})
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <Composer session={s} backend={backend} store={store} quote={quote} onClose={() => {}} />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    fireEvent.changeText(screen.getByTestId('composer-text'), 'my take')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(2))
    expect(createPost.mock.calls[0][0]).toMatchObject({renoteId: 'q1'})
    expect(createPost.mock.calls[1][0]).not.toHaveProperty('renoteId')
    expect(await screen.findByTestId('composer-notice')).toBeTruthy()
  })

  it('restored reply/quote drafts re-attach their targets', async () => {
    const store = createMemoryStore()
    const sid = 'https://s.example me'
    store.setItem(
      draftsKeyFor(sid),
      JSON.stringify({
        version: 1,
        drafts: [{id: 'dd', updatedAt: 1, text: 'reply text', replyToId: 'p1', quoteId: 'p2'}],
      }),
    )
    const replyTo = {id: 'p1', author: {acct: 'alice'}} as never
    const quote = {id: 'p2', author: {acct: 'bob'}} as never
    const post = jest.fn(async (id: string) => (id === 'p1' ? replyTo : quote))
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <Composer
            session={session('misskey', 'sharkey')}
            backend={backendFor('sharkey', {post})}
            store={store}
            draftId="dd"
            onClose={() => {}}
          />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Replying to @alice')).toBeTruthy()
    expect(await screen.findByText('Quoting @bob')).toBeTruthy()
  })
})
