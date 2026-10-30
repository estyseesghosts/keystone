// Repair X3.2: stream AppState handling + reconnect gap-fill + update
// coalescing (networking M3/M7).
//
// Drives fake AppState/network sources: sockets release 30 s after
// background (never on foreground-with-healthy-socket), foreground nudges
// only dead handles, gap-fill invalidates after any observed outage
// (inactive queries trimmed to one page; mounted queries keep their pages
// so a reconnect never collapses a scrolled list), and a 20-event burst
// costs <= 2 requests with the final state matching the last response.

import {QueryClient} from '@tanstack/react-query'

import type {Post, PostUpdateEvent, StreamHandle, StreamState} from '@keystone/fedi'

import {feedQueryKey, notificationsQueryKey} from './queries/keys'
import {notificationsFilterKey} from './queries/notifications'
import {
  POST_UPDATE_DEBOUNCE_MS,
  STREAM_BACKGROUND_SUSPEND_MS,
  createPostUpdateCoalescer,
  gapFillSessionFirstPages,
  monitorStreamAppState,
  resumeStreamHandle,
  watchStreamGapFill,
  type StreamAppStateSource,
} from './streaming'

function fakePost(id: string): Post {
  return {id, author: {id: 'a1'}, content: {plain: id}} as unknown as Post
}

function pagesOf(ids: string[][]) {
  return {
    pages: ids.map(items => ({items: items.map(fakePost), cursor: null, end: true})),
    pageParams: ids.map((_, i) => (i === 0 ? null : `c${i}`)),
  }
}

function fullHandle(over: Partial<StreamHandle> = {}): StreamHandle {
  return {
    subscribeTimeline: () => ({unsubscribe: () => undefined, status: () => 'subscribed' as const}),
    subscribePost: () => () => undefined,
    onNotification: () => () => undefined,
    status: () => 'connected' as StreamState,
    onStatusChange: () => () => undefined,
    ...over,
  }
}

function fakeAppStateSource(initial = 'active') {
  let handler: ((state: string) => void) | null = null
  let current = initial
  const source: StreamAppStateSource = {
    get currentState() {
      return current
    },
    addEventListener: (_type, h) => {
      handler = h
      return {
        remove: () => {
          handler = null
        },
      }
    },
  }
  return {
    source,
    fire(state: string) {
      current = state
      handler?.(state)
    },
  }
}

describe('monitorStreamAppState', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('suspends once after 30 s backgrounded', () => {
    const fake = fakeAppStateSource('active')
    let suspends = 0
    let resumes = 0
    const off = monitorStreamAppState({
      source: fake.source,
      onSuspend: () => {
        suspends += 1
      },
      onResume: () => {
        resumes += 1
      },
    })
    fake.fire('background')
    jest.advanceTimersByTime(STREAM_BACKGROUND_SUSPEND_MS - 1)
    expect(suspends).toBe(0)
    jest.advanceTimersByTime(1)
    expect(suspends).toBe(1)
    expect(resumes).toBe(0)
    off()
  })

  it('foreground before the delay cancels the suspend', () => {
    const fake = fakeAppStateSource('active')
    let suspends = 0
    let resumes = 0
    const off = monitorStreamAppState({
      source: fake.source,
      onSuspend: () => {
        suspends += 1
      },
      onResume: () => {
        resumes += 1
      },
    })
    fake.fire('background')
    jest.advanceTimersByTime(10_000)
    fake.fire('active')
    expect(resumes).toBe(1)
    jest.advanceTimersByTime(60_000)
    expect(suspends).toBe(0)
    off()
  })

  it('treats inactive like background', () => {
    const fake = fakeAppStateSource('active')
    let suspends = 0
    const off = monitorStreamAppState({
      source: fake.source,
      onSuspend: () => {
        suspends += 1
      },
      onResume: () => {},
    })
    fake.fire('inactive')
    jest.advanceTimersByTime(STREAM_BACKGROUND_SUSPEND_MS)
    expect(suspends).toBe(1)
    off()
  })

  it('arms the timer when mounted already backgrounded', () => {
    const fake = fakeAppStateSource('background')
    let suspends = 0
    const off = monitorStreamAppState({
      source: fake.source,
      onSuspend: () => {
        suspends += 1
      },
      onResume: () => {},
    })
    jest.advanceTimersByTime(STREAM_BACKGROUND_SUSPEND_MS)
    expect(suspends).toBe(1)
    off()
  })

  it('dispose cancels a pending suspend', () => {
    const fake = fakeAppStateSource('active')
    let suspends = 0
    const off = monitorStreamAppState({
      source: fake.source,
      onSuspend: () => {
        suspends += 1
      },
      onResume: () => {},
    })
    fake.fire('background')
    off()
    jest.advanceTimersByTime(60_000)
    expect(suspends).toBe(0)
  })

  it('a throwing source or callback never breaks the caller', () => {
    expect(() =>
      monitorStreamAppState({
        source: {
          get currentState() {
            return 'active'
          },
          addEventListener: () => {
            throw new Error('no AppState')
          },
        },
        onSuspend: () => {},
        onResume: () => {},
      }),
    ).not.toThrow()
    const fake = fakeAppStateSource('active')
    const off = monitorStreamAppState({
      source: fake.source,
      onSuspend: () => {
        throw new Error('suspend blew up')
      },
      onResume: () => {
        throw new Error('resume blew up')
      },
    })
    fake.fire('background')
    expect(() => jest.advanceTimersByTime(STREAM_BACKGROUND_SUSPEND_MS)).not.toThrow()
    expect(() => fake.fire('active')).not.toThrow()
    off()
  })
})

describe('resumeStreamHandle', () => {
  it('leaves connected/connecting/unavailable handles alone', () => {
    for (const state of ['connected', 'connecting', 'unavailable'] as StreamState[]) {
      let retried = 0
      const handle = fullHandle({
        status: () => state,
        retry: () => {
          retried += 1
        },
      })
      expect(resumeStreamHandle(handle)).toBe(false)
      expect(retried).toBe(0)
    }
  })

  it('retries dead handles (reconnecting/error/stopped)', () => {
    for (const state of ['reconnecting', 'error', 'stopped'] as StreamState[]) {
      let retried = 0
      const handle = fullHandle({
        status: () => state,
        retry: () => {
          retried += 1
        },
      })
      expect(resumeStreamHandle(handle)).toBe(true)
      expect(retried).toBe(1)
    }
  })

  it('no-ops when the handle has no retry (self-healing pools)', () => {
    const handle = fullHandle({status: () => 'reconnecting' as StreamState})
    expect(resumeStreamHandle(handle)).toBe(false)
  })

  it('never throws on null, throwing status, or throwing retry', () => {
    expect(resumeStreamHandle(null)).toBe(false)
    expect(
      resumeStreamHandle(
        fullHandle({
          status: () => {
            throw new Error('status blew up')
          },
        }),
      ),
    ).toBe(false)
    expect(
      resumeStreamHandle(
        fullHandle({
          status: () => 'error' as StreamState,
          retry: () => {
            throw new Error('retry blew up')
          },
        }),
      ),
    ).toBe(false)
  })
})

describe('gapFillSessionFirstPages', () => {
  function clientWithPages(): QueryClient {
    const client = new QueryClient()
    client.setQueryData(feedQueryKey('s', 'timeline|home'), pagesOf([['p1'], ['p2'], ['p3']]))
    client.setQueryData(
      notificationsQueryKey('s', notificationsFilterKey('all', true)),
      pagesOf([['n1']]),
    )
    client.setQueryData(['s', 'server-filters'], {filters: []})
    client.setQueryData(feedQueryKey('t', 'timeline|home'), pagesOf([['q1'], ['q2']]))
    return client
  }

  it('trims feeds to the first page and invalidates feed + notifications', () => {
    const client = clientWithPages()
    gapFillSessionFirstPages(client, 's')
    const feed = client.getQueryData<{pages: Array<{items: Post[]}>; pageParams: unknown[]}>(
      feedQueryKey('s', 'timeline|home'),
    )!
    expect(feed.pages).toHaveLength(1)
    expect(feed.pages[0].items.map(p => p.id)).toEqual(['p1'])
    expect(feed.pageParams).toHaveLength(1)
    expect(client.getQueryState(feedQueryKey('s', 'timeline|home'))?.isInvalidated).toBe(true)
    expect(
      client.getQueryState(notificationsQueryKey('s', notificationsFilterKey('all', true)))
        ?.isInvalidated,
    ).toBe(true)
  })

  it('leaves a mounted (active) query paged but still invalidates it', () => {
    const client = clientWithPages()
    gapFillSessionFirstPages(client, 's', {
      isActiveKey: key =>
        Array.isArray(key) && key[1] === 'post-feed' && key[2] === 'timeline|home',
    })
    const feed = client.getQueryData<{pages: Array<{items: Post[]}>; pageParams: unknown[]}>(
      feedQueryKey('s', 'timeline|home'),
    )!
    // Mounted list: all three pages intact — no mid-scroll collapse — but
    // invalidated, so the head refetches in place and the outage fills.
    expect(feed.pages).toHaveLength(3)
    expect(feed.pageParams).toHaveLength(3)
    expect(client.getQueryState(feedQueryKey('s', 'timeline|home'))?.isInvalidated).toBe(true)
    // Unmounted notifications still trim to one page.
    const notifs = client.getQueryData<{pages: unknown[]}>(
      notificationsQueryKey('s', notificationsFilterKey('all', true)),
    )!
    expect(notifs.pages).toHaveLength(1)
  })

  it('trims everything when nothing is mounted (default active set)', () => {
    const client = clientWithPages()
    gapFillSessionFirstPages(client, 's')
    const feed = client.getQueryData<{pages: Array<{items: Post[]}>; pageParams: unknown[]}>(
      feedQueryKey('s', 'timeline|home'),
    )!
    expect(feed.pages).toHaveLength(1)
    expect(feed.pages[0].items.map(p => p.id)).toEqual(['p1'])
  })

  it('leaves the ranked recommendations feed entirely alone', () => {
    const client = clientWithPages()
    const recKey = feedQueryKey('s', 'recommendations|["en",false,true]')
    client.setQueryData(recKey, pagesOf([['r1'], ['r2']]))
    gapFillSessionFirstPages(client, 's')
    // No trim AND no invalidate: a background fill here is a reroll, not
    // a refresh — rows remount and the reader's offset lands elsewhere.
    const rec = client.getQueryData<{pages: unknown[]}>(recKey)!
    expect(rec.pages).toHaveLength(2)
    expect(client.getQueryState(recKey)?.isInvalidated).not.toBe(true)
    // Timelines still fill.
    expect(client.getQueryState(feedQueryKey('s', 'timeline|home'))?.isInvalidated).toBe(true)
  })

  it('never touches other kinds or other sessions', () => {
    const client = clientWithPages()
    gapFillSessionFirstPages(client, 's')
    expect(client.getQueryData(['s', 'server-filters'])).toEqual({filters: []})
    expect(client.getQueryState(['s', 'server-filters'])?.isInvalidated).not.toBe(true)
    const other = client.getQueryData<{pages: unknown[]}>(feedQueryKey('t', 'timeline|home'))!
    expect(other.pages).toHaveLength(2)
    expect(client.getQueryState(feedQueryKey('t', 'timeline|home'))?.isInvalidated).not.toBe(true)
  })

  it('tolerates non-infinite data under a gap-fill key', () => {
    const client = new QueryClient()
    client.setQueryData(['s', 'post-feed', 'timeline|home'], {odd: true})
    expect(() => gapFillSessionFirstPages(client, 's')).not.toThrow()
    expect(client.getQueryState(['s', 'post-feed', 'timeline|home'])?.isInvalidated).toBe(true)
  })
})

describe('watchStreamGapFill', () => {
  function statusHandle(initial: StreamState) {
    let state = initial
    const listeners = new Set<(s: StreamState) => void>()
    return {
      handle: fullHandle({
        status: () => state,
        onStatusChange: h => {
          listeners.add(h)
          return () => {
            listeners.delete(h)
          }
        },
      }),
      emit(next: StreamState) {
        state = next
        for (const listener of [...listeners]) listener(next)
      },
    }
  }

  it('gap-fills on connected after an observed outage', () => {
    const client = new QueryClient()
    client.setQueryData(feedQueryKey('s', 'timeline|home'), pagesOf([['p1'], ['p2'], ['p3']]))
    const {handle, emit} = statusHandle('connected')
    const off = watchStreamGapFill({client, sessionId: 's', handle})
    emit('reconnecting')
    emit('connected')
    const feed = client.getQueryData<{pages: unknown[]}>(feedQueryKey('s', 'timeline|home'))!
    expect(feed.pages).toHaveLength(1)
    expect(client.getQueryState(feedQueryKey('s', 'timeline|home'))?.isInvalidated).toBe(true)
    off()
  })

  it('gap-fills after the error-path redial (never via reconnecting)', () => {
    const client = new QueryClient()
    client.setQueryData(feedQueryKey('s', 'timeline|home'), pagesOf([['p1'], ['p2']]))
    const {handle, emit} = statusHandle('connected')
    const off = watchStreamGapFill({client, sessionId: 's', handle})
    emit('error')
    emit('connecting')
    emit('connected')
    expect(client.getQueryState(feedQueryKey('s', 'timeline|home'))?.isInvalidated).toBe(true)
    off()
  })

  it('never fills the fresh-mount connecting -> connected', () => {
    const client = new QueryClient()
    client.setQueryData(feedQueryKey('s', 'timeline|home'), pagesOf([['p1'], ['p2']]))
    const {handle, emit} = statusHandle('connecting')
    const off = watchStreamGapFill({client, sessionId: 's', handle})
    emit('connected')
    const feed = client.getQueryData<{pages: unknown[]}>(feedQueryKey('s', 'timeline|home'))!
    expect(feed.pages).toHaveLength(2)
    expect(client.getQueryState(feedQueryKey('s', 'timeline|home'))?.isInvalidated).not.toBe(
      true,
    )
    off()
  })

  it('ignores every other transition', () => {
    for (const [from, to] of [
      ['connected', 'connected'],
      ['error', 'connected'],
      ['connecting', 'connected'],
      ['reconnecting', 'error'],
      ['reconnecting', 'stopped'],
    ] as Array<[StreamState, StreamState]>) {
      const client = new QueryClient()
      client.setQueryData(feedQueryKey('s', 'timeline|home'), pagesOf([['p1'], ['p2']]))
      const {handle, emit} = statusHandle(from)
      const off = watchStreamGapFill({client, sessionId: 's', handle})
      emit(to)
      const feed = client.getQueryData<{pages: unknown[]}>(feedQueryKey('s', 'timeline|home'))!
      expect(feed.pages).toHaveLength(2)
      expect(client.getQueryState(feedQueryKey('s', 'timeline|home'))?.isInvalidated).not.toBe(
        true,
      )
      off()
    }
  })

  it('unsubscribes on teardown and tolerates a null handle', () => {
    const client = new QueryClient()
    client.setQueryData(feedQueryKey('s', 'timeline|home'), pagesOf([['p1'], ['p2']]))
    const {handle, emit} = statusHandle('reconnecting')
    const off = watchStreamGapFill({client, sessionId: 's', handle})
    off()
    emit('connected')
    const feed = client.getQueryData<{pages: unknown[]}>(feedQueryKey('s', 'timeline|home'))!
    expect(feed.pages).toHaveLength(2)
    expect(() => watchStreamGapFill({client, sessionId: 's', handle: null})()).not.toThrow()
  })
})

describe('createPostUpdateCoalescer', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  function setup() {
    const resolvers: Array<(post: Post) => void> = []
    const rejecters: Array<(err: unknown) => void> = []
    const applied: Post[] = []
    let fetches = 0
    const coalescer = createPostUpdateCoalescer({
      fetchPost: (_id: string) =>
        new Promise<Post>((resolve, reject) => {
          fetches += 1
          resolvers.push(resolve)
          rejecters.push(reject)
        }),
      onPost: post => {
        applied.push(post)
      },
    })
    return {coalescer, resolvers, rejecters, applied, fetches: () => fetches}
  }

  function event(id: string): PostUpdateEvent {
    return {id, type: 'reacted', reaction: 'heart'}
  }

  it('a 20-event burst costs one request and applies the last state', async () => {
    const {coalescer, resolvers, applied, fetches} = setup()
    for (let i = 0; i < 20; i++) coalescer.notify(event('p1'))
    expect(fetches()).toBe(0)
    await jest.advanceTimersByTimeAsync(POST_UPDATE_DEBOUNCE_MS)
    expect(fetches()).toBe(1)
    resolvers[0](fakePost('v20'))
    await jest.advanceTimersByTimeAsync(0)
    expect(applied.map(p => p.id)).toEqual(['v20'])
    coalescer.dispose()
  })

  it('a wave landing mid-flight costs one follow-up; the stale response is skipped', async () => {
    const {coalescer, resolvers, applied, fetches} = setup()
    coalescer.notify(event('p1'))
    await jest.advanceTimersByTimeAsync(POST_UPDATE_DEBOUNCE_MS)
    expect(fetches()).toBe(1)
    // Second wave lands while the first fetch is in flight.
    coalescer.notify(event('p1'))
    resolvers[0](fakePost('v1-stale'))
    await jest.advanceTimersByTimeAsync(0)
    expect(applied).toHaveLength(0)
    await jest.advanceTimersByTimeAsync(POST_UPDATE_DEBOUNCE_MS)
    expect(fetches()).toBe(2)
    resolvers[1](fakePost('v2-final'))
    await jest.advanceTimersByTimeAsync(0)
    expect(applied.map(p => p.id)).toEqual(['v2-final'])
    coalescer.dispose()
  })

  it('a failed refetch keeps the row and the coalescer stays usable', async () => {
    const {coalescer, resolvers, rejecters, applied, fetches} = setup()
    coalescer.notify(event('p1'))
    await jest.advanceTimersByTimeAsync(POST_UPDATE_DEBOUNCE_MS)
    expect(fetches()).toBe(1)
    rejecters[0](new Error('network down'))
    await jest.advanceTimersByTimeAsync(0)
    expect(applied).toHaveLength(0)
    coalescer.notify(event('p1'))
    await jest.advanceTimersByTimeAsync(POST_UPDATE_DEBOUNCE_MS)
    expect(fetches()).toBe(2)
    resolvers[1](fakePost('recovered'))
    await jest.advanceTimersByTimeAsync(0)
    expect(applied.map(p => p.id)).toEqual(['recovered'])
    coalescer.dispose()
  })

  it('coalesces per post id and ignores empty ids', async () => {
    const {coalescer, applied, fetches} = setup()
    coalescer.notify(event('p1'))
    coalescer.notify(event('p2'))
    coalescer.notify({id: '', type: 'reacted'})
    await jest.advanceTimersByTimeAsync(POST_UPDATE_DEBOUNCE_MS)
    expect(fetches()).toBe(2)
    expect(applied).toHaveLength(0)
    coalescer.dispose()
  })

  it('dispose drops pending timers and ignores late responses', async () => {
    const pending = setup()
    pending.coalescer.notify(event('p1'))
    pending.coalescer.dispose()
    await jest.advanceTimersByTimeAsync(POST_UPDATE_DEBOUNCE_MS * 4)
    expect(pending.fetches()).toBe(0)
    // A fetch already in flight when disposed resolves into the void.
    const inflight = setup()
    inflight.coalescer.notify(event('p9'))
    await jest.advanceTimersByTimeAsync(POST_UPDATE_DEBOUNCE_MS)
    expect(inflight.fetches()).toBe(1)
    inflight.coalescer.dispose()
    inflight.resolvers[0](fakePost('late'))
    await jest.advanceTimersByTimeAsync(0)
    expect(inflight.applied).toHaveLength(0)
  })
})
