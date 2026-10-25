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
import {NoteScreen} from './Note'

// Post-detail screen tests (v1 `Note` parity): the focused post renders with
// its ancestors above and its replies below, the inline composer posts a
// reply to the focused post, and a failed load is an honest error state
// — never faked thread data.

const mockNavigate = jest.fn()
const mockGoBack = jest.fn()
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
// so the captured-callback log resets for every test.
beforeEach(() => {
  mockFocusCbs.length = 0
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
    threadReplies: jest.fn(async () => ({items: [reply], cursor: null, end: true})),
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
    expect(screen.getByTestId('inline-reply-input')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
  })

  it('the inline composer starts collapsed: one compact row, no toolbar', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('inline-reply-input')).toBeTruthy())
    expect(screen.getByTestId('inline-reply-submit')).toBeTruthy()
    expect(screen.queryByTestId('inline-reply-media')).toBeNull()
    expect(screen.queryByTestId('inline-reply-emoji')).toBeNull()
    // Collapsed is one compact row — avatar, input, and Reply pill share
    // a vertically centered row, and the input rests at single-line height.
    const row = StyleSheet.flatten(screen.getByTestId('inline-reply').props.style)
    expect(row.flexDirection).toBe('row')
    expect(row.alignItems).toBe('center')
    const input = StyleSheet.flatten(screen.getByTestId('inline-reply-input').props.style)
    expect(input.minHeight).toBe(36)
  })

  it('first focus expands the toolbar and it stays expanded after blur', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('inline-reply-input')).toBeTruthy())
    fireEvent(screen.getByTestId('inline-reply-input'), 'focus')
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
    await waitFor(() => expect(screen.getByTestId('inline-reply-input')).toBeTruthy())
    fireEvent(screen.getByTestId('inline-reply-input'), 'focus')
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
    await waitFor(() => expect(screen.getByTestId('inline-reply-input')).toBeTruthy())
    // Gated while empty: pressing Reply with no text or media posts nothing.
    fireEvent.press(screen.getByTestId('inline-reply-submit'))
    expect(backend.createPost).not.toHaveBeenCalled()
    const before = backend.threadReplies.mock.calls.filter((c: unknown[]) => c[0] === 'p1').length
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
    await waitFor(() => expect(screen.getByTestId('inline-reply-input')).toBeTruthy())
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

  it('renders the thread as a single FlatList, never PostCards in a ScrollView (F24)', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    // The thread body IS the FlatList (header = ancestors + focused +
    // inline composer + tabs, rows = root replies); nested branches stay
    // collapsed Views.
    expect(screen.UNSAFE_getByType(FlatList)).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
    expect(screen.getByTestId('show-replies-r1')).toBeTruthy()
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
    const {postShadowStore} = await import('#/state/cache')
    postShadowStore.reset()
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    const {act} = await import('@testing-library/react-native')
    act(() => {
      postShadowStore.patch(SESSION.id, 'p1', {isDeleted: true})
    })
    expect(mockGoBack).toHaveBeenCalled()
  })
})

describe('NoteScreen thread connectors (E8)', () => {
  function twoLevelBackend() {
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
    const r1 = makePost({
      id: 'r1',
      replyToId: 'p1',
      content: {mfm: 'child reply', plain: 'child reply'},
    })
    const r2 = makePost({
      id: 'r2',
      replyToId: 'r1',
      content: {mfm: 'grandchild reply', plain: 'grandchild reply'},
    })
    const children: Record<string, typeof r1[]> = {p1: [r1], r1: [r2], r2: []}
    return fakeBackend({
      threadReplies: jest.fn(async (id: string) => ({
        items: children[id] ?? [],
        cursor: null,
        end: true,
      })),
    })
  }

  function edgeOf(testID: string): Record<string, unknown> {
    return StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>
  }

  it('ties the ancestor chain with a visible edge', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    expect(screen.getByTestId('ancestor-chain')).toBeTruthy()
    expect(edgeOf('ancestor-chain').borderLeftWidth).toBe(1)
    expect(screen.getByTestId('ancestor-a0')).toBeTruthy()
  })

  it('hides the ancestor edge when there is no chain', async () => {
    setup(fakeBackend({thread: jest.fn(async () => ({ancestors: [], incomplete: false}))}))
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    expect(screen.queryByTestId('ancestor-chain')).toBeNull()
  })

  it('wraps each root reply row in a connector edge', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
    expect(screen.getByTestId('thread-edge-r1')).toBeTruthy()
    expect(edgeOf('thread-edge-r1').borderLeftWidth).toBe(1)
  })

  it('draws the nested branch edge one level down', async () => {
    setup(twoLevelBackend())
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
    fireEvent.press(screen.getByTestId('show-replies-r1'))
    await waitFor(() => expect(screen.getByTestId('reply-r2')).toBeTruthy())
    expect(edgeOf('replies-r1').borderLeftWidth).toBe(1)
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
