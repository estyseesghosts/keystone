import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {StyleSheet} from 'react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import {ApiError, buildCapabilities, createMemoryStore, type Backend, type ServerDraftsApi, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {themes, type ThemeName} from '#/alf/themes'
import {draftsKeyFor, getOpenDraftId, listDrafts, setOpenDraftId} from '#/storage/drafts'
import {makePost} from '#/components/__tests__/fixtures'

import {Composer, sheetKeyboardInset, sheetVisibleMaxHeight, type ComposerProps} from './Composer'
import {pickMedia} from './pickMedia'

i18n.load('en', {})
i18n.activate('en')

jest.mock('./pickMedia', () => ({pickMedia: jest.fn(async () => ({kind: 'cancelled'}))}))
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
    pickMediaMock.mockImplementation(async () => ({kind: 'cancelled'}))
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

  it('submits only once when submit fires twice before busy commits', async () => {
    // Single-flight (R0.3): `busy` state commits after an async gap, so two
    // synchronous dispatches (double-tap, keyboard submit) must still
    // produce one create. The gate holds the first create pending so both
    // dispatches run to their first await before either finishes.
    let release!: (post: unknown) => void
    const gate = new Promise<unknown>(resolve => {
      release = resolve
    })
    const created = {
      id: 'new',
      author: {id: 'me'},
      counts: {replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0},
    }
    const createPost = jest.fn().mockReturnValue(gate.then(() => created))
    const {onClose} = setup('sharkey', {createPost})
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    const submit = screen.getByTestId('composer-submit')
    fireEvent.press(submit)
    fireEvent.press(submit)
    await act(async () => {})
    expect(createPost).toHaveBeenCalledTimes(1)
    release(created)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(createPost).toHaveBeenCalledTimes(1)
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
    pickMediaMock.mockResolvedValueOnce({kind: 'picked', files: [attachment()], rejected: []})
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
    pickMediaMock.mockResolvedValueOnce({kind: 'picked', files: [attachment()], rejected: []})
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

  it('shows denied access instead of a silent cancel', async () => {
    pickMediaMock.mockResolvedValueOnce({kind: 'denied', canAskAgain: true})
    setup('sharkey')
    fireEvent.press(screen.getByTestId('composer-media-add'))
    expect(await screen.findByTestId('composer-error')).toHaveTextContent(/Media library access was denied/)
    expect(screen.queryByTestId(/^composer-upload-/)).toBeNull()
  })

  it('refuses an over-cap pick with an honest error and stages nothing', async () => {
    pickMediaMock.mockResolvedValueOnce({kind: 'picked', files: [], rejected: ['huge.mp4']})
    setup('sharkey')
    fireEvent.press(screen.getByTestId('composer-media-add'))
    expect(await screen.findByTestId('composer-error')).toHaveTextContent(/too large/)
    expect(screen.queryByTestId(/^composer-upload-/)).toBeNull()
  })

  it('stays silent on picker cancel (no error, nothing staged)', async () => {
    pickMediaMock.mockResolvedValueOnce({kind: 'cancelled'})
    setup('sharkey')
    fireEvent.press(screen.getByTestId('composer-media-add'))
    await waitFor(() => expect(pickMediaMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('composer-error')).toBeNull()
    expect(screen.queryByTestId(/^composer-upload-/)).toBeNull()
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

describe('open-draft pointer (slice 1)', () => {
  const sid = 'https://s.example me'

  function renderFresh(
    store: ReturnType<typeof createMemoryStore>,
    backend: Backend,
    props: Partial<ComposerProps> = {},
  ) {
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    return render(
      <QueryClientProvider client={qc}>
        <I18nProvider i18n={i18n}>
          <ThemeProvider>
            <Composer
              session={session('misskey', 'sharkey')}
              backend={backend}
              store={store}
              onClose={() => {}}
              {...props}
            />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    )
  }

  function seedRow(store: ReturnType<typeof createMemoryStore>, row: Record<string, unknown>) {
    store.setItem(draftsKeyFor(sid), JSON.stringify({version: 1, drafts: [row]}))
  }

  beforeEach(() => {
    pickMediaMock.mockReset()
    pickMediaMock.mockImplementation(async () => ({kind: 'cancelled'}))
  })

  it('autosave sets the pointer, and emptying the draft clears it', () => {
    jest.useFakeTimers()
    try {
      const {store, s} = setup('sharkey')
      fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
      jest.advanceTimersByTime(500)
      const saved = listDrafts(store, s.id)
      expect(saved).toHaveLength(1)
      expect(getOpenDraftId(store, s.id)).toBe(saved[0].id)
      // Emptying deletes the row and drops the pointer: next open is fresh.
      fireEvent.changeText(screen.getByTestId('composer-text'), '   ')
      jest.advanceTimersByTime(500)
      expect(listDrafts(store, s.id)).toEqual([])
      expect(getOpenDraftId(store, s.id)).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('submit deletes the draft and clears the pointer', async () => {
    const store = createMemoryStore()
    seedRow(store, {id: 'd9', updatedAt: 1, text: 'bye'})
    setOpenDraftId(store, sid, 'd9')
    const backend = backendFor('sharkey')
    const onClose = jest.fn()
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <Composer
            session={session('misskey', 'sharkey')}
            backend={backend}
            store={store}
            draftId="d9"
            onClose={onClose}
          />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('composer-text').props.value).toBe('bye')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(listDrafts(store, sid)).toEqual([])
    expect(getOpenDraftId(store, sid)).toBeNull()
  })

  it('a targetless open restores the autosaved draft (refresh simulation)', () => {
    jest.useFakeTimers()
    try {
      const store = createMemoryStore()
      const backend = backendFor('sharkey')
      const first = renderFresh(store, backend)
      fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
      jest.advanceTimersByTime(500)
      expect(getOpenDraftId(store, sid)).not.toBeNull()
      first.unmount()
      renderFresh(store, backendFor('sharkey'))
      expect(screen.getByTestId('composer-text').props.value).toBe('keep me')
      // No media were staged, so the restore stays silent.
      expect(screen.queryByTestId('composer-notice')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('pointer restore carries text/CW/visibility/poll/recipients and re-attaches targets', async () => {
    const store = createMemoryStore()
    seedRow(store, {
      id: 'dd',
      updatedAt: 1,
      text: 'full draft',
      cw: 'spoiler',
      cwEnabled: true,
      visibilityRaw: 'specified',
      visibleUserIds: ['u1'],
      pollChoices: ['yes', 'no'],
      pollMultiple: false,
      pollHideTotals: true,
      pollDurationSeconds: 3600,
      replyToId: 'p1',
      quoteId: null,
      hadMedia: false,
    })
    setOpenDraftId(store, sid, 'dd')
    const replyTo = makePost({id: 'p1', content: {mfm: 'hello there', plain: 'hello there'}})
    renderFresh(store, backendFor('sharkey', {post: jest.fn(async () => replyTo)}))
    expect(screen.getByTestId('composer-text').props.value).toBe('full draft')
    expect(screen.getByTestId('composer-cw').props.value).toBe('spoiler')
    expect(screen.getByTestId('composer-vis-specified').props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.getByTestId('composer-poll')).toBeTruthy()
    expect(screen.getByDisplayValue('yes')).toBeTruthy()
    expect(screen.getByDisplayValue('no')).toBeTruthy()
    expect(screen.getByTestId('composer-poll-hide-totals').props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.getByTestId('composer-recipient-del-u1')).toBeTruthy()
    // hadMedia is false: the restore stays silent.
    expect(screen.queryByTestId('composer-notice')).toBeNull()
    // Targets re-attach through the same path as `draftId` restores.
    expect(await screen.findByTestId('composer-reply-preview')).toBeTruthy()
    expect(await screen.findByText('hello there')).toBeTruthy()
  })

  it('pointer restore warns about dropped attachments only when media were staged', async () => {
    const store = createMemoryStore()
    seedRow(store, {id: 'dd', updatedAt: 1, text: 'with media', hadMedia: true})
    setOpenDraftId(store, sid, 'dd')
    const first = renderFresh(store, backendFor('sharkey'))
    expect(screen.getByTestId('composer-notice')).toHaveTextContent(/Attachments aren't kept/)
    first.unmount()
    seedRow(store, {id: 'dd', updatedAt: 2, text: 'without media', hadMedia: false})
    renderFresh(store, backendFor('sharkey'))
    expect(screen.getByTestId('composer-text').props.value).toBe('without media')
    expect(screen.queryByTestId('composer-notice')).toBeNull()
  })

  it('autosave records staged attachments, so the refresh restore warns', async () => {
    pickMediaMock.mockResolvedValueOnce({kind: 'picked', files: [attachment()], rejected: []})
    const store = createMemoryStore()
    const first = renderFresh(store, backendFor('sharkey'))
    fireEvent.press(screen.getByTestId('composer-media-add'))
    // The staged row renders several `composer-upload-*` nodes (container,
    // alt, sensitivity), so a bare `composer-upload-` prefix matches many —
    // wait on the unique per-upload sensitivity toggle like the other
    // media tests do.
    await screen.findByTestId(/^composer-upload-sensitive-/)
    jest.useFakeTimers()
    try {
      fireEvent.changeText(screen.getByTestId('composer-text'), 'with a photo')
      jest.advanceTimersByTime(500)
      const saved = listDrafts(store, sid)
      expect(saved).toHaveLength(1)
      expect(saved[0].hadMedia).toBe(true)
      expect(getOpenDraftId(store, sid)).toBe(saved[0].id)
    } finally {
      jest.useRealTimers()
    }
    first.unmount()
    renderFresh(store, backendFor('sharkey'))
    expect(screen.getByTestId('composer-text').props.value).toBe('with a photo')
    expect(screen.getByTestId('composer-notice')).toHaveTextContent(/Attachments aren't kept/)
  })

  it('a stale pointer clears and the composer opens fresh', () => {
    const store = createMemoryStore()
    setOpenDraftId(store, sid, 'ghost')
    renderFresh(store, backendFor('sharkey'))
    expect(screen.getByTestId('composer-text').props.value).toBe('')
    expect(getOpenDraftId(store, sid)).toBeNull()
  })

  it('targeted opens ignore the pointer', () => {
    const store = createMemoryStore()
    seedRow(store, {id: 'dd', updatedAt: 1, text: 'unrelated'})
    setOpenDraftId(store, sid, 'dd')
    const replyTo = makePost({id: 'p1', content: {mfm: 'original words', plain: 'original words'}})
    renderFresh(store, backendFor('sharkey'), {replyTo})
    expect(screen.getByTestId('composer-text').props.value).toBe('')
    expect(screen.getByTestId('composer-reply-preview')).toBeTruthy()
    // The in-progress draft is untouched for a later targetless open.
    expect(getOpenDraftId(store, sid)).toBe('dd')
  })

  it('an explicit draftId wins over the pointer', () => {
    const store = createMemoryStore()
    store.setItem(
      draftsKeyFor(sid),
      JSON.stringify({
        version: 1,
        drafts: [
          {id: 'pa', updatedAt: 1, text: 'from pointer'},
          {id: 'pb', updatedAt: 2, text: 'from explicit'},
        ],
      }),
    )
    setOpenDraftId(store, sid, 'pa')
    renderFresh(store, backendFor('sharkey'), {draftId: 'pb'})
    expect(screen.getByTestId('composer-text').props.value).toBe('from explicit')
  })
})

describe('close guard (slice 2)', () => {
  const sid = 'https://s.example me'

  beforeEach(() => {
    pickMediaMock.mockReset()
    pickMediaMock.mockImplementation(async () => ({kind: 'cancelled'}))
  })

  it('clean close calls onClose with no sheet', () => {
    const {onClose} = setup('sharkey')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('composer-close-confirm')).toBeNull()
  })

  it('dirty Cancel shows the sheet and does not close', () => {
    const {onClose} = setup('sharkey')
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    expect(screen.getByTestId('composer-close-confirm')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Save writes the row, clears the pointer, and closes', () => {
    jest.useFakeTimers()
    try {
      const {store, s, onClose} = setup('sharkey')
      fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
      jest.advanceTimersByTime(500)
      expect(getOpenDraftId(store, s.id)).not.toBeNull()
      fireEvent.press(screen.getByTestId('composer-cancel'))
      fireEvent.press(screen.getByTestId('composer-close-save'))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(listDrafts(store, s.id).map(d => d.text)).toEqual(['keep me'])
      expect(getOpenDraftId(store, s.id)).toBeNull()
      expect(screen.queryByTestId('composer-close-confirm')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('Discard deletes the row, clears the pointer, and closes', () => {
    jest.useFakeTimers()
    try {
      const {store, s, onClose} = setup('sharkey')
      fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
      jest.advanceTimersByTime(500)
      expect(getOpenDraftId(store, s.id)).not.toBeNull()
      fireEvent.press(screen.getByTestId('composer-cancel'))
      fireEvent.press(screen.getByTestId('composer-close-discard'))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(listDrafts(store, s.id)).toEqual([])
      expect(getOpenDraftId(store, s.id)).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('Keep writing dismisses the sheet with state intact', () => {
    const {onClose} = setup('sharkey')
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    expect(screen.getByTestId('composer-close-confirm')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-close-keep'))
    expect(screen.queryByTestId('composer-close-confirm')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('composer-text').props.value).toBe('hello')
  })

  it('staged attachments alone count as dirty (uploads-in-progress would be lost)', async () => {
    pickMediaMock.mockResolvedValueOnce({kind: 'picked', files: [attachment()], rejected: []})
    const {store, s, onClose} = setup('sharkey')
    fireEvent.press(screen.getByTestId('composer-media-add'))
    // The staged row renders several `composer-upload-*` nodes (container,
    // alt, sensitivity) — wait on the unique per-upload sensitivity toggle.
    await screen.findByTestId(/^composer-upload-sensitive-/)
    expect(screen.getByTestId('composer-text').props.value).toBe('')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    expect(screen.getByTestId('composer-close-confirm')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('composer-close-discard'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(listDrafts(store, s.id)).toEqual([])
    expect(getOpenDraftId(store, s.id)).toBeNull()
  })
})

describe('server drafts smart default (slice 3)', () => {
  function serverDraftsMock(list: unknown[] = []) {
    // Intersection keeps the jest.Mock methods visible at use sites while
    // satisfying the `ServerDraftsApi` field the backend takes.
    const mock = {
      list: jest.fn(async () => list),
      create: jest.fn(async (d: unknown) => ({id: 'srv-new', ...(d as object)})),
      update: jest.fn(async (id: string, d: unknown) => ({id, ...(d as object)})),
      delete: jest.fn(async () => undefined),
      count: jest.fn(async () => list.length),
    }
    return mock as unknown as ServerDraftsApi & typeof mock
  }

  beforeEach(() => {
    pickMediaMock.mockReset()
    pickMediaMock.mockImplementation(async () => ({kind: 'cancelled'}))
  })

  it('saves to the server when offered and leaves no local row behind', async () => {
    const serverDrafts = serverDraftsMock()
    const {store, s, onClose} = setup('sharkey', {serverDrafts})
    fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    fireEvent.press(screen.getByTestId('composer-close-save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    // Server create (not update — no open server draft), one call.
    expect(serverDrafts.create).toHaveBeenCalledTimes(1)
    expect(serverDrafts.create).toHaveBeenCalledWith(expect.objectContaining({text: 'keep me'}))
    expect(serverDrafts.update).not.toHaveBeenCalled()
    // No double copy: the autosaved local row is gone with the pointer.
    expect(listDrafts(store, s.id)).toEqual([])
    expect(getOpenDraftId(store, s.id)).toBeNull()
  })

  it('falls back to the local save when the server has no drafts endpoint (404)', async () => {
    const serverDrafts = serverDraftsMock()
    serverDrafts.create.mockRejectedValueOnce(new ApiError('unknown endpoint', 404))
    const {store, s, onClose} = setup('sharkey', {serverDrafts})
    fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    fireEvent.press(screen.getByTestId('composer-close-save'))
    // Same outcome as slice 2: local row, pointer cleared, closed, silent.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(listDrafts(store, s.id).map(d => d.text)).toEqual(['keep me'])
    expect(getOpenDraftId(store, s.id)).toBeNull()
    expect(screen.queryByTestId('composer-error')).toBeNull()
  })

  it('surfaces a real server failure and keeps the local copy', async () => {
    const serverDrafts = serverDraftsMock()
    serverDrafts.create.mockRejectedValueOnce(new ApiError('boom', 500))
    const {store, s, onClose} = setup('sharkey', {serverDrafts})
    fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    fireEvent.press(screen.getByTestId('composer-close-save'))
    // Honest error, stays open, nothing dropped: the content is local.
    await waitFor(() => expect(screen.getByTestId('composer-error')).toBeTruthy())
    expect(screen.getByTestId('composer-error')).toHaveTextContent('boom')
    expect(onClose).not.toHaveBeenCalled()
    expect(listDrafts(store, s.id).map(d => d.text)).toEqual(['keep me'])
    expect(screen.queryByTestId('composer-close-confirm')).toBeNull()
  })

  it('opening a server draft saves back as an update, not a duplicate', async () => {
    const serverDrafts = serverDraftsMock([{id: 'srv1', text: 'server words'}])
    const {store, s, onClose} = setup('sharkey', {serverDrafts})
    fireEvent.press(await screen.findByTestId('composer-serverdraft-restore-srv1'))
    expect(screen.getByTestId('composer-text').props.value).toBe('server words')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    fireEvent.press(screen.getByTestId('composer-close-save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(serverDrafts.update).toHaveBeenCalledTimes(1)
    expect(serverDrafts.update).toHaveBeenCalledWith(
      'srv1',
      expect.objectContaining({text: 'server words'}),
    )
    expect(serverDrafts.create).not.toHaveBeenCalled()
    expect(listDrafts(store, s.id)).toEqual([])
    expect(getOpenDraftId(store, s.id)).toBeNull()
  })

  it('stays local-only on Mastodon: no server section, no server call', async () => {
    const {store, s, onClose} = setup('mastodon')
    expect(screen.queryByTestId('composer-server-drafts')).toBeNull()
    fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    fireEvent.press(screen.getByTestId('composer-close-save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(listDrafts(store, s.id).map(d => d.text)).toEqual(['keep me'])
    expect(getOpenDraftId(store, s.id)).toBeNull()
  })

  it('merges both draft sources with location labels', async () => {
    const {store, s} = setup('sharkey', {
      serverDrafts: serverDraftsMock([{id: 'srv1', text: 'server words'}]),
    })
    fireEvent.press(screen.getByTestId('composer-drafts-toggle'))
    expect(await screen.findByTestId('composer-serverdraft-srv1')).toBeTruthy()
    expect(screen.getByText('Server drafts')).toBeTruthy()
    // A local row from another open (the drafts list excludes only the
    // current composer's own row).
    store.setItem(
      draftsKeyFor(s.id),
      JSON.stringify({version: 1, drafts: [{id: 'local1', updatedAt: 1, text: 'local words'}]}),
    )
    fireEvent.changeText(screen.getByTestId('composer-text'), 'typing')
    expect(screen.getByTestId('composer-drafts')).toBeTruthy()
    expect(screen.getByText('On this device')).toBeTruthy()
    expect(screen.getByText('local words')).toBeTruthy()
  })

  it('shows no location labels and no server section on Mastodon', () => {
    const {store, s} = setup('mastodon')
    fireEvent.press(screen.getByTestId('composer-drafts-toggle'))
    store.setItem(
      draftsKeyFor(s.id),
      JSON.stringify({version: 1, drafts: [{id: 'local1', updatedAt: 1, text: 'local words'}]}),
    )
    fireEvent.changeText(screen.getByTestId('composer-text'), 'typing')
    expect(screen.getByTestId('composer-drafts')).toBeTruthy()
    expect(screen.getByText('local words')).toBeTruthy()
    expect(screen.queryByText('On this device')).toBeNull()
    expect(screen.queryByTestId('composer-server-drafts')).toBeNull()
  })
})
