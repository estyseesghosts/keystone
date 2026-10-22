import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import type {Capabilities, Session} from '@keystone/fedi'
import {ApiError, FEATURE_KEYS} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostCard} from '#/components/Post/index'
import {buildPostMenu, flatten, type PostMenuInput} from '#/components/Post/menuModel'
import {PostMenu} from '#/components/Post/PostMenu'
import {clearToasts, toastStore} from '#/lib/toast'
import {postShadowStore} from '#/state/cache'
import {softMuteStore} from '#/state/queries/graph'
import {reportPrefsStore} from '#/state/reportPrefs'
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
    // Unknown means the session predates the probe: refresh, not the server.
    expect(off?.reason).toMatch(/sign in again/i)
    const noService = find(baseInput({capabilities: caps({translation: 'unsupported'})}), 'translate')
    expect(noService).toMatchObject({disabled: true})
    expect(noService?.reason).toMatch(/no translation service/i)
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

  it('comment-required confirms stay disabled until text, then pass the comment', async () => {
    const run = jest.fn(async (_comment?: string) => undefined)
    wrap(
      <PostMenu
        postId="p1"
        sections={[
          [
            {
              key: 'report',
              label: 'Report',
              confirm: {title: 'Report @alice?', action: 'Report', commentLabel: 'Reason', run},
            },
          ],
        ]}
      />,
    )
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-report'))
    expect(screen.getByText('Report @alice?')).toBeTruthy()
    // Empty reason: the confirm cannot fire.
    fireEvent.press(screen.getByTestId('post-menu-p1-confirm'))
    expect(run).not.toHaveBeenCalled()
    fireEvent.changeText(screen.getByTestId('post-menu-p1-comment'), 'spam')
    fireEvent.press(screen.getByTestId('post-menu-p1-confirm'))
    await waitFor(() => expect(run).toHaveBeenCalledWith('spam'))
    expect(screen.queryByTestId('post-menu-p1-dialog')).toBeNull()
  })

  it('plain confirms still run without a comment', async () => {
    const run = jest.fn(async () => undefined)
    wrap(
      <PostMenu
        postId="p1"
        sections={[
          [{key: 'delete', label: 'Delete', confirm: {title: 'Delete this post?', action: 'Delete'}, run}],
        ]}
      />,
    )
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-delete'))
    fireEvent.press(screen.getByTestId('post-menu-p1-confirm'))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
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
    reportAccount: jest.fn(async (_id: string, _options: unknown) => undefined),
    bookmarks: {add: jest.fn(async () => undefined), remove: jest.fn(async () => undefined)},
    ...over,
  }
}

const MASTO_SESSION: Session = {
  ...SESSION,
  family: 'mastodon',
  flavor: 'mastodon',
  grant: 'oauth-pkce',
} as unknown as Session

function live(
  post = makePost(),
  backend = fakeBackend(),
  handlers = {},
  session: Session = SESSION,
) {
  mockBackends.set(session.id, backend)
  const snap = {sessions: [session], activeId: session.id}
  const store = {
    subscribe: () => () => {},
    getSnapshot: () => snap,
    initialize: () => {},
    hydrate: async () => {},
  }
  const qc = new QueryClient()
  wrap(<PostCard post={post} sessionId={session.id} handlers={handlers} />, c => (
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
    reportPrefsStore.set('other')
  })

  it('tapping a reaction chip reacts optimistically and calls the backend', async () => {
    const post = makePost()
    post.reactions = {
      total: 8,
      entries: [
        {key: '👍', count: 3, mine: false, url: null},
        {key: '❤', count: 5, mine: false, url: null},
      ],
      mine: null,
      myReactions: [],
      urls: {},
    }
    const b = live(post)
    fireEvent.press(screen.getByTestId('reaction-👍'))
    await waitFor(() => expect(b.react).toHaveBeenCalledWith('p1', '👍'))
  })

  it('rejected reaction rolls back and toasts', async () => {
    const b = fakeBackend({react: jest.fn(async () => { throw new Error('server said no') })})
    const post = makePost()
    post.reactions = {
      total: 8,
      entries: [
        {key: '👍', count: 3, mine: false, url: null},
        {key: '❤', count: 5, mine: false, url: null},
      ],
      mine: null,
      myReactions: [],
      urls: {},
    }
    live(post, b)
    fireEvent.press(screen.getByTestId('reaction-👍'))
    await waitFor(() => expect(toastStore.getSnapshot().map(t => t.message)).toContain('server said no'))
    expect(screen.getByLabelText('👍, 3')).toBeTruthy()
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

  it('bookmark menu row toggles end-to-end and badges optimistically', async () => {
    const b = live(makePost(), fakeBackend())
    expect(screen.queryByTestId('post-badge-bookmarked-p1')).toBeNull()
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-bookmark'))
    await waitFor(() => expect(b.bookmarks.add).toHaveBeenCalledWith('p1'))
    expect(await screen.findByTestId('post-badge-bookmarked-p1')).toBeTruthy()
  })

  it('without composer callbacks reply is disabled with a reason; react picks locally', () => {
    live()
    expect(screen.getByLabelText(/Reply, 2 replies\. No composer is connected/)).toBeTruthy()
    // The emoji popup is local now: no picker seam needed for the Like button.
    expect(screen.getByTestId('action-react-p1')).toBeTruthy()
  })

  it('heart likes directly without opening the picker', async () => {
    const b = live(makePost(), fakeBackend())
    fireEvent.press(screen.getByTestId('action-react-p1'))
    await waitFor(() => expect(b.react).toHaveBeenCalledWith('p1', '❤'))
    expect(screen.queryByTestId('action-picker-p1')).toBeNull()
  })

  it('heart unlike reflects immediately and reaches the server', async () => {
    const b = live(makePost(), fakeBackend())
    fireEvent.press(screen.getByTestId('action-react-p1'))
    await waitFor(() => expect(b.react).toHaveBeenCalledWith('p1', '❤'))
    fireEvent.press(screen.getByTestId('action-react-p1'))
    await waitFor(() => expect(b.unreact).toHaveBeenCalledWith('p1'))
    expect(screen.getByLabelText(/Like, \d+ reactions/)).toBeTruthy()
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

  it('auto-translates on mount with a source header; the header toggles to the original', async () => {
    const b = live()
    // No menu press needed: the translation fetches once on mount and
    // replaces the body, with the source header above it.
    expect(await screen.findByTestId('post-translation-p1')).toBeTruthy()
    expect(screen.getByText('hello translated')).toBeTruthy()
    expect(b.translate).toHaveBeenCalledTimes(1)
    expect(b.translate).toHaveBeenCalledWith('p1', 'en')
    expect(screen.getByTestId('translation-toggle-p1')).toBeTruthy()
    fireEvent.press(screen.getByTestId('translation-toggle-p1'))
    expect(screen.getByTestId('post-body-p1')).toBeTruthy()
    expect(screen.queryByTestId('post-translation-p1')).toBeNull()
    expect(screen.getByText(/Showing original/)).toBeTruthy()
    fireEvent.press(screen.getByTestId('translation-toggle-p1'))
    expect(await screen.findByTestId('post-translation-p1')).toBeTruthy()
    expect(b.translate).toHaveBeenCalledTimes(1)
  })

  it('mute thread calls the backend', async () => {
    const b = live()
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-mute-thread'))
    await waitFor(() => expect(b.muteThread).toHaveBeenCalledWith('p1'))
  })

  it('manual translate failure toasts, keeps the body, and retries on the next tap', async () => {
    clearToasts()
    const b = live(
      makePost(),
      fakeBackend({
        // The mount-time auto-fetch consumes the first rejection; the first
        // manual tap fails too; the retry succeeds.
        translate: jest
          .fn()
          .mockRejectedValueOnce(new Error('no translation service'))
          .mockRejectedValueOnce(new Error('no translation service'))
          .mockResolvedValue({sourceLang: 'Japanese', text: 'hello translated'}),
      }),
    )
    // The mount-time auto-fetch fails silently: original body, no header.
    await waitFor(() => expect(b.translate).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('post-body-p1')).toBeTruthy()
    // The gated menu row is still live: tapping surfaces the error…
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-translate'))
    await waitFor(() =>
      expect(toastStore.getSnapshot().map(t => t.message)).toContain('no translation service'),
    )
    expect(screen.getByTestId('post-body-p1')).toBeTruthy()
    // …and the next tap retries the request and renders the translation.
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-translate'))
    expect(await screen.findByTestId('post-translation-p1')).toBeTruthy()
    expect(b.translate).toHaveBeenCalledTimes(3)
    expect(b.translate).toHaveBeenCalledWith('p1', 'en')
  })

  it("Misskey report keeps the required comment and sends only it", async () => {
    clearToasts()
    const post = makePost({author: makeAccount({id: 'other', acct: 'other@example.social'})})
    const backend = fakeBackend()
    live(post, backend, {
      user: {onReport: (values: unknown) => backend.reportAccount('other', values)},
    })
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-report'))
    expect(screen.getByTestId('report-chooser')).toBeTruthy()
    // No Mastodon-only controls on Misskey.
    expect(screen.queryByTestId('report-category-spam')).toBeNull()
    expect(screen.queryByTestId('report-forward')).toBeNull()
    // Send is disabled until the required reason is typed.
    expect(screen.getByTestId('report-submit').props.accessibilityState.disabled).toBe(true)
    fireEvent.changeText(screen.getByTestId('report-comment'), 'spam')
    fireEvent.press(screen.getByTestId('report-submit'))
    await waitFor(() =>
      expect(backend.reportAccount).toHaveBeenCalledWith('other', {
        comment: 'spam',
        category: 'other',
        ruleIds: [],
        forward: false,
      }),
    )
  })

  it('Mastodon report offers category, rules and forwarding', async () => {
    clearToasts()
    const post = makePost({
      author: makeAccount({id: 'other', acct: 'other@remote.social', host: 'remote.social'}),
    })
    const backend = fakeBackend({
      family: 'mastodon',
      instanceRules: jest.fn(async () => [{id: '7', text: 'No impersonation'}]),
    })
    live(
      post,
      backend,
      {user: {onReport: (values: unknown) => backend.reportAccount('other', values)}},
      MASTO_SESSION,
    )
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-report'))
    expect(screen.getByTestId('report-category-spam')).toBeTruthy()
    fireEvent.press(screen.getByTestId('report-category-spam'))
    // Rules load for this session; picking one files it as a violation.
    fireEvent.press(await screen.findByTestId('report-rule-7'))
    fireEvent.press(screen.getByTestId('report-forward'))
    fireEvent.changeText(screen.getByTestId('report-comment'), 'impersonates me')
    fireEvent.press(screen.getByTestId('report-submit'))
    await waitFor(() =>
      expect(backend.reportAccount).toHaveBeenCalledWith('other', {
        comment: 'impersonates me',
        category: 'violation',
        ruleIds: ['7'],
        forward: true,
      }),
    )
    expect(reportPrefsStore.get()).toBe('violation')
  })

  it('Mastodon rules 404 hides the step with a reason, not an error', async () => {
    clearToasts()
    const post = makePost({
      author: makeAccount({id: 'other', acct: 'other@remote.social', host: 'remote.social'}),
    })
    const backend = fakeBackend({
      family: 'mastodon',
      instanceRules: jest.fn(async () => {
        throw new ApiError('HTTP 404', 404)
      }),
    })
    live(post, backend, {user: {onReport: jest.fn()}}, MASTO_SESSION)
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-report'))
    // The reason REPLACES the loading caption once the 404 settles.
    expect(await screen.findByText(/does not publish/)).toBeTruthy()
    expect(screen.getByTestId('report-rules-reason')).toBeTruthy()
    expect(screen.queryByTestId('report-rule-7')).toBeNull()
    // The rest of the chooser still works.
    expect(screen.getByTestId('report-category-spam')).toBeTruthy()
  })

  it('a local account hides the forwarding toggle', async () => {
    clearToasts()
    const post = makePost({author: makeAccount({id: 'other', acct: 'other', host: null})})
    const backend = fakeBackend({
      family: 'mastodon',
      instanceRules: jest.fn(async () => []),
    })
    live(post, backend, {user: {onReport: jest.fn()}}, MASTO_SESSION)
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-report'))
    expect(screen.queryByTestId('report-forward')).toBeNull()
    expect(await screen.findByText(/lists no rules/)).toBeTruthy()
    expect(screen.getByTestId('report-rules-reason')).toBeTruthy()
  })

  it("someone else's post without a reporter shows the honest reason", () => {
    live(makePost({author: makeAccount({id: 'other'})}))
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    expect(screen.getByTestId('post-menu-p1-item-report')).toBeTruthy()
    expect(screen.getByText(/not connected to this view/)).toBeTruthy()
  })

  it('own post has no report row', () => {
    live(makePost({author: makeAccount({id: 'a1'})}))
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    expect(screen.queryByTestId('post-menu-p1-item-report')).toBeNull()
  })

  it('edit on own post calls onEdit', () => {
    const onEdit = jest.fn()
    live(makePost({author: makeAccount({id: 'a1'})}), fakeBackend(), {onEdit})
    fireEvent.press(screen.getByTestId('post-menu-p1'))
    fireEvent.press(screen.getByTestId('post-menu-p1-item-edit'))
    expect(onEdit).toHaveBeenCalled()
  })
})

describe('soft-mute badge on the live card', () => {
  // Soft-mute badge: feeds drop these rows (shared FeedView filter), so
  // the badge is for the surfaces that still render them. The live card
  // reads the session's mute set and marks the rendered (original)
  // author — no store read inside the pure badge module.
  afterEach(() => {
    act(() => {
      for (const id of ['a1', 'muted-user', 'bob']) {
        softMuteStore.set(SESSION.id, id, false)
      }
    })
  })

  it('marks a visible note whose author is soft-muted', () => {
    softMuteStore.set(SESSION.id, 'a1', true)
    live(makePost())
    expect(screen.getByTestId('post-badge-softMuted-p1')).toBeTruthy()
    expect(screen.getByText('Soft-muted')).toBeTruthy()
  })

  it('shows no badge when the author is not in the mute list', () => {
    live(makePost())
    expect(screen.queryByTestId('post-badge-softMuted-p1')).toBeNull()
    expect(screen.queryByText('Soft-muted')).toBeNull()
  })

  it('marks a renote whose rendered original author is soft-muted', () => {
    const original = makePost({id: 'orig', author: makeAccount({id: 'muted-user'})})
    const wrapper = makePost({
      id: 'wrap',
      author: makeAccount({id: 'bob', acct: 'bob@x.social', username: 'bob', host: 'x.social'}),
      content: {plain: ''},
      renoteId: 'orig',
      renote: original,
    })
    softMuteStore.set(SESSION.id, 'muted-user', true)
    live(wrapper)
    expect(screen.getByTestId('post-badge-softMuted-wrap')).toBeTruthy()
  })

  it('leaves a renote of an unmuted original unbadged', () => {
    const original = makePost({id: 'orig', author: makeAccount({id: 'other'})})
    const wrapper = makePost({
      id: 'wrap',
      author: makeAccount({id: 'bob', acct: 'bob@x.social', username: 'bob', host: 'x.social'}),
      content: {plain: ''},
      renoteId: 'orig',
      renote: original,
    })
    softMuteStore.set(SESSION.id, 'muted-user', true)
    live(wrapper)
    expect(screen.queryByTestId('post-badge-softMuted-wrap')).toBeNull()
  })
})

describe('like-key wiring (F18)', () => {
  it('the like button sets the configured like emoji, not a hardcoded heart', async () => {
    const {likeEmojiStore} = await import('#/state/emojiPrefs')
    likeEmojiStore.set(SESSION.id, '⭐')
    try {
      const b = live(makePost(), fakeBackend())
      fireEvent.press(screen.getByTestId('action-react-p1'))
      await waitFor(() => expect(b.react).toHaveBeenCalledWith('p1', '⭐'))
    } finally {
      likeEmojiStore.reset(SESSION.id)
    }
  })
})
