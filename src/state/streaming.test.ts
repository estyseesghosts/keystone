import {QueryClient} from '@tanstack/react-query'

import type {FeedSource, Notification, PostUpdateEvent, StreamHandle, StreamState} from '@keystone/fedi'
import type {Post} from '@keystone/fedi'

import {
  createFeedLive,
  createLiveRegistry,
  createPostLive,
  feedSourceForDescriptor,
  feedSourceKey,
  ingestLiveNotification,
  liveKey,
  prependLivePosts,
  removeLivePost,
} from '#/state/streaming'
import {feedQueryKey} from '#/state/queries/keys'
import {notificationsFilterKey} from '#/state/queries/notifications'
import {notificationsQueryKey} from '#/state/queries/keys'

function fakePost(id: string): Post {
  // author + content keep the row post-shaped for `patchPostInCaches`
  // (bare `{id}` rows read as notification-shaped and are never dropped).
  return {id, author: {id: 'a1'}, content: {plain: id}} as unknown as Post
}

function feedData(ids: string[]) {
  return {
    pages: [{items: ids.map(fakePost), cursor: null, end: true}],
    pageParams: [null],
  }
}

function notif(id: string): Notification {
  return {id, read: false} as unknown as Notification
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

describe('createFeedLive delete/update capture (MD10 app half)', () => {
  function captureHandle(): {
    handle: StreamHandle
    emitPost: (post: Post) => void
    postHandlers: Map<string, {onUpdated?: (e: PostUpdateEvent) => void; onDeleted?: () => void}>
    released: string[]
  } {
    const base = fakeHandle()
    const postHandlers = new Map<
      string,
      {onUpdated?: (e: PostUpdateEvent) => void; onDeleted?: () => void}
    >()
    const released: string[] = []
    const handle: StreamHandle = {
      ...base,
      subscribePost: (id: string, h) => {
        postHandlers.set(id, h)
        return () => {
          released.push(id)
          postHandlers.delete(id)
        }
      },
    }
    return {handle, emitPost: base.emitPost, postHandlers, released}
  }

  it('routes watched-post deletes/updates to onDelete/onUpdate', () => {
    const {handle, postHandlers} = captureHandle()
    const deleted: string[] = []
    const updated: PostUpdateEvent[] = []
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      knownIds: ['k1'],
      onInsert: () => {},
      onDelete: id => deleted.push(id),
      onUpdate: e => updated.push(e),
    })
    // knownIds are watched from creation (cache baseline).
    postHandlers.get('k1')?.onUpdated?.({id: 'k1', type: 'reacted', reaction: '❤'})
    postHandlers.get('k1')?.onDeleted?.()
    expect(updated).toEqual([{id: 'k1', type: 'reacted', reaction: '❤'}])
    expect(deleted).toEqual(['k1'])
    live.dispose()
  })

  it('watches buffered arrivals on insert', () => {
    const {handle, emitPost, postHandlers} = captureHandle()
    const deleted: string[] = []
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      onInsert: () => {},
      onDelete: id => deleted.push(id),
    })
    emitPost(fakePost('p9'))
    expect(postHandlers.has('p9')).toBe(true)
    postHandlers.get('p9')?.onDeleted?.()
    expect(deleted).toEqual(['p9'])
    live.dispose()
  })

  it('subscribes nothing without delete/update handlers', () => {
    const {handle, emitPost, postHandlers} = captureHandle()
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      knownIds: ['k1'],
      onInsert: () => {},
    })
    emitPost(fakePost('p1'))
    expect(postHandlers.size).toBe(0)
    live.dispose()
  })

  it('dispose releases every per-post capture', () => {
    const {handle, released} = captureHandle()
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      knownIds: ['k1', 'k2'],
      onInsert: () => {},
      onDelete: () => {},
    })
    live.dispose()
    expect(released.sort()).toEqual(['k1', 'k2'])
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

describe('feedSourceForDescriptor (WS-G)', () => {
  it('maps channel-capable descriptors 1:1 onto FeedSource', () => {
    expect(feedSourceForDescriptor('timeline|home')).toEqual({kind: 'home'})
    expect(feedSourceForDescriptor('timeline|local')).toEqual({kind: 'local'})
    expect(feedSourceForDescriptor('timeline|social')).toEqual({kind: 'social'})
    expect(feedSourceForDescriptor('timeline|global')).toEqual({kind: 'global'})
    expect(feedSourceForDescriptor('list|l1')).toEqual({listId: 'l1'})
    expect(feedSourceForDescriptor('antenna|a1')).toEqual({antennaId: 'a1'})
    expect(feedSourceForDescriptor('tag|cats')).toEqual({tag: 'cats'})
  })

  it('returns null for feeds with no live channel (paging-only, never faked)', () => {
    for (const d of [
      'clip|c1',
      'bookmarks',
      'mentions',
      'user|u1|posts',
      'user|u1|replies',
      'search|query',
      'explore|posts',
    ]) {
      expect(feedSourceForDescriptor(d)).toBeNull()
    }
    expect(feedSourceForDescriptor('bogus|descriptor')).toBeNull()
  })
})

describe('createFeedLive pending + watch (WS-G)', () => {
  it('notifies onPending per arrival, not for dedupe drops', () => {
    const handle = fakeHandle()
    let pending = 0
    const live = createFeedLive({
      handle,
      source: {kind: 'home'},
      knownIds: ['seen'],
      onInsert: () => {},
      onPending: () => (pending += 1),
    })
    handle.emitPost(fakePost('seen'))
    handle.emitPost(fakePost('p1'))
    expect(pending).toBe(1)
    expect(live.pendingCount()).toBe(1)
    live.dispose()
  })

  it('watch() is idempotent and routes deletes for late-watched ids', () => {
    const base = fakeHandle()
    const postHandlers = new Map<string, {onDeleted?: () => void}>()
    const handle: StreamHandle = {
      ...base,
      subscribePost: (id: string, h) => {
        postHandlers.set(id, h)
        return () => {
          postHandlers.delete(id)
        }
      },
    }
    const deleted: string[] = []
    const live = createFeedLive({handle, source: {kind: 'home'}, onInsert: () => {}, onDelete: id => deleted.push(id)})
    live.watch('late')
    live.watch('late')
    expect(postHandlers.has('late')).toBe(true)
    postHandlers.get('late')?.onDeleted?.()
    expect(deleted).toEqual(['late'])
    live.dispose()
  })

  it('exposes the timeline channel state for the mount to stand down on gaps', () => {
    const handle = fakeHandle()
    const live = createFeedLive({handle, source: {kind: 'home'}, onInsert: () => {}})
    expect(live.channelStatus()).toBe('subscribed')
    live.dispose()
    const disabled: StreamHandle = {
      ...handle,
      subscribeTimeline: () => ({unsubscribe: () => undefined, status: () => 'disabled' as const}),
    }
    const gap = createFeedLive({handle: disabled, source: {kind: 'social'}, onInsert: () => {}})
    expect(gap.channelStatus()).toBe('disabled')
    gap.dispose()
  })
})

describe('prependLivePosts / removeLivePost (WS-G)', () => {
  function clientWithFeed(): QueryClient {
    const client = new QueryClient()
    client.setQueryData(feedQueryKey('s', 'timeline|home'), feedData(['p1']))
    return client
  }

  it('prepends newest-first and dedupes against the cache and the batch', () => {
    const client = clientWithFeed()
    const inserted = prependLivePosts(client, 's', 'timeline|home', [
      fakePost('p2'),
      fakePost('p1'),
      fakePost('p2'),
    ])
    expect(inserted).toBe(1)
    const data = client.getQueryData<{pages: Array<{items: Post[]}>}>(feedQueryKey('s', 'timeline|home'))!
    expect(data.pages[0].items.map(p => p.id)).toEqual(['p2', 'p1'])
  })

  it('is a no-op without cached pages (the next fetch covers those posts)', () => {
    const client = new QueryClient()
    expect(prependLivePosts(client, 's', 'timeline|home', [fakePost('p9')])).toBe(0)
    expect(prependLivePosts(client, 's', 'timeline|home', [])).toBe(0)
  })

  it('never touches another session’s cache', () => {
    const client = clientWithFeed()
    expect(prependLivePosts(client, 'other', 'timeline|home', [fakePost('p2')])).toBe(0)
    const data = client.getQueryData<{pages: Array<{items: Post[]}>}>(feedQueryKey('s', 'timeline|home'))!
    expect(data.pages[0].items.map(p => p.id)).toEqual(['p1'])
  })

  it('removeLivePost drops the row cache-wide via patchPostInCaches', () => {
    const client = clientWithFeed()
    expect(removeLivePost(client, 's', 'p1')).toBeGreaterThan(0)
    const data = client.getQueryData<{pages: Array<{items: Post[]}>}>(feedQueryKey('s', 'timeline|home'))!
    expect(data.pages[0].items).toEqual([])
  })
})

describe('ingestLiveNotification (WS-G)', () => {
  function clientWithNotifications(): QueryClient {
    const client = new QueryClient()
    client.setQueryData(notificationsQueryKey('s', notificationsFilterKey('all', true)), {
      pages: [{items: [notif('n1')], cursor: null, end: true}],
      pageParams: [null],
    })
    client.setQueryData(notificationsQueryKey('s', notificationsFilterKey('all', false)), {
      pages: [{items: [notif('n1')], cursor: null, end: true}],
      pageParams: [null],
    })
    client.setQueryData(notificationsQueryKey('s', notificationsFilterKey('mentions', true)), {
      pages: [{items: [], cursor: null, end: true}],
      pageParams: [null],
    })
    return client
  }

  function itemsOf(client: QueryClient, key: readonly unknown[]): string[] {
    const data = client.getQueryData<{pages: Array<{items: Notification[]}>}>(key)
    return data?.pages[0]?.items.map(n => n.id) ?? []
  }

  it('prepends into every `all` listing and invalidates filtered views', () => {
    const client = clientWithNotifications()
    const res = ingestLiveNotification(client, 's', notif('n2'))
    expect(res).toEqual({prepended: 2, invalidated: 1})
    expect(itemsOf(client, notificationsQueryKey('s', notificationsFilterKey('all', true)))).toEqual(['n2', 'n1'])
    expect(itemsOf(client, notificationsQueryKey('s', notificationsFilterKey('all', false)))).toEqual(['n2', 'n1'])
    const mentionsState = client.getQueryState(notificationsQueryKey('s', notificationsFilterKey('mentions', true)))
    expect(mentionsState?.isInvalidated).toBe(true)
  })

  it('dedupes repeat deliveries (streaming redelivers on reconnect)', () => {
    const client = clientWithNotifications()
    ingestLiveNotification(client, 's', notif('n1'))
    expect(itemsOf(client, notificationsQueryKey('s', notificationsFilterKey('all', true)))).toEqual(['n1'])
  })

  it('unknown filter shapes invalidate rather than guess (server is the filter authority)', () => {
    const client = new QueryClient()
    const oddKey = ['s', 'notifications', 'custom|grouped:0'] as const
    client.setQueryData(oddKey as unknown as readonly unknown[], {
      pages: [{items: [], cursor: null, end: true}],
      pageParams: [null],
    })
    const res = ingestLiveNotification(client, 's', notif('n9'))
    expect(res).toEqual({prepended: 0, invalidated: 1})
  })
})
