import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import type {Capabilities, Session} from '@keystone/fedi'
import {FEATURE_KEYS} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {SessionProvider} from '#/state/session/SessionProvider'

import {makeAccount, makePost} from '#/components/__tests__/fixtures'
import {NoteScreen} from './Note'

// Post-detail screen tests (v1 `Note` parity): the focused post renders with
// its ancestors above and its replies below, the reply entry opens the
// composer for the focused post, and a failed load is an honest error state
// — never faked thread data.

const mockNavigate = jest.fn()
const mockGoBack = jest.fn()
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useRoute: () => ({params: {id: 'p1'}}),
}))

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
  })

  it('loads the focused post with ancestors above and replies below', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('thread-body')).toBeTruthy())
    expect(screen.getByTestId('ancestor-a0')).toBeTruthy()
    expect(screen.getByTestId('focused-p1')).toBeTruthy()
    expect(screen.getByTestId('reply-entry')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('reply-r1')).toBeTruthy())
  })

  it('the reply entry opens the composer for the focused post', async () => {
    setup(fakeBackend())
    await waitFor(() => expect(screen.getByTestId('reply-entry')).toBeTruthy())
    fireEvent.press(screen.getByTestId('reply-entry'))
    expect(mockNavigate).toHaveBeenCalledWith('Compose', {replyToId: 'p1'})
  })

  it('a failed thread load is an error state, never faked data', async () => {
    setup(fakeBackend({post: jest.fn(async () => { throw new Error('gone') })}))
    await waitFor(() => expect(screen.getByTestId('thread-retry')).toBeTruthy())
    expect(screen.queryByTestId('thread-body')).toBeNull()
    expect(screen.queryByText('focused post')).toBeNull()
    expect(screen.queryByText('ancestor post')).toBeNull()
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
