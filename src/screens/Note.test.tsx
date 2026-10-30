import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {FlatList, RefreshControl, StyleSheet} from 'react-native'

import type {Capabilities, Session} from '@keystone/fedi'
import {FEATURE_KEYS} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {SessionProvider} from '#/state/session/SessionProvider'

import {makeAccount, makePost} from '#/components/__tests__/fixtures'
import {NoteScreen, isChainCapped} from './Note'

// Post-detail screen tests (v1 `Note` parity): the focused post renders with
// its ancestors above and its replies below, the inline composer posts a
// reply to the focused post, and a failed load is an honest error state
// — never faked thread data.

const mockNavigate = jest.fn()
const mockGoBack = jest.fn()
const mockGoBackOrFeed = jest.fn()
jest.mock('#/components/shell/shellNav', () => ({
  ...jest.requireActual('#/components/shell/shellNav'),
  goBackOrFeed: (...args: Array<unknown>) => (mockGoBackOrFeed as (...a: Array<unknown>) => void)(...args),
}))
// Captured focus callbacks: the mock records instead of subscribing, so
// tests drive "mount focus" vs "return focus" deterministically. Like the
// real hook, subscribing while focused executes immediately — mount and
// resubscribe alike — so a variant that resubscribes every render would
// refetch here without any focus event.
const mockFocusCbs: Array<() => void> = []
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useRoute: () => ({params: {id: 'p1'}}),
  useFocusEffect: (cb: () => void) => {
    const prev = mockFocusCbs[mockFocusCbs.length - 1]
    mockFocusCbs.push(cb)
    if (prev !== cb) cb()
  },
}))

function lastFocusEffect(): () => void {
  const cb = mockFocusCbs[mockFocusCbs.length - 1]
  if (!cb) throw new Error('no focus effect captured')
  return cb
}

// File-level: every describe below mounts its own NoteScreen instances,
// so the captured-callback log resets for every test. The post-shadow
// store is a module singleton shared across mounts: reset it too, or the
// F20 delete test's `isDeleted` patch on p1 leaks into every later test
// mounting the focused post (its card returns null when shadow-deleted).
beforeEach(async () => {
  mockFocusCbs.length = 0
  const {postShadowStore} = await import('#/state/cache')
  postShadowStore.reset()
})

const mockBackends = new Map<string, unknown>()
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

i18n.load('en', {})
i18n.activate('en')

const SESSION: Session = {
  id: 'note-test-session',
  origin: 'https://a.example',
  family: 'misskey',
  flavor: 'misskey',
  accountId: 'a1',
  token: 't',
  grant: 'miauth',
  hosting: 'external',
} as unknown as Session

const caps = (): Capabilities => {
  const c = {} as Record<string, string>
  for (const k of FEATURE_KEYS) c[k] = 'unknown'
  return {...c, reactions: 'supported', quote_posting: 'supported'} as Capabilities
}

function fakeBackend(over: Record<string, unknown> = {}) {
  const ancestor = makePost({
    id: 'a0',
    content: {mfm: 'ancestor post', plain: 'ancestor post'},
  })
  const focused = makePost({
    id: 'p1',
    replyToId: 'a0',
    reply: ancestor,
    content: {mfm: 'focused post', plain: 'focused post'},
  })
  const reply = makePost({
    id: 'r1',
    replyToId: 'p1',
    content: {mfm: 'child reply', plain: 'child reply'},
  })
  return {
    family: 'misskey',
    capabilities: caps(),
    ancestor,
    focused,
    reply,
    post: jest.fn(async () => focused),
    thread: jest.fn(async () => ({ancestors: [ancestor], incomplete: false})),
    threadReplies: jest.fn(async (id: string) => ({
      // Only the focused post has a reply here; chains under anything
      // else are empty (an id-blind mock would render the reply as its
      // own child once chains go inline).
      items: id === 'p1' ? [reply] : [],
      cursor: null,
      end: true,
    })),
    createPost: jest.fn(async (draft: {replyId?: string; text?: string}) =>
      makePost({
        id: 'r-new',
        replyToId: draft.replyId ?? 'p1',
        content: {mfm: draft.text ?? '', plain: draft.text ?? ''},
      }),
    ),
    ...over,
  }
}

function setup(backend: ReturnType<typeof fakeBackend>) {
  mockBackends.set(SESSION.id, backend)
  const snap = {sessions: [SESSION], activeId: SESSION.id}
  const store = {
    subscribe: () => () => {},
    getSnapshot: () => snap,
    initialize: () => {},
    hydrate: async () => {},
  }
  const qc = new QueryClient({
    // No cross-test cache reliance (fresh client per mount): collect
    // inactive queries immediately instead of lingering them for 60s —
    // 33 mounts in one worker otherwise pile up heap/GC pressure and
    // starve the heavy tests (compact ancestors, 64-deep cycle reveal).
    defaultOptions: {queries: {retry: false, gcTime: 60_000}},
  })
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider homeOrigin="https://a.example" store={store as never}>
          <QueryClientProvider client={qc}>
            <NoteScreen />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return backend
}

describe('NoteScreen', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockGoBack.mockClear()
    mockBackends.clear()
    mockFocusCbs.length = 0
  })

  it('loads the focused post with ancestors above and replies below', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    expect(screen.getByTestId('ancestor-a0')).toBeTruthy()
    expect(screen.getByTestId('focused-p1')).toBeTruthy()
    expect(screen.getByTestId('inline-reply')).toBeTruthy()
    expect(screen.getByTestId('inline-reply-placeholder')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
  })

  it('the collapsed inline composer keeps body metrics; centering is layout-only', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('inline-reply-placeholder')).toBeTruthy())
    expect(screen.getByTestId('inline-reply-submit')).toBeTruthy()
    // Collapsed renders no TextInput at all — the placeholder is plain
    // text, so internal input text layout cannot misalign it.
    expect(screen.queryByTestId('inline-reply-input')).toBeNull()
    expect(screen.queryByTestId('inline-reply-media')).toBeNull()
    expect(screen.queryByTestId('inline-reply-emoji')).toBeNull()
    // Collapsed is one compact row — avatar, placeholder, and Reply pill
    // share a vertically centered row.
    const row = StyleSheet.flatten(screen.getByTestId('inline-reply').props.style)
    expect(row.flexDirection).toBe('row')
    expect(row.alignItems).toBe('center')
    // The placeholder is body prose, same metrics as the expanded input.
    const labelStyle = StyleSheet.flatten(screen.getByText('Post your reply').props.style)
    expect(labelStyle.fontSize).toBe(15)
    expect(labelStyle.lineHeight).toBe(21)
    // The placeholder pressable fills the row height with centered
    // content — the centering is layout-only, never a smaller font.
    const placeholder = screen.getByTestId('inline-reply-placeholder')
    expect(placeholder.props.accessibilityRole).toBe('button')
    expect(placeholder.props.accessibilityLabel).toBe('Post your reply')
    const wrap = StyleSheet.flatten(placeholder.props.style)
    expect(wrap.alignSelf).toBe('stretch')
    expect(wrap.justifyContent).toBe('center')
  })

  it('tapping the placeholder expands to the real input with its toolbar, sticky after blur', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('inline-reply-placeholder')).toBeTruthy())
    fireEvent.press(screen.getByTestId('inline-reply-placeholder'))
    expect(screen.getByTestId('inline-reply-input')).toBeTruthy()
    expect(screen.getByTestId('inline-reply-media')).toBeTruthy()
    expect(screen.getByTestId('inline-reply-emoji')).toBeTruthy()
    // Expanded: the taller growing input replaces the single-line row.
    const input = StyleSheet.flatten(screen.getByTestId('inline-reply-input').props.style)
    expect(input.minHeight).toBe(40)
    // No collapse behavior: blur keeps the toolbar.
    fireEvent(screen.getByTestId('inline-reply-input'), 'blur')
    expect(screen.getByTestId('inline-reply-media')).toBeTruthy()
    expect(screen.getByTestId('inline-reply-emoji')).toBeTruthy()
  })

  it('the emoji button inserts at the caret', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('inline-reply-placeholder')).toBeTruthy())
    fireEvent.press(screen.getByTestId('inline-reply-placeholder'))
    fireEvent.changeText(screen.getByTestId('inline-reply-input'), 'hello')
    fireEvent.press(screen.getByTestId('inline-reply-emoji'))
    await waitFor(() => expect(screen.getByTestId('inline-reply-emoji-popup')).toBeTruthy())
    // The 😀 glyph is proven in the picker model test to match its own
    // unicode section, so the search narrows to one cell.
    fireEvent.changeText(screen.getByTestId('emoji-search'), '😀')
    await waitFor(() => expect(screen.getByTestId('emoji-cell-😀')).toBeTruthy())
    fireEvent.press(screen.getByTestId('emoji-cell-😀'))
    await waitFor(() =>
      expect(screen.getByTestId('inline-reply-input').props.value).toContain('😀'),
    )
    expect(screen.queryByTestId('inline-reply-emoji-popup')).toBeNull()
  })

  it('the inline composer posts a reply to the focused post and shows it without leaving (E10)', async () => {
    const backend = setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('inline-reply-placeholder')).toBeTruthy())
    // Gated while empty: pressing Reply with no text or media posts nothing.
    fireEvent.press(screen.getByTestId('inline-reply-submit'))
    expect(backend.createPost).not.toHaveBeenCalled()
    const before = backend.threadReplies.mock.calls.filter((c: unknown[]) => c[0] === 'p1').length
    fireEvent.press(screen.getByTestId('inline-reply-placeholder'))
    fireEvent.changeText(screen.getByTestId('inline-reply-input'), 'hello')
    fireEvent.press(screen.getByTestId('inline-reply-submit'))
    await waitFor(() => expect(backend.createPost).toHaveBeenCalled())
    const draft = backend.createPost.mock.calls[0][0] as {replyId?: string}
    expect(draft.replyId).toBe('p1')
    // The posted reply appears without leaving: the thread-replies key
    // this screen reads is invalidated on success.
    await waitFor(() =>
      expect(
        backend.threadReplies.mock.calls.filter((c: unknown[]) => c[0] === 'p1').length,
      ).toBeGreaterThan(before),
    )
    // The input clears on success.
    await waitFor(() => expect(screen.getByTestId('inline-reply-input').props.value).toBe(''))
  })

  it('a failed reply posts an honest inline error and keeps the text', async () => {
    const backend = setup(fakeBackend({createPost: jest.fn(async () => { throw new Error('nope') })}))
    await waitFor(() => expect(screen.getByTestId('inline-reply-placeholder')).toBeTruthy())
    fireEvent.press(screen.getByTestId('inline-reply-placeholder'))
    fireEvent.changeText(screen.getByTestId('inline-reply-input'), 'hello')
    fireEvent.press(screen.getByTestId('inline-reply-submit'))
    await waitFor(() => expect(screen.getByTestId('inline-reply-error')).toBeTruthy())
    expect(screen.getByTestId('inline-reply-input').props.value).toBe('hello')
    expect(backend.createPost).toHaveBeenCalled()
  })

  it('a failed thread load is an error state, never faked data', async () => {
    setup(fakeBackend({post: jest.fn(async () => { throw new Error('gone') })}))
    await waitFor(() => expect(screen.getByTestId('thread-retry')).toBeTruthy())
    expect(screen.queryByTestId('thread-body')).toBeNull()
    expect(screen.queryByText('focused post')).toBeNull()
    expect(screen.queryByText('ancestor post')).toBeNull()
  })

  it('names server rate limiting honestly, like the profile screen (R2.4)', async () => {
    const {ApiError} = await import('@keystone/fedi')
    setup(fakeBackend({post: jest.fn(async () => { throw new ApiError('Too many requests.', 429, 'errors.network.apiError') })}))
    await waitFor(() => expect(screen.getByTestId('thread-rate-limited')).toBeTruthy())
    expect(screen.getByText(/throttling requests/)).toBeTruthy()
    expect(screen.queryByText(/deleted, private/)).toBeNull()
    // Retry still re-fetches the thread.
    fireEvent.press(screen.getByTestId('thread-retry'))
    await waitFor(() => expect(screen.getByTestId('thread-retry')).toBeTruthy())
  })

  it('keys root reply rows by session, like every other feed list (R2.4)', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    const list = screen.UNSAFE_getByType(FlatList)
    const keyExtractor = list.props.keyExtractor as (item: {id: string}) => string
    expect(keyExtractor({id: 'r1'})).toBe('note-test-session:r1')
  })

  it('failed replies keep the focused post with a retry, not fake replies', async () => {
    setup(
      fakeBackend({threadReplies: jest.fn(async () => { throw new Error('nope') })}),
    )
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    expect(screen.getByTestId('focused-p1')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('replies-retry-p1')).toBeTruthy())
    expect(screen.queryByText('child reply')).toBeNull()
  })

  it('shows the containing clips (F20 in-clips row)', async () => {
    setup(
      fakeBackend({
        clips: {containing: jest.fn(async () => [{id: 'c1', name: 'Fun'}])},
      }),
    )
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    expect(await screen.findByTestId('in-clips-p1')).toBeTruthy()
    expect(screen.getByTestId('in-clip-c1')).toBeTruthy()
    // navigationRef is not ready in this tree, so the tap is a safe no-op.
    fireEvent.press(screen.getByTestId('in-clip-c1'))
    expect(screen.getByTestId('in-clip-c1')).toBeTruthy()
  })

  it('hides the in-clips row without clips support or when empty', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    expect(screen.queryByTestId('in-clips-p1')).toBeNull()
  })

  it('renders the thread as a single FlatList of flat rows, never pills or dead-ends', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    // The thread body IS the FlatList (header = ancestors + focused +
    // inline composer + tabs, rows = root replies with flat chains).
    expect(screen.UNSAFE_getByType(FlatList)).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
    // No Show/Hide pills, no show-more (a childless only reply keeps its
    // chain silent), no dead-end caption, no indent wrappers.
    expect(screen.queryByTestId('show-replies-r1')).toBeNull()
    expect(screen.queryByTestId('hide-replies-r1')).toBeNull()
    expect(screen.queryAllByTestId(/show-more-replies-/)).toHaveLength(0)
    expect(screen.queryAllByTestId(/thread-edge-/)).toHaveLength(0)
    expect(screen.queryByText(/too deep/)).toBeNull()
  })
})

describe('NoteScreen detail tabs (F19)', () => {
  const booster = makeAccount({id: 'b1', username: 'bob'})
  const reactor = makeAccount({id: 'c1', username: 'carol'})

  function tabbedBackend(over: Record<string, unknown> = {}) {
    return fakeBackend({
      reposts: jest.fn(async () => ({items: [booster], cursor: null, end: true})),
      noteReactions: jest.fn(async () => ({
        items: [{id: 'nr1', createdAt: '2026-10-20T00:00:00.000Z', reaction: '👍', account: reactor}],
        cursor: null,
        end: true,
      })),
      ...over,
    })
  }

  it('shows reply/repost/reaction tabs with the actors', async () => {
    setup(tabbedBackend())
    await waitFor(() => expect(screen.getByTestId('note-tabs')).toBeTruthy())
    fireEvent.press(screen.getByTestId('note-tab-reposts'))
    await waitFor(() => expect(screen.getByTestId('reposts-p1')).toBeTruthy())
    expect(screen.getByTestId('account-row-b1')).toBeTruthy()
    fireEvent.press(screen.getByTestId('note-tab-reactions'))
    await waitFor(() => expect(screen.getByTestId('reactions-p1')).toBeTruthy())
    expect(screen.getByText('👍')).toBeTruthy()
    expect(screen.getByTestId('account-row-c1')).toBeTruthy()
  })

  it('a failed reactions load is an honest error with a retry', async () => {
    setup(tabbedBackend({noteReactions: jest.fn(async () => { throw new Error('nope') })}))
    await waitFor(() => expect(screen.getByTestId('note-tabs')).toBeTruthy())
    fireEvent.press(screen.getByTestId('note-tab-reactions'))
    await waitFor(() => expect(screen.getByTestId('reactions-p1-retry')).toBeTruthy())
    expect(screen.queryByTestId('account-row-c1')).toBeNull()
  })

  it('an empty reposts list is an honest empty state, never faked rows', async () => {
    setup(tabbedBackend({reposts: jest.fn(async () => ({items: [], cursor: null, end: true}))}))
    await waitFor(() => expect(screen.getByTestId('note-tabs')).toBeTruthy())
    fireEvent.press(screen.getByTestId('note-tab-reposts'))
    await waitFor(() => expect(screen.getByTestId('reposts-p1')).toBeTruthy())
    expect(screen.queryByTestId(/account-row-/)).toBeNull()
  })
})

describe('NoteScreen delete navigation (F20)', () => {
  it('leaves the detail when the focused post is deleted', async () => {
    mockGoBackOrFeed.mockClear()
    const {postShadowStore} = await import('#/state/cache')
    postShadowStore.reset()
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    const {act} = await import('@testing-library/react-native')
    act(() => {
      postShadowStore.patch(SESSION.id, 'p1', {isDeleted: true})
    })
    expect(mockGoBackOrFeed).toHaveBeenCalled()
  })
})

describe('NoteScreen ancestors (flat, no connectors)', () => {
  it('renders the ancestor chain flat with no connector edge', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    expect(screen.getByTestId('ancestor-a0')).toBeTruthy()
    expect(screen.queryByTestId('ancestor-chain')).toBeNull()
    expect(screen.queryAllByTestId(/thread-edge-/)).toHaveLength(0)
  })

  it('renders nothing above the focused post when there is no chain', async () => {
    setup(fakeBackend({thread: jest.fn(async () => ({ancestors: [], incomplete: false}))}))
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    expect(screen.queryByTestId('ancestor-chain')).toBeNull()
    expect(screen.queryByTestId('ancestor-a0')).toBeNull()
  })

  // Heavy mount (full thread + replies + composer + emoji data): ~2s
  // alone, over the 5s default under file load — same 20s budget class
  // as the postquote-emoji tests.
  it('ancestors render compact with no action bar, spine-connected to a distinct focused post', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('ancestor-a0')).toBeTruthy())
    // Compact: avatar + name + body stay, but no action bar affordances
    // and no reaction counts — the focused post keeps its full card.
    expect(screen.getByTestId('post-body-a0')).toBeTruthy()
    expect(screen.queryByTestId('post-actions-a0')).toBeNull()
    expect(screen.queryByTestId('action-reply-a0')).toBeNull()
    expect(screen.queryByTestId('action-boost-a0')).toBeNull()
    expect(screen.queryByTestId('action-react-a0')).toBeNull()
    expect(screen.queryByTestId('action-like-a0')).toBeNull()
    expect(screen.queryByTestId('post-reactions-a0')).toBeNull()
    // findBy, not getBy: under full-suite load the focused card can land a
    // beat after the ancestors in the same header commit.
    expect(await screen.findByTestId('post-actions-p1')).toBeTruthy()
    // Spine: the ancestor row runs down, the focused wrapper receives it.
    expect(screen.getByTestId('ancestor-spine-bottom-a0')).toBeTruthy()
    expect(screen.queryByTestId('ancestor-spine-top-a0')).toBeNull()
    expect(screen.getByTestId('focused-spine-top-p1')).toBeTruthy()
    // Focused distinction: the soft-background bordered wrapper stays,
    // holding the full card above the composer.
    const focusedStyle = StyleSheet.flatten(screen.getByTestId('focused-p1').props.style)
    expect(focusedStyle.borderTopWidth).toBe(1)
    expect(focusedStyle.borderBottomWidth).toBe(1)
  }, 20000)

  it('renders multi-level ancestors oldest-first above the focused post', async () => {
    const a0 = makePost({id: 'a0', content: {mfm: 'root', plain: 'root'}})
    const a1 = makePost({
      id: 'a1',
      replyToId: 'a0',
      reply: a0,
      content: {mfm: 'middle', plain: 'middle'},
    })
    const a2 = makePost({
      id: 'a2',
      replyToId: 'a1',
      reply: a1,
      content: {mfm: 'leaf ancestor', plain: 'leaf ancestor'},
    })
    const focused = makePost({
      id: 'p1',
      replyToId: 'a2',
      reply: a2,
      content: {mfm: 'focused post', plain: 'focused post'},
    })
    setup(
      fakeBackend({
        focused,
        post: jest.fn(async () => focused),
        thread: jest.fn(async () => ({ancestors: [a0, a1, a2], incomplete: false})),
        threadReplies: jest.fn(async () => ({items: [], cursor: null, end: true})),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('ancestor-a2')).toBeTruthy())
    // Oldest/root first at the top, direct parent just above the focus.
    expect(screen.queryAllByTestId(/^ancestor-row-/).map(n => n.props.testID)).toEqual([
      'ancestor-row-a0',
      'ancestor-row-a1',
      'ancestor-row-a2',
    ])
  })

  it('chained ancestors hide the redundant Replying to caption', async () => {
    const a0 = makePost({id: 'a0', content: {mfm: 'root', plain: 'root'}})
    const a1 = makePost({
      id: 'a1',
      replyToId: 'a0',
      reply: a0,
      content: {mfm: 'middle', plain: 'middle'},
    })
    const focused = makePost({
      id: 'p1',
      replyToId: 'a1',
      reply: a1,
      content: {mfm: 'focused post', plain: 'focused post'},
    })
    setup(
      fakeBackend({
        ancestor: a0,
        focused,
        post: jest.fn(async () => focused),
        thread: jest.fn(async () => ({ancestors: [a0, a1], incomplete: false})),
        threadReplies: jest.fn(async () => ({items: [], cursor: null, end: true})),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('ancestor-a1')).toBeTruthy())
    // a1 sits directly under a0 and the focused post sits under a1: the
    // spine already says it, so neither repeats the caption.
    expect(screen.queryByTestId('reply-context-a1')).toBeNull()
    expect(screen.queryByTestId('reply-context-p1')).toBeNull()
    // Spine connects the whole chain down into the focused post.
    expect(screen.getByTestId('ancestor-spine-bottom-a0')).toBeTruthy()
    expect(screen.getByTestId('ancestor-spine-top-a1')).toBeTruthy()
    expect(screen.getByTestId('ancestor-spine-bottom-a1')).toBeTruthy()
    expect(screen.getByTestId('focused-spine-top-p1')).toBeTruthy()
  })

  it('an orphaned first ancestor keeps its caption and the incomplete marker stays', async () => {
    const outside = makePost({id: 'out', content: {mfm: 'outside', plain: 'outside'}})
    const a1 = makePost({
      id: 'a1',
      replyToId: 'out',
      reply: outside,
      content: {mfm: 'orphan ancestor', plain: 'orphan ancestor'},
    })
    const focused = makePost({
      id: 'p1',
      replyToId: 'a1',
      reply: a1,
      content: {mfm: 'focused post', plain: 'focused post'},
    })
    setup(
      fakeBackend({
        ancestor: a1,
        focused,
        post: jest.fn(async () => focused),
        thread: jest.fn(async () => ({ancestors: [a1], incomplete: true})),
        threadReplies: jest.fn(async () => ({items: [], cursor: null, end: true})),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('ancestor-a1')).toBeTruthy())
    // The parent is not shown above (context is cut off): the caption is
    // the only signal, so it stays — as does the incomplete marker.
    expect(screen.getByTestId('reply-context-a1')).toBeTruthy()
    expect(screen.getByText('Earlier reply context unavailable.')).toBeTruthy()
  })
})

describe('NoteScreen flat reply chains (spine)', () => {
  const day = (n: string) => `2026-10-${n}T00:00:00.000Z`
  function chainPost(id: string, replyToId: string | null, created: string, text: string) {
    return makePost({
      id,
      replyToId,
      createdAt: created,
      content: {mfm: text, plain: text},
    })
  }
  function chainBackend(children: Record<string, ReturnType<typeof makePost>[]>) {
    return fakeBackend({
      threadReplies: jest.fn(async (id: string) => ({
        items: children[id] ?? [],
        cursor: null,
        end: true,
      })),
    })
  }
  function rowStyleOf(id: string): Record<string, unknown> {
    return (
      (StyleSheet.flatten(screen.getByTestId(`reply-row-${id}`).props.style) ?? {}) as Record<
        string,
        unknown
      >
    )
  }

  it('shows A, B, C then one link, and the link reveals D onward in one tap', async () => {
    const A = chainPost('cha', 'p1', day('20'), 'A post')
    const B = chainPost('chb', 'cha', day('21'), 'B post')
    const C = chainPost('chc', 'chb', day('22'), 'C post')
    const D = chainPost('chd', 'chc', day('23'), 'D post')
    const E = chainPost('che', 'chd', day('24'), 'E post')
    setup(chainBackend({p1: [A], cha: [B], chb: [C], chc: [D], chd: [E], che: []}))
    await waitFor(() => expect(screen.getByTestId('reply-cha')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('reply-chc')).toBeTruthy())
    expect(screen.queryByTestId('reply-chd')).toBeNull()
    // ONE link, keyed by the direct reply — never a Button pill.
    const link = await screen.findByTestId('show-more-replies-cha')
    expect(screen.getByText('Show more replies…')).toBeTruthy()
    expect(screen.queryAllByTestId(/show-more-replies-/)).toHaveLength(1)
    // Spine: A→B→C connected, the C leaf stub-free below, roots never above.
    expect(screen.getByTestId('reply-spine-bottom-cha')).toBeTruthy()
    expect(screen.getByTestId('reply-spine-top-chb')).toBeTruthy()
    expect(screen.getByTestId('reply-spine-bottom-chb')).toBeTruthy()
    expect(screen.getByTestId('reply-spine-top-chc')).toBeTruthy()
    expect(screen.queryByTestId('reply-spine-top-cha')).toBeNull()
    expect(screen.queryByTestId('reply-spine-bottom-chc')).toBeNull()
    // Flat: zero indent, zero borders at every depth.
    for (const id of ['cha', 'chb', 'chc']) {
      const s = rowStyleOf(id)
      expect(s.paddingLeft).toBeUndefined()
      expect(s.marginLeft).toBeUndefined()
      expect(s.borderLeftWidth).toBeUndefined()
    }
    expect(screen.queryAllByTestId(/thread-edge-/)).toHaveLength(0)
    // The card itself still opens its own Note screen (PostCard owns it).
    expect(screen.getByTestId('post-open-chc')).toBeTruthy()
    fireEvent.press(link)
    await waitFor(() => expect(screen.getByTestId('reply-chd')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('reply-che')).toBeTruthy())
    // Full reveal in one tap: no second link at any depth.
    expect(screen.queryAllByTestId(/show-more-replies-/)).toHaveLength(0)
    expect(screen.getByTestId('reply-spine-bottom-chc')).toBeTruthy()
    expect(screen.getByTestId('reply-spine-top-chd')).toBeTruthy()
    expect(screen.queryByText(/too deep/)).toBeNull()
  })

  it('follows the oldest child at each fork and breaks the spine at siblings', async () => {
    const A = chainPost('fa', 'p1', day('20'), 'A post')
    const older = chainPost('fold', 'fa', day('21'), 'older reply')
    const newer = chainPost('fnew', 'fa', day('22'), 'newer reply')
    setup(
      chainBackend({
        // Server answers newest-first (the Misskey family); the read site
        // normalizes to oldest-first, so the lineal child is the oldest.
        p1: [A],
        fa: [newer, older],
        fold: [],
        fnew: [],
      }),
    )
    await waitFor(() => expect(screen.getByTestId('reply-fold')).toBeTruthy())
    expect(screen.queryByTestId('reply-fnew')).toBeNull()
    expect(screen.getByTestId('reply-spine-top-fold')).toBeTruthy()
    fireEvent.press(await screen.findByTestId('show-more-replies-fa'))
    await waitFor(() => expect(screen.getByTestId('reply-fnew')).toBeTruthy())
    expect(screen.queryAllByTestId(/show-more-replies-/)).toHaveLength(0)
    // The revealed younger sibling breaks the spine: the row above it is
    // not its parent, and the leaf above it draws no bottom stub into it.
    expect(screen.queryByTestId('reply-spine-top-fnew')).toBeNull()
    expect(screen.queryByTestId('reply-spine-bottom-fold')).toBeNull()
  })

  it('reveals skipped sibling subtrees depth-first, oldest-first', async () => {
    const A = chainPost('da', 'p1', day('20'), 'A post')
    const B = chainPost('db', 'da', day('21'), 'B post')
    const B2 = chainPost('db2', 'da', day('22'), 'B2 post')
    const C = chainPost('dc', 'db', day('23'), 'C post')
    const E = chainPost('de', 'db2', day('24'), 'E post')
    setup(chainBackend({p1: [A], da: [B, B2], db: [C], dc: [], db2: [E], de: []}))
    await waitFor(() => expect(screen.getByTestId('reply-dc')).toBeTruthy())
    expect(screen.queryByTestId('reply-db2')).toBeNull()
    fireEvent.press(await screen.findByTestId('show-more-replies-da'))
    await waitFor(() => expect(screen.getByTestId('reply-de')).toBeTruthy())
    const order = screen.queryAllByTestId(/^reply-row-/).map(n => n.props.testID)
    expect(order).toEqual([
      'reply-row-da',
      'reply-row-db',
      'reply-row-dc',
      'reply-row-db2',
      'reply-row-de',
    ])
    // Sibling break at B2, reconnect inside its subtree.
    expect(screen.queryByTestId('reply-spine-top-db2')).toBeNull()
    expect(screen.getByTestId('reply-spine-bottom-db2')).toBeTruthy()
    expect(screen.getByTestId('reply-spine-top-de')).toBeTruthy()
  })

  it('lists root replies oldest-first even when the server answers newest-first', async () => {
    const older = makePost({
      id: 'r-old',
      replyToId: 'p1',
      createdAt: '2026-10-20T00:00:00.000Z',
      content: {mfm: 'older reply', plain: 'older reply'},
    })
    const newer = makePost({
      id: 'r-new',
      replyToId: 'p1',
      createdAt: '2026-10-21T00:00:00.000Z',
      content: {mfm: 'newer reply', plain: 'newer reply'},
    })
    setup(
      fakeBackend({
        threadReplies: jest.fn(async (id: string) => ({
          // Server order is newest-first (the Misskey family); the screen
          // normalizes to oldest-first at the read site, so the query and
          // feed order elsewhere are untouched.
          items: id === 'p1' ? [newer, older] : [],
          cursor: null,
          end: true,
        })),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('reply-r-old')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('reply-r-new')).toBeTruthy())
    const list = screen.UNSAFE_getByType(FlatList)
    expect((list.props.data as {id: string}[]).map(p => p.id)).toEqual(['r-old', 'r-new'])
  })

  it('pages root replies through a muted load-more text link', async () => {
    const r1 = makePost({
      id: 'r1',
      replyToId: 'p1',
      createdAt: '2026-10-20T00:00:00.000Z',
      content: {mfm: 'first page', plain: 'first page'},
    })
    const r2 = makePost({
      id: 'r2',
      replyToId: 'p1',
      createdAt: '2026-10-21T00:00:00.000Z',
      content: {mfm: 'second page', plain: 'second page'},
    })
    setup(
      fakeBackend({
        threadReplies: jest.fn(async (id: string, opts: {cursor?: unknown} = {}) => {
          if (id !== 'p1') return {items: [], cursor: null, end: true}
          return opts.cursor == null
            ? {items: [r1], cursor: 'c1', end: false}
            : {items: [r2], cursor: null, end: true}
        }),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
    expect(screen.queryByTestId('reply-r2')).toBeNull()
    const more = await screen.findByTestId('more-replies-p1')
    expect(screen.getByText('Load more replies')).toBeTruthy()
    fireEvent.press(more)
    await waitFor(() => expect(screen.getByTestId('reply-r2')).toBeTruthy())
  })

  it('a reply cycle expands silently behind the backstop, never hanging or captioning', async () => {    const ca = chainPost('ca', 'p1', day('20'), 'cycle a')
    const cb = chainPost('cb', 'ca', day('21'), 'cycle b')
    setup(chainBackend({p1: [ca], ca: [cb], cb: [ca]}))
    // A=ca renders immediately; C=ca lands with its query — under file
    // load both can be present before the first assertion runs, so never
    // assert a singleton here.
    await waitFor(() => expect(screen.getAllByTestId('reply-ca').length).toBeGreaterThanOrEqual(1))
    await waitFor(() => expect(screen.getAllByTestId('reply-cb').length).toBeGreaterThanOrEqual(1))
    // The lineal descent already loops once (A=ca, B=cb, C=ca).
    await waitFor(() => expect(screen.getAllByTestId('reply-ca')).toHaveLength(2))
    fireEvent.press(await screen.findByTestId('show-more-replies-ca'))
    // The reveal recurses until the silent 64-depth backstop — more rows,
    // no hang, no dead-end caption, and no further links by design.
    await waitFor(() => expect(screen.getAllByTestId('reply-ca').length).toBeGreaterThan(2))
    expect(screen.queryAllByTestId(/show-more-replies-/)).toHaveLength(0)
    expect(screen.queryByText(/too deep/)).toBeNull()
    // One-tap full reveal of a 64-deep adversarial cycle renders dozens of
    // cards (each with its own queries): needs a generous budget under
    // file load. Real threads never cycle (fedi tree builder guards).
  }, 60000)

  it('caps chains at the backstop depth and never below it', () => {
    expect(isChainCapped(0)).toBe(false)
    expect(isChainCapped(63)).toBe(false)
    expect(isChainCapped(64)).toBe(true)
    expect(isChainCapped(1000)).toBe(true)
  })

  it('renders A above B above C with the latest reply last in the visible chain', async () => {
    const A = chainPost('oa', 'p1', day('20'), 'A post')
    const B = chainPost('ob', 'oa', day('21'), 'B post')
    const C = chainPost('oc', 'ob', day('22'), 'C post')
    const D = chainPost('od', 'oc', day('23'), 'D post')
    setup(chainBackend({p1: [A], oa: [B], ob: [C], oc: [D], od: []}))
    await waitFor(() => expect(screen.getByTestId('reply-oc')).toBeTruthy())
    const rows = () => screen.queryAllByTestId(/^reply-row-/).map(n => n.props.testID)
    // Oldest/root first, newest last — the latest visible reply (C)
    // sits at the bottom of the chain before the reveal.
    expect(rows()).toEqual(['reply-row-oa', 'reply-row-ob', 'reply-row-oc'])
    fireEvent.press(await screen.findByTestId('show-more-replies-oa'))
    await waitFor(() => expect(screen.getByTestId('reply-od')).toBeTruthy())
    expect(rows()).toEqual(['reply-row-oa', 'reply-row-ob', 'reply-row-oc', 'reply-row-od'])
  })

  it('renders the identical chain when the server answers oldest-first (Mastodon family)', async () => {
    const A = chainPost('ma', 'p1', day('20'), 'A post')
    const B = chainPost('mb', 'ma', day('21'), 'B post')
    const B2 = chainPost('mb2', 'ma', day('22'), 'B2 post')
    // Mastodon `context` descendants arrive oldest-first; the read site
    // sorts anyway, so the render matches the newest-first fixture above.
    setup(chainBackend({p1: [A], ma: [B, B2], mb: [], mb2: []}))
    await waitFor(() => expect(screen.getByTestId('reply-mb')).toBeTruthy())
    const rows = () => screen.queryAllByTestId(/^reply-row-/).map(n => n.props.testID)
    expect(rows()).toEqual(['reply-row-ma', 'reply-row-mb'])
    fireEvent.press(await screen.findByTestId('show-more-replies-ma'))
    await waitFor(() => expect(screen.getByTestId('reply-mb2')).toBeTruthy())
    // Siblings chronological: the older branch (B) stays above B2.
    expect(rows()).toEqual(['reply-row-ma', 'reply-row-mb', 'reply-row-mb2'])
  })

  it('reveals three-level sibling branches depth-first, oldest-first', async () => {
    const A = chainPost('ta', 'p1', day('20'), 'A post')
    const B = chainPost('tb', 'ta', day('21'), 'B post')
    const B2 = chainPost('tb2', 'ta', day('23'), 'B2 post')
    const C = chainPost('tc', 'tb', day('22'), 'C post')
    const C2 = chainPost('tc2', 'tb', day('24'), 'C2 post')
    const D = chainPost('td', 'tc', day('25'), 'D post')
    setup(
      chainBackend({
        // Newest-first at every fork (the Misskey family); the read site
        // normalizes, so the lineal descent is still oldest-first.
        p1: [A],
        ta: [B2, B],
        tb: [C2, C],
        tc: [D],
        td: [],
        tc2: [],
        tb2: [],
      }),
    )
    await waitFor(() => expect(screen.getByTestId('reply-tc')).toBeTruthy())
    const rows = () => screen.queryAllByTestId(/^reply-row-/).map(n => n.props.testID)
    expect(rows()).toEqual(['reply-row-ta', 'reply-row-tb', 'reply-row-tc'])
    fireEvent.press(await screen.findByTestId('show-more-replies-ta'))
    await waitFor(() => expect(screen.getByTestId('reply-tb2')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('reply-tc2')).toBeTruthy())
    // Depth-first pre-order, oldest-first at every fork: the lineal
    // descent first, then C2's subtree, then B2's subtree — parentage
    // intact, one tap, no second link.
    expect(rows()).toEqual([
      'reply-row-ta',
      'reply-row-tb',
      'reply-row-tc',
      'reply-row-td',
      'reply-row-tc2',
      'reply-row-tb2',
    ])
    expect(screen.queryAllByTestId(/show-more-replies-/)).toHaveLength(0)
  })

  it('chain children hide the redundant caption; the root reply keeps it', async () => {
    const a0 = makePost({id: 'a0', content: {mfm: 'ancestor post', plain: 'ancestor post'}})
    const focused = makePost({
      id: 'p1',
      replyToId: 'a0',
      reply: a0,
      content: {mfm: 'focused post', plain: 'focused post'},
    })
    const A = makePost({
      id: 'cha',
      replyToId: 'p1',
      reply: focused,
      createdAt: day('20'),
      content: {mfm: 'A post', plain: 'A post'},
    })
    const B = makePost({
      id: 'chb',
      replyToId: 'cha',
      reply: A,
      createdAt: day('21'),
      content: {mfm: 'B post', plain: 'B post'},
    })
    const C = makePost({
      id: 'chc',
      replyToId: 'chb',
      reply: B,
      createdAt: day('22'),
      content: {mfm: 'C post', plain: 'C post'},
    })
    setup(
      fakeBackend({
        focused,
        post: jest.fn(async () => focused),
        thread: jest.fn(async () => ({ancestors: [a0], incomplete: false})),
        threadReplies: jest.fn(async (id: string) => ({
          items: id === 'p1' ? [A] : id === 'cha' ? [B] : id === 'chb' ? [C] : [],
          cursor: null,
          end: true,
        })),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('reply-cha')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('reply-chc')).toBeTruthy())
    // A sits below the composer + tabs, not directly under its parent —
    // its caption is the only parent signal, so it stays. B sits under A
    // and C sits under B: the spine already says it, so neither repeats it.
    expect(screen.getByTestId('reply-context-cha')).toBeTruthy()
    expect(screen.queryByTestId('reply-context-chb')).toBeNull()
    expect(screen.queryByTestId('reply-context-chc')).toBeNull()
  })
})

describe('NoteScreen reply refresh (E10)', () => {
  // Collapsed child branches prefetch their parents on mount, so count
  // the focused post's own reply query, not every threadReplies call.
  const callsFor = (backend: {threadReplies: jest.Mock}, id: string) =>
    backend.threadReplies.mock.calls.filter((c: unknown[]) => c[0] === id).length

  it('refetches post + replies on return focus (Compose goBack), not on mount', async () => {
    const backend = setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
    // Mount focus only arms the guard — the mock executes it like the
    // real hook, so a resubscribe-per-render variant would already have
    // refetched here.
    expect(backend.post).toHaveBeenCalledTimes(1)
    expect(callsFor(backend, 'p1')).toBe(1)
    // Returning from Compose refetches.
    lastFocusEffect()()
    await waitFor(() => expect(callsFor(backend, 'p1')).toBe(2))
    await waitFor(() => expect(backend.post).toHaveBeenCalledTimes(2))
  })

  it('manual refresh refetches the replies, not just the focused post', async () => {
    const backend = setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
    expect(callsFor(backend, 'p1')).toBe(1)
    screen.UNSAFE_getByType(RefreshControl).props.onRefresh()
    await waitFor(() => expect(callsFor(backend, 'p1')).toBe(2))
    await waitFor(() => expect(backend.post).toHaveBeenCalledTimes(2))
  })

  it('subscribes the focus effect once: re-renders never refetch on their own (no polling loop)', async () => {
    const backend = setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
    // Data arriving re-renders the screen; the focus subscription must
    // stay one stable callback — a fresh callback per render would
    // resubscribe-while-focused and refetch every render.
    expect(mockFocusCbs.length).toBeGreaterThan(1)
    // The subscription must be stable: with the real hook, every
    // resubscribe-while-focused executes, so a fresh callback per
    // render would refetch on its own (a polling loop by accident).
    // (React Compiler memoization can mask identity churn in tests, so
    // this pins the invariant while the idle-live check proves it.)
    const groups = new Map<unknown, number>()
    for (const cb of mockFocusCbs) groups.set(cb, (groups.get(cb) ?? 0) + 1)
    expect(groups.size).toBe(1)
    expect(callsFor(backend, 'p1')).toBe(1)
  })
})
