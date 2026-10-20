import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import type {Capabilities, Session} from '@keystone/fedi'
import {FEATURE_KEYS} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostCard} from '#/components/Post/index'
import {buildPostMenu, flatten, type PostMenuInput} from '#/components/Post/menuModel'
import {PostMenu} from '#/components/Post/PostMenu'
import {clearToasts, toastStore} from '#/lib/toast'
import {postShadowStore} from '#/state/cache'
import {SessionProvider} from '#/state/session/SessionProvider'

import {makeAccount, makePost} from './fixtures'

const mockBackends = new Map<string, unknown>()
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

i18n.load('en', {})
i18n.activate('en')

const caps = (over: Partial<Record<string, string>> = {}): Capabilities => {
  const c = {} as Record<string, string>
  for (const k of FEATURE_KEYS) c[k] = 'unknown'
  return {...c, reactions: 'supported', status_editing: 'supported', quote_posting: 'supported', translation: 'supported', bookmarks: 'supported', ...over} as Capabilities
}

function baseInput(over: Partial<PostMenuInput> = {}): PostMenuInput {
  return {
    family: 'misskey',
    capabilities: caps(),
    post: makePost({uri: 'https://example.social/notes/p1', url: null}),
    origin: 'https://example.social',
    isOwn: false,
    copyAvailable: true,
    bookmark: {gate: {enabled: true}, value: false, set: jest.fn(async () => undefined)},
    del: {gate: {enabled: true}, run: jest.fn(async () => undefined)},
    handlers: {
      copy: jest.fn(),
      share: jest.fn(),
      open: jest.fn(),
      translate: jest.fn(),
      muteThread: jest.fn(),
      togglePin: jest.fn(),
    },
    ...over,
  }
}
const keys = (i: PostMenuInput) => flatten(buildPostMenu(i)).map(x => x.key)
const find = (i: PostMenuInput, key: string) => flatten(buildPostMenu(i)).find(x => x.key === key)

describe('menu model (docs/note-options.md)', () => {
  it('misskey, someone else local post: no remote rows, no delete/edit/pin', () => {
    const k = keys(baseInput())
    expect(k).toEqual([
      'copy-contents', 'copy-link', 'share',
      'translate', 'mute-thread', 'bookmark', 'clip', 'user',
      'report',
    ])
  })

  it('remote post adds copy-remote-link and view-remote', () => {
    const post = makePost({uri: 'https://other.example/notes/zz', url: null})
    const k = keys(baseInput({post}))
    expect(k).toContain('copy-remote-link')
    expect(k).toContain('view-remote')
  })

  it('own post adds edit, pin, delete (confirm)', () => {
    const i = baseInput({isOwn: true})
    expect(keys(i)).toEqual(expect.arrayContaining(['edit', 'pin', 'delete']))
    expect(find(i, 'delete')?.confirm?.action).toBe('Delete')
    expect(find(i, 'delete')?.destructive).toBe(true)
  })

  it('edit is disabled with a reason when unsupported or no editor connected', () => {
    const off = baseInput({isOwn: true, capabilities: caps({status_editing: 'unsupported'})})
    expect(find(off, 'edit')).toMatchObject({disabled: true})
    expect(find(off, 'edit')?.reason).toMatch(/does not support editing/)
    const noEditor = baseInput({isOwn: true})
    expect(find(noEditor, 'edit')?.disabled).toBe(true)
    const onEdit = jest.fn()
    const live = baseInput({isOwn: true, handlers: {...baseInput().handlers, onEdit}})
    find(live, 'edit')?.run?.()
    expect(onEdit).toHaveBeenCalledWith(live.post)
  })

  it('translate is gated on capability and text', () => {
    expect(find(baseInput(), 'translate')?.disabled).toBeUndefined()
    const off = find(baseInput({capabilities: caps({translation: 'unknown'})}), 'translate')
    expect(off).toMatchObject({disabled: true})
    expect(off?.reason).toMatch(/translation/)
  })

  it('bookmark family label and gate reason', () => {
    expect(find(baseInput(), 'bookmark')?.label).toBe('Add to favorites')
    const masto = baseInput({family: 'mastodon', bookmark: {gate: {enabled: false, reason: 'nope', reasonCode: 'x'}, value: false, set: jest.fn()}})
    expect(find(masto, 'bookmark')).toMatchObject({label: 'Add to bookmark', disabled: true, reason: 'nope'})
  })

  it('delete is disabled with the gate reason when the gate refuses', () => {
    const i = baseInput({isOwn: true, del: {gate: {enabled: false, reason: 'no', reasonCode: 'x'}, run: jest.fn()}})
    expect(find(i, 'delete')).toMatchObject({disabled: true, reason: 'no'})
  })

  it('no clipboard disables copy rows with a reason', () => {
    const c = find(baseInput({copyAvailable: false}), 'copy-link')
    expect(c).toMatchObject({disabled: true})
  })

  it('user submenu: remote-user row only for remote hosts; relations disabled until connected', () => {
    const local = baseInput({post: makePost({author: makeAccount({host: null, acct: 'alice', url: 'https://x/@alice'})})})
    const sub = (i: PostMenuInput) => buildPostMenu(i).flat().find(x => x.key === 'user')!.submenu!.flat()
    expect(sub(local).map(x => x.key)).not.toContain('view-remote-user')
    expect(sub(baseInput()).map(x => x.key)).toContain('view-remote-user')
    expect(sub(baseInput()).find(x => x.key === 'block')).toMatchObject({disabled: true})
    const block = jest.fn()
    const wired = baseInput({handlers: {...baseInput().handlers, user: {onBlock: block}}})
    expect(sub(wired).find(x => x.key === 'block')?.confirm?.action).toBe('Block')
  })
})

function wrap(ui: React.ReactElement, extra?: (c: React.ReactElement) => React.ReactElement) {
  const inner = <ThemeProvider theme="light">{ui}</ThemeProvider>
  return render(<I18nProvider i18n={i18n}>{extra ? extra(inner) : inner}</I18nProvider>)
}

describe('PostMenu UI', () => {
  it('runs an item, asks before delete, and disabled rows do nothing', async () => {
    const run = jest.fn(async () => undefined)
    const del = jest.fn(async () => undefined)
    const off = jest.fn()
    wrap(
      <PostMenu
        postId="p1"
        sections={[
          [{key: 'copy-link', label: 'Copy link', run}, {key: 'x', label: 'X', disabled: true, reason: 'because', run: off}],
          [{key: 'delete', label: 'Delete', destructive: true, confirm: {title: 'Delete this post?', action: 'Delete'}, run: del}],
        ]}
      />,
    )
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    expect(screen.getByText('because')).toBeTruthy()
    fireEvent.press(screen.getByTestId('post-menu-p1-item-x'))
    expect(off).not.toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('post-menu-p1-item-delete'))
    expect(del).not.toHaveBeenCalled()
    expect(screen.getByText('Delete this post?')).toBeTruthy()
    fireEvent.press(screen.getByTestId('post-menu-p1-cancel'))
    expect(del).not.toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('post-menu-p1-item-delete'))
    fireEvent.press(screen.getByTestId('post-menu-p1-confirm'))
    expect(del).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('post-menu-p1-dialog')).toBeNull()
  })

  it('rejected action surfaces a toast', async () => {
    clearToasts()
    wrap(<PostMenu postId="p1" sections={[[{key: 'a', label: 'A', run: async () => { throw new Error('boom') }}]]} />)
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-a'))
    await waitFor(() => expect(toastStore.getSnapshot().map(t => t.message)).toContain('boom'))
  })

  it('opens the user submenu and goes back', () => {
    wrap(
      <PostMenu
        postId="p1"
        sections={[[{key: 'user', label: 'User', submenu: [[{key: 'copy-username', label: 'Copy username'}]]}]]}
      />,
    )
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-user'))
    expect(screen.getByTestId('post-menu-p1-item-copy-username')).toBeTruthy()
    fireEvent.press(screen.getByTestId('post-menu-p1-back'))
    expect(screen.getByTestId('post-menu-p1-item-user')).toBeTruthy()
  })
})

// --- Live PostCard wiring (usePostActions) ---------------------------------

const SESSION: Session = {
  id: 'https://a.example me',
  origin: 'https://a.example',
  family: 'misskey',
  flavor: 'misskey',
  accountId: 'a1',
  token: 't',
  grant: 'miauth',
  hosting: 'external',
} as unknown as Session

function fakeBackend(over: Record<string, unknown> = {}, c: Capabilities = caps()) {
  return {
    family: 'misskey',
    capabilities: c,
    react: jest.fn(async () => undefined),
    unreact: jest.fn(async () => undefined),
    favourite: jest.fn(async () => undefined),
    unfavourite: jest.fn(async () => undefined),
    boost: jest.fn(async () => ({})),
    unboost: jest.fn(async () => undefined),
    deletePost: jest.fn(async () => undefined),
    translate: jest.fn(async () => ({sourceLang: 'Japanese', text: 'hello translated'})),
    muteThread: jest.fn(async () => undefined),
    bookmarks: {add: jest.fn(async () => undefined), remove: jest.fn(async () => undefined)},
    ...over,
  }
}

function live(post = makePost(), backend = fakeBackend(), handlers = {}) {
  mockBackends.set(SESSION.id, backend)
  const snap = {sessions: [SESSION], activeId: SESSION.id}
  const store = {
    subscribe: () => () => {},
    getSnapshot: () => snap,
    initialize: () => {},
    hydrate: async () => {},
  }
  const qc = new QueryClient()
  wrap(<PostCard post={post} sessionId={SESSION.id} handlers={handlers} />, c => (
    <SessionProvider homeOrigin="https://a.example" store={store as never}>
      <QueryClientProvider client={qc}>{c}</QueryClientProvider>
    </SessionProvider>
  ))
  return backend
}

describe('PostCard write wiring', () => {
  beforeEach(() => {
    postShadowStore.reset()
    clearToasts()
  })

  it('tapping a reaction chip reacts optimistically and calls the backend', async () => {
    const b = live()
    fireEvent.press(screen.getByTestId('reaction-❤'))
    await waitFor(() => expect(b.react).toHaveBeenCalledWith('p1', '❤'))
  })

  it('rejected reaction rolls back and toasts', async () => {
    const b = fakeBackend({react: jest.fn(async () => { throw new Error('server said no') })})
    live(makePost(), b)
    fireEvent.press(screen.getByTestId('reaction-❤'))
    await waitFor(() => expect(toastStore.getSnapshot().map(t => t.message)).toContain('server said no'))
    expect(screen.getByLabelText('❤, 5')).toBeTruthy()
  })

  it('boost menu boosts; quote calls onQuote; reply calls onReply', async () => {
    const onQuote = jest.fn()
    const onReply = jest.fn()
    const post = makePost()
    const b = live(post, fakeBackend(), {onQuote, onReply})
    fireEvent.press(screen.getByTestId('action-reply-p1'))
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({id: 'p1'}))
    fireEvent.press(screen.getByTestId('action-boost-p1'))
    fireEvent.press(screen.getByTestId('action-boost-p1-item-quote'))
    expect(onQuote).toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('action-boost-p1'))
    fireEvent.press(screen.getByTestId('action-boost-p1-item-boost'))
    await waitFor(() => expect(b.boost).toHaveBeenCalledWith('p1'))
  })

  it('without composer callbacks reply is disabled with a reason; react picks locally', () => {
    live()
    expect(screen.getByLabelText(/Reply, 2 replies\. No composer is connected/)).toBeTruthy()
    // The emoji popup is local now: no picker seam needed for the Like button.
    expect(screen.getByTestId('action-react-p1')).toBeTruthy()
  })

  it('smile opens the anchored emoji popup and applies the pick', async () => {
    const b = live(makePost(), fakeBackend())
    fireEvent.press(screen.getByTestId('action-smile-p1'))
    expect(screen.getByTestId('action-picker-p1')).toBeTruthy()
    const cells = screen.queryAllByTestId(/emoji-cell-.*/)
    expect(cells.length).toBeGreaterThan(0)
    const key = cells[0].props.testID.replace('emoji-cell-', '')
    fireEvent.press(cells[0])
    await waitFor(() => expect(b.react).toHaveBeenCalledWith('p1', key))
  })

  it('like control is hidden when the server has no reactions', () => {
    live(makePost(), fakeBackend({}, caps({reactions: 'unsupported'})))
    expect(screen.queryByTestId('action-react-p1')).toBeNull()
  })

  it('delete on own post asks first, then deletes and hides the row', async () => {
    const own = makePost({author: makeAccount({id: 'a1'})})
    const b = live(own)
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-delete'))
    expect(b.deletePost).not.toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('post-menu-p1-confirm'))
    await waitFor(() => expect(b.deletePost).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(screen.queryByTestId('post-p1')).toBeNull())
  })

  it("someone else's post has no delete/edit/pin", () => {
    live(makePost({author: makeAccount({id: 'other'})}))
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    expect(screen.queryByTestId('post-menu-p1-item-delete')).toBeNull()
    expect(screen.queryByTestId('post-menu-p1-item-edit')).toBeNull()
    expect(screen.queryByTestId('post-menu-p1-item-pin')).toBeNull()
  })

  it('translate shows the result under the body; mute thread calls the backend', async () => {
    const b = live()
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-translate'))
    await waitFor(() => expect(screen.getByText('hello translated')).toBeTruthy())
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-mute-thread'))
    await waitFor(() => expect(b.muteThread).toHaveBeenCalledWith('p1'))
  })

  it('edit on own post calls onEdit', () => {
    const onEdit = jest.fn()
    live(makePost({author: makeAccount({id: 'a1'})}), fakeBackend(), {onEdit})
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-edit'))
    expect(onEdit).toHaveBeenCalled()
  })
})
