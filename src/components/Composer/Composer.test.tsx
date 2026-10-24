import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {StyleSheet} from 'react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import {ApiError, buildCapabilities, createMemoryStore, type Backend, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {themes, type ThemeName} from '#/alf/themes'
import {draftsKeyFor, listDrafts} from '#/storage/drafts'
import {makePost} from '#/components/__tests__/fixtures'

import {Composer, sheetKeyboardInset, sheetVisibleMaxHeight} from './Composer'
import {pickMedia} from './pickMedia'

i18n.load('en', {})
i18n.activate('en')

jest.mock('./pickMedia', () => ({pickMedia: jest.fn(async () => [])}))
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  fetchComposeLimits: jest.fn(async () => ({maxChars: 20, maxMedia: 4, maxPollOptions: 4})),
}))

const pickMediaMock = pickMedia as jest.MockedFunction<typeof pickMedia>

function attachment(name = 'cat.png') {
  return {file: new File(['x'], name), name, previewUri: null}
}

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
    uploadMedia: jest.fn().mockResolvedValue({id: 'm1'}),
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
      <I18nProvider i18n={i18n}>
        <ThemeProvider>
          <Composer session={s} backend={backend} store={store} onClose={onClose} {...props} />
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>,
  )
  return {store, backend, onClose, s}
}

describe('Composer', () => {
  beforeEach(() => {
    // Keep the default empty picker; a test that needs an attachment
    // queues one with `mockResolvedValueOnce`.
    pickMediaMock.mockReset()
    pickMediaMock.mockImplementation(async () => [])
  })

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
    const quote = makePost({id: 'q1'})
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
        <I18nProvider i18n={i18n}>
          <ThemeProvider>
            <Composer session={s} backend={backend} store={store} quote={quote} onClose={() => {}} />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    )
    fireEvent.changeText(screen.getByTestId('composer-text'), 'my take')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(2))
    expect(createPost.mock.calls[0][0]).toMatchObject({renoteId: 'q1'})
    expect(createPost.mock.calls[1][0]).not.toHaveProperty('renoteId')
    expect(await screen.findByTestId('composer-notice')).toBeTruthy()
  })

  it('shows the real quoted card while quoting, with an Add a comment box', () => {
    setup('sharkey', {}, {quote: makePost({id: 'q1', content: {mfm: 'quoted words', plain: 'quoted words'}})})
    expect(screen.getByTestId('composer-quote-preview')).toBeTruthy()
    expect(screen.getByText('quoted words')).toBeTruthy()
    expect(screen.getByTestId('composer-text').props.placeholder).toBe('Add a comment')
    expect(screen.queryByTestId('composer-quote-context')).toBeNull()
  })

  it('shows the real original above the reply box, with a Replying to row', () => {
    setup('sharkey', {}, {replyTo: makePost({id: 'p1', content: {mfm: 'original words', plain: 'original words'}})})
    expect(screen.getByTestId('composer-reply-preview')).toBeTruthy()
    expect(screen.getByText('original words')).toBeTruthy()
    expect(screen.getByTestId('composer-replying-to')).toBeTruthy()
    expect(screen.getByTestId('composer-text').props.placeholder).toBe('Write your reply')
    expect(screen.queryByTestId('composer-reply-context')).toBeNull()
  })

  it('nests one quoted card level inside a reply preview', () => {
    const inner = makePost({id: 'inner', content: {mfm: 'inner words', plain: 'inner words'}})
    const replyTo = makePost({id: 'p1', content: {mfm: 'outer words', plain: 'outer words'}, quote: inner})
    setup('sharkey', {}, {replyTo})
    expect(screen.getByTestId('composer-reply-quote')).toBeTruthy()
    expect(screen.getByText('inner words')).toBeTruthy()
    // No card-in-a-card beyond the one flat level.
    expect(screen.queryByTestId('composer-reply-quote-nested')).toBeNull()
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
    const replyTo = makePost({id: 'p1', content: {mfm: 'hello there', plain: 'hello there'}})
    const quote = makePost({id: 'p2', content: {mfm: 'quoted words', plain: 'quoted words'}})
    const post = jest.fn(async (id: string) => (id === 'p1' ? replyTo : quote))
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <I18nProvider i18n={i18n}>
          <ThemeProvider>
            <Composer
              session={session('misskey', 'sharkey')}
              backend={backendFor('sharkey', {post})}
              store={store}
              draftId="dd"
              onClose={() => {}}
            />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByTestId('composer-reply-preview')).toBeTruthy()
    expect(await screen.findByText('hello there')).toBeTruthy()
    expect(screen.getByTestId('composer-quote-preview')).toBeTruthy()
    expect(screen.getByText('quoted words')).toBeTruthy()
  })

  it('saves edits through editPost and keeps existing attachments', async () => {
    const editing = {
      id: 'p9',
      content: {mfm: 'orig', plain: 'orig'},
      cw: null,
      visibility: {kind: 'public', localOnly: false, raw: 'public'},
      mediaIds: ['m1'],
      author: {id: 'me'},
    } as never
    const store = createMemoryStore()
    const s = session('misskey', 'sharkey')
    const updated = {...(editing as object), content: {mfm: 'fixed', plain: 'fixed'}}
    const editPost = jest.fn().mockResolvedValue(updated)
    const backend = backendFor('sharkey', {editPost})
    const onClose = jest.fn()
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <Composer session={s} backend={backend} store={store} editing={editing} onClose={onClose} />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('composer-text').props.value).toBe('orig')
    expect(screen.getByTestId('composer-edit-context')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('composer-text'), 'fixed')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(editPost).toHaveBeenCalledTimes(1))
    expect(editPost).toHaveBeenCalledWith('p9', expect.objectContaining({mediaIds: ['m1']}))
    expect(onClose).toHaveBeenCalled()
  })

  it('sends per-note noQuote on the Misskey family (create and edit)', async () => {
    const on = setup('sharkey')
    expect(screen.getByTestId('composer-no-quote')).not.toBeDisabled()
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-no-quote'))
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(on.backend.createPost).toHaveBeenCalledTimes(1))
    expect(on.backend.createPost).toHaveBeenCalledWith(expect.objectContaining({noQuote: true}))

    // Edit mode carries the same per-note flag through submit.
    const editing = {
      id: 'p9',
      content: {mfm: 'orig', plain: 'orig'},
      cw: null,
      visibility: {kind: 'public', localOnly: false, raw: 'public'},
      mediaIds: [],
      author: {id: 'me'},
    } as never
    const editPost = jest.fn().mockResolvedValue(editing)
    const store = createMemoryStore()
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <Composer
            session={session('misskey', 'sharkey')}
            backend={backendFor('sharkey', {editPost})}
            store={store}
            editing={editing}
            onClose={() => {}}
          />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    fireEvent.press(screen.getByTestId('composer-no-quote'))
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(editPost).toHaveBeenCalledTimes(1))
    expect(editPost).toHaveBeenCalledWith('p9', expect.objectContaining({noQuote: true}))
  })

  it('disables the per-note noQuote control on Mastodon and never sends it', async () => {
    const {backend} = setup('mastodon')
    expect(screen.getByTestId('composer-no-quote')).toBeDisabled()
    expect(screen.getByTestId('composer-no-quote-reason')).toHaveTextContent(
      'Keystone cannot set quote refusal per post on this server yet.',
    )
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(backend.createPost).toHaveBeenCalledTimes(1))
    expect((backend.createPost as jest.Mock).mock.calls[0][0]).not.toHaveProperty('noQuote')
  })

  it('marks one attachment sensitive at upload on the Misskey family', async () => {
    pickMediaMock.mockResolvedValueOnce([attachment()])
    const {backend} = setup('sharkey')
    fireEvent.press(screen.getByTestId('composer-media-add'))
    const toggle = await screen.findByTestId(/^composer-upload-sensitive-/)
    fireEvent.press(toggle)
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(backend.uploadMedia).toHaveBeenCalledTimes(1))
    // The flag rides WITH the upload (Misskey `isSensitive`), before the
    // post create call.
    expect(backend.uploadMedia).toHaveBeenCalledWith(expect.any(File), {isSensitive: true})
    expect(backend.createPost).toHaveBeenCalledWith(expect.objectContaining({mediaIds: ['m1']}))
  })

  it('disables attach-time sensitivity on Mastodon with a reason and never sends it', async () => {
    pickMediaMock.mockResolvedValueOnce([attachment()])
    const {backend} = setup('mastodon')
    fireEvent.press(screen.getByTestId('composer-media-add'))
    const toggle = await screen.findByTestId(/^composer-upload-sensitive-/)
    expect(toggle).toBeDisabled()
    expect(screen.getByTestId('composer-media-sensitive-reason')).toHaveTextContent(
      'This server marks media sensitivity for the whole post, not per attachment.',
    )
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(backend.uploadMedia).toHaveBeenCalledTimes(1))
    expect(backend.uploadMedia).toHaveBeenCalledWith(expect.any(File), {})
  })

  it.each(['light', 'dark'] as ThemeName[])(
    'pairs the themed input text, placeholder, and counter with the theme (%s)',
    theme => {
      const store = createMemoryStore()
      const s = session('misskey', 'sharkey')
      const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
      render(
        <QueryClientProvider client={qc}>
          <ThemeProvider theme={theme}>
            <Composer session={s} backend={backendFor('sharkey')} store={store} onClose={() => {}} />
          </ThemeProvider>
        </QueryClientProvider>,
      )
      const input = screen.getByTestId('composer-text')
      const flat = StyleSheet.flatten(input.props.style) as
        | {color?: string; backgroundColor?: string}
        | undefined
      expect(flat?.color).toBe(themes[theme].palette.text)
      expect(flat?.backgroundColor).toBe(themes[theme].palette.bg)
      expect(input.props.placeholderTextColor).toBe(themes[theme].palette.faint)
      const counter = screen.getByTestId('composer-counter')
      const counterFlat = StyleSheet.flatten(counter.props.style) as
        | {color?: string}
        | undefined
      expect([themes[theme].palette.text, themes[theme].palette.muted]).toContain(
        counterFlat?.color,
      )
    },
  )
})

describe('sheet keyboard helpers (C3)', () => {
  it('sheetKeyboardInset passes the native height through and zeroes web/invalid', () => {
    expect(sheetKeyboardInset('ios', 300)).toBe(300)
    expect(sheetKeyboardInset('android', 300)).toBe(300)
    expect(sheetKeyboardInset('web', 300)).toBe(0)
    expect(sheetKeyboardInset('ios', 0)).toBe(0)
    expect(sheetKeyboardInset('ios', -10)).toBe(0)
    expect(sheetKeyboardInset('ios', Number.NaN)).toBe(0)
  })

  it('sheetVisibleMaxHeight caps mobile native cards to the visible area', () => {
    expect(sheetVisibleMaxHeight('ios', 'mobile', 800, 0)).toBe(800)
    expect(sheetVisibleMaxHeight('ios', 'mobile', 800, 300)).toBe(500)
    expect(sheetVisibleMaxHeight('android', 'mobile', 800, 300)).toBe(500)
  })

  it('sheetVisibleMaxHeight leaves desktop and web cards alone', () => {
    expect(sheetVisibleMaxHeight('ios', 'rail', 800, 300)).toBeUndefined()
    expect(sheetVisibleMaxHeight('ios', 'full', 800, 300)).toBeUndefined()
    expect(sheetVisibleMaxHeight('web', 'mobile', 800, 300)).toBeUndefined()
    expect(sheetVisibleMaxHeight('ios', 'mobile', 0, 300)).toBeUndefined()
  })
})
