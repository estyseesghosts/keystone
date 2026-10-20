import type {FeedSource, StreamHandle, StreamState} from '@keystone/fedi'
import type {Post} from '@keystone/fedi'

import {
  createFeedLive,
  createLiveRegistry,
  createPostLive,
  feedSourceKey,
  liveKey,
} from '#/state/streaming'

function fakePost(id: string): Post {
  return {id} as Post
}

function fakeHandle(hooks: {
  onPost?: (post: Post) => void
  state?: StreamState
} = {}): StreamHandle & {
  emitPost: (post: Post) => void
  emitState: (s: StreamState) => void
  unsubscribed: () => boolean
} {
  let postCb: ((post: Post) => void) | null = null
  let state: StreamState = hooks.state ?? 'connected'
  const listeners = new Set<(s: StreamState) => void>()
  let unsub = false
  return {
    emitPost: (post: Post) => postCb?.(post),
    emitState: (s: StreamState) => {
      state = s
      for (const fn of [...listeners]) fn(s)
    },
    unsubscribed: () => unsub,
    subscribeTimeline: (_source: FeedSource, onPost: (post: Post) => void) => {
      postCb = onPost
      if (hooks.onPost) {
        const prev = postCb
        postCb = (p: Post) => {
          hooks.onPost!(p)
          prev(p)
        }
      }
      return {
        unsubscribe: () => {
          unsub = true
          postCb = null
        },
        status: () => 'subscribed',
      }
    },
    subscribePost: () => () => undefined,
    onNotification: () => () => undefined,
    status: () => state,
    onStatusChange: (handler: (s: StreamState) => void) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
  }
}

describe('feedSourceKey / liveKey', () => {
  it('round-trips every source shape and scopes by session', () => {
    expect(feedSourceKey({kind: 'home'})).toBe('timeline|home')
    expect(feedSourceKey({antennaId: 'a1'})).toBe('antenna|a1')
    expect(feedSourceKey({listId: 'l1'})).toBe('list|l1')
    expect(feedSourceKey({tag: 'cats'})).toBe('tag|cats')
    expect(feedSourceKey({clipId: 'c1'})).toBe('clip|c1')
    expect(liveKey('sA', {kind: 'home'})).not.toBe(liveKey('sB', {kind: 'home'}))
  })
})

describe('createFeedLive', () => {
  it('buffers arrivals behind the pill and flushes on tap (no scroll jump)', () => {
    const handle = fakeHandle()
    const inserted: Post[][] = []
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      onInsert: posts => inserted.push(posts),
    })
    handle.emitPost(fakePost('p1'))
    handle.emitPost(fakePost('p2'))
    expect(live.pendingCount()).toBe(2)
    expect(inserted).toHaveLength(0)
    const batch = live.flush()
    expect(batch.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(inserted).toEqual([batch])
    expect(live.pendingCount()).toBe(0)
    live.dispose()
  })

  it('dedupes streamed notes against the cache and within the buffer', () => {
    const handle = fakeHandle()
    const inserted: Post[] = []
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      knownIds: ['p0'],
      onInsert: posts => inserted.push(...posts),
    })
    handle.emitPost(fakePost('p0'))
    handle.emitPost(fakePost('p1'))
    handle.emitPost(fakePost('p1'))
    expect(live.pendingCount()).toBe(1)
    live.dispose()
  })

  it('is unavailable without a handle (paging + refresh stay the path)', () => {
    const live = createFeedLive({
      handle: null,
      source: {kind: 'social'},
      onInsert: () => {},
    })
    expect(live.status()).toBe('unavailable')
    expect(live.flush()).toEqual([])
    live.dispose()
  })

  it('surfaces handle status for badges and disposes the subscription', () => {
    const handle = fakeHandle({state: 'reconnecting'})
    const seen: StreamState[] = []
    const live = createFeedLive({
      handle,
      source: {kind: 'local'},
      onInsert: () => {},
    })
    expect(live.status()).toBe('reconnecting')
    const off = live.onStatusChange(s => seen.push(s))
    handle.emitState('connected')
    expect(seen).toEqual(['connected'])
    off()
    live.dispose()
    expect(handle.unsubscribed()).toBe(true)
  })
})

describe('createPostLive', () => {
  it('forwards delete events and no-ops without a handle', () => {
    let deleted = 0
    const handle = fakeHandle()
    const withDelete: StreamHandle = {
      ...handle,
      subscribePost: (_id: string, h: {onDeleted?: () => void}) => {
        h.onDeleted?.()
        return () => undefined
      },
    }
    const off = createPostLive(withDelete, 'p1', {onDeleted: () => (deleted += 1)})
    expect(deleted).toBe(1)
    off()
    const noop = createPostLive(null, 'p1', {onDeleted: () => (deleted += 1)})
    noop()
    expect(deleted).toBe(1)
  })
})

describe('createLiveRegistry', () => {
  it('isolates live entries per account (no cross-account leaks)', () => {
    const registry = createLiveRegistry()
    const insertedA: Post[] = []
    const insertedB: Post[] = []
    const keyA = liveKey('sA', {kind: 'home'})
    const keyB = liveKey('sB', {kind: 'home'})
    const liveA = registry.acquire(
      keyA,
      () =>
        createFeedLive({handle: fakeHandle(), source: {kind: 'home'}, onInsert: p => insertedA.push(...p)}),
    )
    const sameA = registry.acquire(keyA, () =>
      createFeedLive({handle: fakeHandle(), source: {kind: 'home'}, onInsert: () => {}}),
    )
    expect(sameA).toBe(liveA)
    registry.acquire(keyB, () =>
      createFeedLive({handle: fakeHandle(), source: {kind: 'home'}, onInsert: p => insertedB.push(...p)}),
    )
    expect(registry.size()).toBe(2)
    expect(registry.get(keyA)).toBe(liveA)
    registry.release(keyA)
    expect(registry.get(keyA)).toBeUndefined()
    expect(registry.size()).toBe(1)
    registry.clear()
    expect(registry.size()).toBe(0)
  })
})
