import {render, renderHook, act, screen} from '@testing-library/react-native'
import {QueryClient} from '@tanstack/react-query'

import type {Backend, Post} from '@keystone/fedi'

import {ReactionChips} from '#/components/Post/ReactionChips'
import {makePost} from '#/components/__tests__/fixtures'
import {
  ActionUnavailableError,
  applyPostShadow,
  createPostActionController,
  createPostShadowStore,
  gateAction,
  likeKind,
  patchPostInCaches,
  usePostShadow,
} from './index'

// Slice 4.1 tests. T1-T6 are the old reaction-optimistic cases rewritten
// for the shadow + toggle queue; the isolation block pins multi-session.

const S1 = 'https://a.example acct1'
const S2 = 'https://b.example acct1'

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {promise, resolve, reject}
}

function fakeBackend(over: Partial<Record<string, jest.Mock>> = {}, caps: Record<string, string> = {}) {
  const b = {
    capabilities: {reactions: 'supported', favourites_distinct_from_reactions: 'supported', bookmarks: 'supported', ...caps},
    react: jest.fn(async () => undefined),
    unreact: jest.fn(async () => undefined),
    favourite: jest.fn(async () => undefined),
    unfavourite: jest.fn(async () => undefined),
    boost: jest.fn(async () => ({})),
    unboost: jest.fn(async () => undefined),
    deletePost: jest.fn(async () => undefined),
    bookmarks: {add: jest.fn(async () => undefined), remove: jest.fn(async () => undefined)},
    ...over,
  }
  return b as unknown as Backend & typeof b
}

const mineOf = (store: ReturnType<typeof createPostShadowStore>, s: string, p: Post) =>
  applyPostShadow(p, store.get(s, p.id)).reactions?.mine ?? null

describe('post shadow + toggle queue', () => {
  let store: ReturnType<typeof createPostShadowStore>
  let ctl: ReturnType<typeof createPostActionController>
  beforeEach(() => {
    store = createPostShadowStore()
    ctl = createPostActionController({store})
  })

  it('T1 flips synchronously, before the server answers', async () => {
    const d = deferred()
    const b = fakeBackend({react: jest.fn(() => d.promise)})
    const post = makePost()
    const p = ctl.setReaction(S1, b, post, '❤')
    expect(mineOf(store, S1, post)).toBe('❤')
    const merged = applyPostShadow(post, store.get(S1, post.id))
    expect(merged.reactions?.total).toBe(6)
    expect(merged.counts.reactions).toBe(6)
    d.resolve()
    await p
    expect(b.react).toHaveBeenCalledWith('p1', '❤')
  })

  it('T2 rolls back to the confirmed value when the server rejects', async () => {
    const b = fakeBackend({react: jest.fn(async () => { throw new Error('nope') })})
    const post = makePost()
    await expect(ctl.setReaction(S1, b, post, '❤')).rejects.toThrow('nope')
    expect(mineOf(store, S1, post)).toBe(null)
    expect(store.get(S1, post.id)).toBeUndefined()
  })

  it('T3 unlike clears the reaction and calls unreact once', async () => {
    const post = makePost({reactions: {total: 5, entries: [{key: '❤', count: 5, mine: true, url: null}], mine: '❤', myReactions: ['❤'], urls: {}}})
    const b = fakeBackend()
    const p = ctl.setReaction(S1, b, post, null)
    expect(mineOf(store, S1, post)).toBe(null)
    await p
    expect(b.unreact).toHaveBeenCalledTimes(1)
    expect(b.react).not.toHaveBeenCalled()
  })

  it('T4 like then unlike in flight: create, delete, no third call', async () => {
    const d = deferred()
    const b = fakeBackend({react: jest.fn(() => d.promise)})
    const post = makePost()
    const p1 = ctl.setReaction(S1, b, post, '❤')
    const p2 = ctl.setReaction(S1, b, post, null)
    expect(mineOf(store, S1, post)).toBe(null)
    d.resolve()
    await Promise.all([p1, p2])
    expect(b.react).toHaveBeenCalledTimes(1)
    expect(b.unreact).toHaveBeenCalledTimes(1)
    expect(b.react.mock.invocationCallOrder[0]).toBeLessThan(b.unreact.mock.invocationCallOrder[0])
  })

  it('like, unlike, like in flight makes only the create', async () => {
    const d = deferred()
    const b = fakeBackend({react: jest.fn(() => d.promise)})
    const post = makePost()
    const ps = [ctl.setReaction(S1, b, post, '❤'), ctl.setReaction(S1, b, post, null), ctl.setReaction(S1, b, post, '❤')]
    d.resolve()
    await Promise.all(ps)
    expect(b.react).toHaveBeenCalledTimes(1)
    expect(b.unreact).not.toHaveBeenCalled()
  })

  it('changing a reaction is delete-then-create; partial failure leaves none', async () => {
    const post = makePost({reactions: {total: 5, entries: [{key: '❤', count: 5, mine: true, url: null}], mine: '❤', myReactions: ['❤'], urls: {}}})
    const b = fakeBackend()
    await ctl.setReaction(S1, b, post, '🎉')
    expect(b.unreact.mock.invocationCallOrder[0]).toBeLessThan(b.react.mock.invocationCallOrder[0])
    const b2 = fakeBackend({react: jest.fn(async () => { throw new Error('boom') })})
    await expect(ctl.setReaction(S1, b2, post, '🎉')).rejects.toThrow('boom')
    // delete landed, create failed: server holds nothing, not the old heart.
    expect(mineOf(store, S1, post)).toBe(null)
  })

  it('T5 pending custom emoji renders a 16x16 box, never :code: text', async () => {
    const d = deferred()
    const b = fakeBackend({react: jest.fn(() => d.promise)})
    const post = makePost()
    const p = ctl.setReaction(S1, b, post, ':blobcat@x.example:')
    const {result} = renderHook(() => usePostShadow(S1, post, store))
    expect(result.current.pendingEmojiKeys.has(':blobcat@x.example:')).toBe(true)
    render(<ReactionChips reactions={result.current.post.reactions} pendingKeys={result.current.pendingEmojiKeys} />)
    expect(screen.getByTestId('pending-emoji', {includeHiddenElements: true}).props.style).toMatchObject({width: 16, height: 16})
    expect(screen.queryByText(':blobcat@x.example:')).toBeNull()
    d.resolve()
    await p
    // Confirmed but art still unknown: the box stays (no text flash).
    expect(store.get(S1, post.id)?.pendingEmoji).toBe(':blobcat@x.example:')
  })

  it('T6 heart regression: unicode heart shows in the merged post and chips', async () => {
    const d = deferred()
    const b = fakeBackend({react: jest.fn(() => d.promise)})
    const post = makePost()
    const p = ctl.setReaction(S1, b, post, '❤')
    const {result} = renderHook(() => usePostShadow(S1, post, store))
    expect(result.current.post.reactions?.entries).toEqual([{key: '❤', count: 6, mine: true, url: null}])
    expect(result.current.pendingEmojiKeys.size).toBe(0)
    d.resolve()
    await p
  })

  it('hook re-renders on shadow change', async () => {
    const d = deferred()
    const b = fakeBackend({boost: jest.fn(() => d.promise as never)})
    const post = makePost()
    const {result} = renderHook(() => usePostShadow(S1, post, store))
    let p!: Promise<void>
    act(() => { p = ctl.setRenoted(S1, b, post, true) })
    expect(result.current.post.ext.reblogged).toBe(true)
    expect(result.current.post.counts.boosts).toBe(4)
    await act(async () => { d.resolve(); await p })
  })

  it('favourite, bookmark and delete toggles', async () => {
    const post = makePost()
    const b = fakeBackend()
    const pf = ctl.setFavourite(S1, b, post, true)
    expect(applyPostShadow(post, store.get(S1, post.id)).favourite).toEqual({count: 6, mine: true})
    await pf
    await ctl.setBookmarked(S1, b, post, true)
    expect(b.bookmarks.add).toHaveBeenCalledWith('p1')
    const bad = fakeBackend({deletePost: jest.fn(async () => { throw new Error('no') })})
    await expect(ctl.deletePost(S1, bad, post, true)).rejects.toThrow('no')
    expect(store.get(S1, post.id)?.isDeleted).toBeUndefined()
    await ctl.deletePost(S1, b, post, true)
    expect(store.get(S1, post.id)?.isDeleted).toBe(true)
  })

  it('gates: unsupported actions refuse without flipping anything', async () => {
    const b = fakeBackend({}, {reactions: 'unsupported', bookmarks: 'unknown'})
    const post = makePost()
    await expect(ctl.setReaction(S1, b, post, '❤')).rejects.toBeInstanceOf(ActionUnavailableError)
    await expect(ctl.setBookmarked(S1, b, post, true)).rejects.toBeInstanceOf(ActionUnavailableError)
    await expect(ctl.deletePost(S1, b, post, false)).rejects.toBeInstanceOf(ActionUnavailableError)
    await expect(ctl.setReaction(S1, null, post, '❤')).rejects.toBeInstanceOf(ActionUnavailableError)
    expect(store.get(S1, post.id)).toBeUndefined()
    expect(b.react).not.toHaveBeenCalled()
    expect(gateAction('reaction', {capabilities: b.capabilities})).toMatchObject({enabled: false})
    expect(likeKind('mastodon', {...b.capabilities, reactions: 'unsupported'} as never)).toBe('favourite')
    expect(likeKind('misskey', b.capabilities)).toBeNull()
  })

  describe('multi-session isolation', () => {
    it('shadow, queues and backends are per session', async () => {
      const d = deferred()
      const b1 = fakeBackend({react: jest.fn(() => d.promise)})
      const b2 = fakeBackend()
      const post = makePost()
      const p1 = ctl.setReaction(S1, b1, post, '❤')
      expect(mineOf(store, S2, post)).toBe(null)
      await ctl.setReaction(S2, b2, post, '🎉')
      expect(b2.react).toHaveBeenCalledWith('p1', '🎉')
      expect(b1.react).toHaveBeenCalledTimes(1)
      expect(b1.react).not.toHaveBeenCalledWith('p1', '🎉')
      expect(mineOf(store, S1, post)).toBe('❤')
      d.resolve()
      await p1
    })

    it('cache patching only touches the given session', () => {
      const qc = new QueryClient()
      const post = makePost()
      const page = {items: [post], cursor: null, end: true}
      qc.setQueryData([S1, 'post-feed', 'home'], {pages: [page], pageParams: [null]})
      qc.setQueryData([S2, 'post-feed', 'home'], {pages: [page], pageParams: [null]})
      const n = patchPostInCaches(qc, S1, 'p1', p => ({...p, cw: 'x'}))
      expect(n).toBe(1)
      expect((qc.getQueryData([S1, 'post-feed', 'home']) as {pages: {items: Post[]}[]}).pages[0].items[0].cw).toBe('x')
      expect((qc.getQueryData([S2, 'post-feed', 'home']) as {pages: {items: Post[]}[]}).pages[0].items[0].cw).toBeNull()
    })

    it('settle writes the confirmed reaction into S1 cache only, then drops the shadow', async () => {
      const qc = new QueryClient()
      const c = createPostActionController({store, queryClient: qc})
      const post = makePost()
      const page = {items: [post], cursor: null, end: true}
      qc.setQueryData([S1, 'post-feed', 'home'], {pages: [page], pageParams: [null]})
      qc.setQueryData([S2, 'post-feed', 'home'], {pages: [page], pageParams: [null]})
      await c.setReaction(S1, fakeBackend(), post, '❤')
      const get = (s: string) => (qc.getQueryData([s, 'post-feed', 'home']) as {pages: {items: Post[]}[]}).pages[0].items[0]
      expect(get(S1).reactions?.mine).toBe('❤')
      expect(get(S2).reactions?.mine).toBeNull()
      expect(store.get(S1, post.id)).toBeUndefined()
    })

    it('empty sessionId throws', () => {
      expect(() => store.get('', 'p1')).toThrow()
    })
  })
})
