import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {StyleSheet} from 'react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import {ApiError, buildCapabilities, createMemoryStore, fetchComposeLimits, type Account, type Backend, type KeyValueStore, type ServerDraftsApi, type Session} from '@keystone/fedi'

import {meQueryKey} from '#/state/queries/keys'

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
  fetchComposeLimits: jest.fn(async () => ({
    maxChars: 20,
    maxCwChars: null,
    maxMedia: 4,
    maxImageBytes: null,
    maxVideoBytes: null,
    maxPollOptions: 4,
    maxPollOptionChars: null,
    minPollSeconds: null,
    maxPollSeconds: null,
    urlWeight: 23,
    supportedLanguages: null,
    source: 'server',
  })),
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
    // Viewer account for the server-default prefs (repair X6.2 step 4):
    // a blank `ext` means "no server prefs", never an error.
    me: jest.fn().mockResolvedValue({ext: {}}),
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

  it('rejects a sub-5-minute Mastodon poll duration with a translated error and never posts', async () => {
    // A restored draft or redraft seed can carry any duration (only the
    // chips are >= 300 s): submit validates with a message, and the wire
    // never sees the short expiry (fedi clamps as a backstop).
    const sid = 'https://s.example me'
    const store = createMemoryStore()
    store.setItem(
      draftsKeyFor(sid),
      JSON.stringify({
        version: 1,
        drafts: [
          {
            id: 'dp',
            updatedAt: Date.now(),
            text: 'vote',
            pollChoices: ['yes', 'no'],
            pollMultiple: false,
            pollHideTotals: false,
            pollDurationSeconds: 60,
          },
        ],
      }),
    )
    setOpenDraftId(store, sid, 'dp')
    const backend = backendFor('mastodon')
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <I18nProvider i18n={i18n}>
          <ThemeProvider>
            <Composer
              session={session('mastodon', 'mastodon')}
              backend={backend}
              store={store}
              onClose={() => {}}
            />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('composer-poll')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-submit'))
    expect(await screen.findByTestId('composer-error')).toHaveTextContent(/at least 5 minutes/)
    expect(backend.createPost).not.toHaveBeenCalled()
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
        drafts: [{id: 'dd', updatedAt: Date.now(), text: 'from before', visibilityRaw: 'followers'}],
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
        drafts: [{id: 'dd', updatedAt: Date.now(), text: 'reply text', replyToId: 'p1', quoteId: 'p2'}],
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

  it('closes an unedited edit silently with no Save option (F2)', () => {
    // Repair X6.1 F2: dirtiness is a diff against the seeded post — an
    // untouched edit is clean, so Cancel closes at once. Before the fix
    // the seeded text always counted as dirty and the sheet appeared.
    const editing = {
      id: 'p9',
      content: {mfm: 'orig', plain: 'orig'},
      cw: null,
      visibility: {kind: 'public', localOnly: false, raw: 'public'},
      mediaIds: [],
      media: [],
      author: {id: 'me'},
    } as never
    const {onClose} = setup('sharkey', {}, {editing})
    fireEvent.press(screen.getByTestId('composer-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('composer-close-confirm')).toBeNull()
  })

  it('a dirty edit offers Discard/Keep only, never Save (F2)', async () => {
    const editing = {
      id: 'p9',
      content: {mfm: 'orig', plain: 'orig'},
      cw: null,
      visibility: {kind: 'public', localOnly: false, raw: 'public'},
      mediaIds: [],
      media: [],
      author: {id: 'me'},
    } as never
    const store = createMemoryStore()
    const s = session('misskey', 'sharkey')
    // A backend WITH server drafts: before the fix the save button rode
    // the section even in edit mode; after the fix it is hidden.
    const serverDrafts = {list: jest.fn(async () => [])} as never
    const backend = backendFor('sharkey', {editPost: jest.fn().mockResolvedValue(editing), serverDrafts})
    const onClose = jest.fn()
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <I18nProvider i18n={i18n}>
          <ThemeProvider>
            <Composer session={s} backend={backend} store={store} editing={editing} onClose={onClose} />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    )
    fireEvent.changeText(screen.getByTestId('composer-text'), 'fixed')
    fireEvent.press(screen.getByTestId('composer-cancel'))
    expect(screen.getByTestId('composer-close-confirm')).toBeTruthy()
    // No "Save as draft" in edit mode — neither close-guard nor server.
    expect(screen.queryByTestId('composer-close-save')).toBeNull()
    expect(screen.queryByTestId('composer-serverdraft-save')).toBeNull()
    expect(screen.getByTestId('composer-close-discard')).toBeTruthy()
    expect(screen.getByTestId('composer-close-keep')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-close-discard'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(listDrafts(store, s.id)).toEqual([])
    expect(getOpenDraftId(store, s.id)).toBeNull()
  })

  it('a killed edit never prefills the next new post (F2)', () => {
    // Before the fix the 400ms autosave wrote the seeded edit text as a
    // new-post draft and set the pointer, so the next fresh composer
    // opened prefilled. After the fix edit mode never autosaves.
    jest.useFakeTimers()
    try {
      const editing = {
        id: 'p9',
        content: {mfm: 'orig', plain: 'orig'},
        cw: null,
        visibility: {kind: 'public', localOnly: false, raw: 'public'},
        mediaIds: [],
        media: [],
        author: {id: 'me'},
      } as never
      const store = createMemoryStore()
      const s = session('misskey', 'sharkey')
      const backend = backendFor('sharkey', {editPost: jest.fn().mockResolvedValue(editing)})
      const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
      const first = render(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <Composer session={s} backend={backend} store={store} editing={editing} onClose={() => {}} />
          </ThemeProvider>
        </QueryClientProvider>,
      )
      fireEvent.changeText(screen.getByTestId('composer-text'), 'touched during edit')
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(listDrafts(store, s.id)).toEqual([])
      expect(getOpenDraftId(store, s.id)).toBeNull()
      first.unmount()
      render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <ThemeProvider>
            <Composer session={s} backend={backendFor('sharkey')} store={store} onClose={() => {}} />
          </ThemeProvider>
        </QueryClientProvider>,
      )
      expect(screen.getByTestId('composer-text').props.value).toBe('')
    } finally {
      jest.useRealTimers()
    }
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
    // post create call. The opts also carry the per-upload abort signal
    // (repair X7.4 step 1), so the assertion is a subset match.
    expect(backend.uploadMedia).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({isSensitive: true}),
    )
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
    expect(backend.uploadMedia).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({}))
  })

  it('shows denied access instead of a silent cancel', async () => {
    pickMediaMock.mockResolvedValueOnce({kind: 'denied', canAskAgain: true})
    setup('sharkey')
    fireEvent.press(screen.getByTestId('composer-media-add'))
    expect(await screen.findByTestId('composer-error')).toHaveTextContent(/Media library access was denied/)
    expect(screen.queryByTestId(/^composer-upload-/)).toBeNull()
  })

  it('refuses an over-cap pick with an honest error and stages nothing', async () => {
    pickMediaMock.mockResolvedValueOnce({kind: 'picked', files: [], rejected: [{name: 'huge.mp4', limit: 100, reason: 'too-large'}]})
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

describe('sheet keyboard helpers (X6.5 single-mechanism)', () => {
  it('sheetKeyboardInset is retired (always 0): padding never stacks with the cap', () => {
    expect(sheetKeyboardInset('ios', 300)).toBe(0)
    expect(sheetKeyboardInset('android', 300)).toBe(0)
    expect(sheetKeyboardInset('web', 300)).toBe(0)
    expect(sheetKeyboardInset('ios', 0)).toBe(0)
    expect(sheetKeyboardInset('ios', -10)).toBe(0)
    expect(sheetKeyboardInset('ios', Number.NaN)).toBe(0)
  })

  it('sheetVisibleMaxHeight caps Android mobile cards to the visible area only', () => {
    expect(sheetVisibleMaxHeight('android', 'mobile', 800, 0)).toBe(800)
    expect(sheetVisibleMaxHeight('android', 'mobile', 800, 300)).toBe(500)
  })

  it('sheetVisibleMaxHeight leaves iOS (KAV-owned), desktop and web cards alone', () => {
    expect(sheetVisibleMaxHeight('ios', 'mobile', 800, 300)).toBeUndefined()
    expect(sheetVisibleMaxHeight('ios', 'mobile', 800, 0)).toBeUndefined()
    expect(sheetVisibleMaxHeight('android', 'rail', 800, 300)).toBeUndefined()
    expect(sheetVisibleMaxHeight('android', 'full', 800, 300)).toBeUndefined()
    expect(sheetVisibleMaxHeight('web', 'mobile', 800, 300)).toBeUndefined()
    expect(sheetVisibleMaxHeight('android', 'mobile', 0, 300)).toBeUndefined()
  })
})

describe('open-draft pointer (slice 1)', () => {
  const sid = 'https://s.example me'

  function renderFresh(
    store: KeyValueStore,
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

  it('autosave failure shows a non-blocking notice and recovers on the next save', () => {
    jest.useFakeTimers()
    try {
      const mem = createMemoryStore()
      let failing = true
      const store: KeyValueStore = {
        getItem: key => mem.getItem(key),
        setItem: (key, value) => {
          if (failing) throw new Error('locked')
          mem.setItem(key, value)
          return true
        },
        removeItem: key => mem.removeItem(key),
      }
      renderFresh(store, backendFor('sharkey'))
      fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
      act(() => {
        jest.advanceTimersByTime(500)
      })
      // Non-blocking: the composer stays usable, the notice explains.
      expect(screen.getByTestId('composer-notice')).toBeTruthy()
      expect(screen.getByText('Could not save the draft on this device.')).toBeTruthy()
      expect(listDrafts(mem, sid)).toEqual([])
      // The next successful save clears the notice and persists.
      failing = false
      fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me!')
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(screen.queryByTestId('composer-notice')).toBeNull()
      expect(listDrafts(mem, sid)).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('autosave treats throwing reads as a failed save (call-site guard)', () => {
    jest.useFakeTimers()
    try {
      const mem = createMemoryStore()
      const store: KeyValueStore = {
        getItem: key => {
          // Reads of the draft list itself fail; everything else works,
          // so the composer mounts and only the autosave suffers.
          if (key === draftsKeyFor(sid)) throw new Error('locked')
          return mem.getItem(key)
        },
        setItem: (key, value) => {
          mem.setItem(key, value)
          return true
        },
        removeItem: key => mem.removeItem(key),
      }
      renderFresh(store, backendFor('sharkey'))
      fireEvent.changeText(screen.getByTestId('composer-text'), 'keep me')
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(screen.getByTestId('composer-notice')).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })

  it('submit deletes the draft and clears the pointer', async () => {
    const store = createMemoryStore()
    seedRow(store, {id: 'd9', updatedAt: Date.now(), text: 'bye'})
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
      updatedAt: Date.now(),
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
    // hadMedia is false so there is no attachments warning — but the
    // restored draft is `specified`, and specified drafts are never
    // autosaved (repair X6.2 step 7), so the direct-draft notice shows.
    expect(screen.getByTestId('composer-notice')).toHaveTextContent(/aren't autosaved/)
    // Targets re-attach through the same path as `draftId` restores.
    expect(await screen.findByTestId('composer-reply-preview')).toBeTruthy()
    expect(await screen.findByText('hello there')).toBeTruthy()
  })

  it('pointer restore warns about dropped attachments only when media were staged', async () => {
    const store = createMemoryStore()
    seedRow(store, {id: 'dd', updatedAt: Date.now(), text: 'with media', hadMedia: true})
    setOpenDraftId(store, sid, 'dd')
    const first = renderFresh(store, backendFor('sharkey'))
    expect(screen.getByTestId('composer-notice')).toHaveTextContent(/Attachments aren't kept/)
    first.unmount()
    seedRow(store, {id: 'dd', updatedAt: Date.now(), text: 'without media', hadMedia: false})
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
    seedRow(store, {id: 'dd', updatedAt: Date.now(), text: 'unrelated'})
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
          {id: 'pa', updatedAt: Date.now(), text: 'from pointer'},
          {id: 'pb', updatedAt: Date.now(), text: 'from explicit'},
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
      JSON.stringify({version: 1, drafts: [{id: 'local1', updatedAt: Date.now(), text: 'local words'}]}),
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
      JSON.stringify({version: 1, drafts: [{id: 'local1', updatedAt: Date.now(), text: 'local words'}]}),
    )
    fireEvent.changeText(screen.getByTestId('composer-text'), 'typing')
    expect(screen.getByTestId('composer-drafts')).toBeTruthy()
    expect(screen.getByText('local words')).toBeTruthy()
    expect(screen.queryByText('On this device')).toBeNull()
    expect(screen.queryByTestId('composer-server-drafts')).toBeNull()
  })
})

describe('limits verification (repair X6.2 steps 1-2)', () => {
  const SERVER_LIMITS = {
    maxChars: 20,
    maxCwChars: null,
    maxMedia: 4,
    maxImageBytes: null,
    maxVideoBytes: null,
    maxPollOptions: 4,
    maxPollOptionChars: null,
    minPollSeconds: null,
    maxPollSeconds: null,
    urlWeight: 23,
    supportedLanguages: null,
    source: 'server' as const,
  }
  const FALLBACK_LIMITS = {...SERVER_LIMITS, source: 'fallback' as const}

  beforeEach(() => {
    pickMediaMock.mockReset()
    pickMediaMock.mockImplementation(async () => ({kind: 'cancelled'}))
  })

  it('posts over the fallback cap when limits are unverified, with a notice', async () => {
    ;(fetchComposeLimits as unknown as jest.Mock).mockResolvedValueOnce(FALLBACK_LIMITS)
    const {backend, onClose} = setup('sharkey')
    fireEvent.changeText(screen.getByTestId('composer-text'), 'a'.repeat(25))
    await waitFor(() => expect(screen.getByTestId('composer-limit-unverified')).toBeTruthy())
    // Not hard-blocked: the button stays enabled past the guessed cap.
    expect(screen.getByTestId('composer-submit')).not.toBeDisabled()
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(backend.createPost).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalled()
  })

  it('rejects a sub-5-minute Mastodon schedule with a translated error and never posts', async () => {
    const sid = 'https://s.example me'
    const store = createMemoryStore()
    const soon = new Date(Date.now() + 60_000).toISOString()
    store.setItem(
      draftsKeyFor(sid),
      JSON.stringify({version: 1, drafts: [{id: 'ds', updatedAt: Date.now(), text: 'soon', scheduledAt: soon}]}),
    )
    setOpenDraftId(store, sid, 'ds')
    const scheduled = {
      list: jest.fn(async () => []),
      create: jest.fn(),
      delete: jest.fn(),
    }
    const backend = backendFor('mastodon', {scheduled})
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <I18nProvider i18n={i18n}>
          <ThemeProvider>
            <Composer
              session={session('mastodon', 'mastodon')}
              backend={backend}
              store={store}
              onClose={() => {}}
            />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('composer-text').props.value).toBe('soon')
    fireEvent.press(screen.getByTestId('composer-submit'))
    expect(await screen.findByTestId('composer-error')).toHaveTextContent(/5 minutes/)
    expect(backend.createPost).not.toHaveBeenCalled()
    expect(scheduled.create).not.toHaveBeenCalled()
  })
})

describe('sensitive and language (repair X6.2 step 5)', () => {
  beforeEach(() => {
    pickMediaMock.mockReset()
    pickMediaMock.mockImplementation(async () => ({kind: 'cancelled'}))
  })

  it('marks media sensitive on Mastodon and sends it with the post', async () => {
    const {backend} = setup('mastodon')
    expect(screen.getByTestId('composer-sensitive-language')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-sensitive-toggle'))
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(backend.createPost).toHaveBeenCalledTimes(1))
    expect(backend.createPost).toHaveBeenCalledWith(expect.objectContaining({sensitive: true}))
  })

  it('sends nothing sensitive by default', async () => {
    const {backend} = setup('mastodon')
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(backend.createPost).toHaveBeenCalledTimes(1))
    expect((backend.createPost as jest.Mock).mock.calls[0][0]).not.toHaveProperty('sensitive')
  })

  it('hides sensitivity and language on the Misskey family', () => {
    setup('sharkey')
    expect(screen.queryByTestId('composer-sensitive-language')).toBeNull()
    expect(screen.queryByTestId('composer-sensitive-toggle')).toBeNull()
  })

  it('picks a server-reported language on Mastodon and sends it', async () => {
    ;(fetchComposeLimits as unknown as jest.Mock).mockResolvedValueOnce({
      maxChars: 500,
      maxCwChars: null,
      maxMedia: 4,
      maxImageBytes: null,
      maxVideoBytes: null,
      maxPollOptions: 4,
      maxPollOptionChars: null,
      minPollSeconds: null,
      maxPollSeconds: null,
      urlWeight: 23,
      supportedLanguages: ['en', 'ja'],
      source: 'server' as const,
    })
    const {backend} = setup('mastodon')
    fireEvent.press(await screen.findByTestId('composer-language-ja'))
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(backend.createPost).toHaveBeenCalledTimes(1))
    expect(backend.createPost).toHaveBeenCalledWith(expect.objectContaining({language: 'ja'}))
  })

  it('hides the language picker when the server reports none', () => {
    setup('mastodon')
    // The section renders (sensitivity is a fixed Mastodon capability) but
    // no language chips: the list is never faked.
    expect(screen.getByTestId('composer-sensitive-language')).toBeTruthy()
    expect(screen.queryByTestId('composer-language-en')).toBeNull()
  })
})

describe('server default visibility (repair X6.2 step 4)', () => {
  const sid = 'https://s.example me'

  function accountWithSource(source: Record<string, unknown>): Account {
    return {ext: {mastodon: {source}}} as unknown as Account
  }

  function renderFresh(store: ReturnType<typeof createMemoryStore>, backend: Backend) {
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const tree = render(
      <QueryClientProvider client={qc}>
        <I18nProvider i18n={i18n}>
          <ThemeProvider>
            <Composer
              session={session('mastodon', 'mastodon')}
              backend={backend}
              store={store}
              onClose={() => {}}
            />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    )
    return {qc, unmount: tree.unmount}
  }

  beforeEach(() => {
    pickMediaMock.mockReset()
    pickMediaMock.mockImplementation(async () => ({kind: 'cancelled'}))
  })

  it('seeds create visibility from a cached server default', () => {
    const store = createMemoryStore()
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    qc.setQueryData(meQueryKey(sid), accountWithSource({privacy: 'private'}))
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <Composer
            session={session('mastodon', 'mastodon')}
            backend={backendFor('mastodon')}
            store={store}
            onClose={() => {}}
          />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('composer-vis-private').props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.getByTestId('composer-vis-public').props.accessibilityState).toMatchObject({
      selected: false,
    })
  })

  it('an unknown server raw narrows to followers-only, never public', () => {
    const store = createMemoryStore()
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    qc.setQueryData(meQueryKey(sid), accountWithSource({privacy: 'list:weird'}))
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <Composer
            session={session('mastodon', 'mastodon')}
            backend={backendFor('mastodon')}
            store={store}
            onClose={() => {}}
          />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('composer-vis-private').props.accessibilityState).toMatchObject({
      selected: true,
    })
  })

  it('applies async-arriving prefs to a pristine composer, never over user input', async () => {
    const store = createMemoryStore()
    const backend = backendFor('mastodon')
    const first = renderFresh(store, backend)
    // No server prefs yet: today's family default.
    expect(screen.getByTestId('composer-vis-public').props.accessibilityState).toMatchObject({
      selected: true,
    })
    // Let the mount fetch settle first: otherwise its empty `{ext: {}}`
    // resolution can land after the injected prefs below and clobber them
    // in the cache (a test-harness race — the mock resolves empty while a
    // real server resolves its prefs).
    await waitFor(() => expect(backend.me).toHaveBeenCalled())
    await waitFor(() =>
      expect(first.qc.getQueryState(meQueryKey(sid))?.dataUpdatedAt ?? 0).toBeGreaterThan(0),
    )
    act(() => {
      first.qc.setQueryData(meQueryKey(sid), accountWithSource({privacy: 'private'}))
    })
    await waitFor(() =>
      expect(screen.getByTestId('composer-vis-private').props.accessibilityState).toMatchObject({
        selected: true,
      }),
    )
    first.unmount()

    // Second composer: the user typed first — late prefs do not overwrite.
    const store2 = createMemoryStore()
    const second = renderFresh(store2, backendFor('mastodon'))
    fireEvent.changeText(screen.getByTestId('composer-text'), 'my words')
    act(() => {
      second.qc.setQueryData(meQueryKey(sid), accountWithSource({privacy: 'private'}))
    })
    expect(screen.getByTestId('composer-vis-public').props.accessibilityState).toMatchObject({
      selected: true,
    })
    second.unmount()
  })
})

describe('direct draft gating, eviction, flush (repair X6.2 step 7)', () => {
  beforeEach(() => {
    pickMediaMock.mockReset()
    pickMediaMock.mockImplementation(async () => ({kind: 'cancelled'}))
  })

  it('never autosaves direct drafts to disk, but an explicit Save keeps them', () => {
    jest.useFakeTimers()
    try {
      const {store, s, onClose} = setup('sharkey')
      fireEvent.press(screen.getByTestId('composer-vis-specified'))
      fireEvent.changeText(screen.getByTestId('composer-text'), 'secret plans')
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(listDrafts(store, s.id)).toEqual([])
      expect(screen.getByTestId('composer-notice')).toHaveTextContent(/aren't autosaved/)
      // Explicit Save writes the direct draft (the user asked for it).
      fireEvent.press(screen.getByTestId('composer-cancel'))
      fireEvent.press(screen.getByTestId('composer-close-save'))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(listDrafts(store, s.id).map(d => d.text)).toEqual(['secret plans'])
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows a notice when the 26th draft evicts the oldest', () => {
    jest.useFakeTimers()
    try {
      const {store, s} = setup('sharkey')
      const now = Date.now()
      store.setItem(
        draftsKeyFor(s.id),
        JSON.stringify({
          version: 1,
          drafts: Array.from({length: 25}, (_, i) => ({id: `d${i}`, updatedAt: now + i, text: `old ${i}`})),
        }),
      )
      fireEvent.changeText(screen.getByTestId('composer-text'), 'one more')
      act(() => {
        jest.advanceTimersByTime(500)
      })
      const ids = listDrafts(store, s.id).map(d => d.id)
      expect(ids).toHaveLength(25)
      expect(ids).not.toContain('d0')
      expect(screen.getByTestId('composer-notice')).toHaveTextContent(/oldest draft/)
    } finally {
      jest.useRealTimers()
    }
  })

  it('flushes a pending autosave on unmount (rn-ui L2)', () => {
    jest.useFakeTimers()
    try {
      const store = createMemoryStore()
      const s = session('misskey', 'sharkey')
      const backend = backendFor('sharkey')
      const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
      const first = render(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <Composer session={s} backend={backend} store={store} onClose={() => {}} />
          </ThemeProvider>
        </QueryClientProvider>,
      )
      fireEvent.changeText(screen.getByTestId('composer-text'), 'last words')
      // No timer advance: the debounced save has not run yet.
      expect(listDrafts(store, s.id)).toEqual([])
      first.unmount()
      expect(listDrafts(store, s.id).map(d => d.text)).toEqual(['last words'])
      expect(getOpenDraftId(store, s.id)).not.toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})
