// Repair X3.4 (mastodon 13): feed-level deletes fan out through the
// handle's `onDeletes` into `createFeedLive`'s `onDelete`, so unwatched
// ids leave the feed caches without a refetch.
import {createFeedLive, type FeedLiveOpts} from './streaming'

import type {FeedSource, Post, StreamHandle} from '@keystone/fedi'

function fakePost(id: string): Post {
  return {id} as unknown as Post
}

function fakeHandle(hasDeletes = true): StreamHandle & {
  emitPost: (post: Post) => void
  emitDelete: (id: string) => void
} {
  let postCb: ((post: Post) => void) | null = null
  let deletesCb: ((id: string) => void) | null = null
  const handle = {
    emitPost: (post: Post) => postCb?.(post),
    emitDelete: (id: string) => deletesCb?.(id),
    subscribeTimeline: (_source: FeedSource, onPost: (post: Post) => void) => {
      postCb = onPost
      return {unsubscribe: () => { postCb = null }, status: () => 'subscribed' as const}
    },
    subscribePost: () => () => undefined,
    onNotification: () => () => undefined,
    status: () => 'connected' as const,
    onStatusChange: () => () => undefined,
  } as unknown as StreamHandle & {
    emitPost: (post: Post) => void
    emitDelete: (id: string) => void
    onDeletes: (handler: (id: string) => void) => () => void
  }
  if (hasDeletes) {
    handle.onDeletes = handler => {
      deletesCb = handler
      return () => { deletesCb = null }
    }
  }
  return handle
}

describe('createFeedLive feed-level deletes (X3.4)', () => {
  it('routes handle-level deletes for unwatched ids to onDelete', () => {
    const handle = fakeHandle()
    const deleted: string[] = []
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      onInsert: () => undefined,
      onDelete: id => deleted.push(id),
    } satisfies FeedLiveOpts)
    // An id nobody watched (no cache baseline, no arrival) still deletes.
    handle.emitDelete('ghost-post')
    expect(deleted).toEqual(['ghost-post'])
    live.dispose()
  })

  it('fans out every delete and stops after dispose', () => {
    const handle = fakeHandle()
    const deleted: string[] = []
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      onInsert: () => undefined,
      onDelete: id => deleted.push(id),
    } satisfies FeedLiveOpts)
    handle.emitDelete('a')
    handle.emitDelete('b')
    expect(deleted).toEqual(['a', 'b'])
    live.dispose()
    handle.emitDelete('c')
    expect(deleted).toEqual(['a', 'b'])
  })

  it('stands down without onDeletes (Misskey handle: per-post capture only)', () => {
    const handle = fakeHandle(false)
    const deleted: string[] = []
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      onInsert: () => undefined,
      onDelete: id => deleted.push(id),
    } satisfies FeedLiveOpts)
    // No fan-out available: nothing fires, nothing throws.
    expect(deleted).toEqual([])
    live.dispose()
  })
})
