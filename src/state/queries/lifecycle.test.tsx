// Repair X3.2: online + foreground awareness (networking M3).
//
// Drives the managers through fake AppState/network sources: offline pauses
// (manager reports offline), foreground refetches ONLY feed / notifications
// / me with a 60 s per-query gap, and the Provider wiring degrades to a
// no-op where the native module is missing (never a boot crash).

import {createMemoryStore} from '@keystone/fedi'
import {QueryClient, QueryClientProvider, focusManager, onlineManager, useQuery} from '@tanstack/react-query'
import {render, renderHook, waitFor} from '@testing-library/react-native'

import {
  FOREGROUND_REFETCH_MIN_GAP_MS,
  isForegroundRefetchKey,
  refetchForegroundQueries,
  setupFocusManager,
  setupOnlineManager,
  setupQueryLifecycle,
  type FocusSource,
} from './lifecycle'
import {QueryProvider, createQueryPersister} from './Provider'

function testClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

function wrapper(client: QueryClient) {
  return ({children}: {children: React.ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

interface ProbeArgs {
  key: readonly unknown[]
  slot: string
  calls: Record<string, number>
}

function useProbeQuery({key, slot, calls}: ProbeArgs) {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      calls[slot] = (calls[slot] ?? 0) + 1
      return slot
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

function fakeFocusSource(initial = true) {
  let setFocused: ((focused: boolean) => void) | null = null
  const source: FocusSource = {
    subscribe(fn) {
      setFocused = fn
      fn(initial)
      return () => {
        setFocused = null
      }
    },
  }
  return {
    source,
    fire(focused: boolean) {
      setFocused?.(focused)
    },
  }
}

function fakeOnlineSource() {
  let setOnline: ((online: boolean) => void) | null = null
  return {
    source: {
      subscribe(fn: (online: boolean) => void) {
        setOnline = fn
        fn(true)
        return () => {
          setOnline = null
        }
      },
    },
    fire(online: boolean) {
      setOnline?.(online)
    },
  }
}

afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

describe('isForegroundRefetchKey', () => {
  it('matches feed, notifications, and me keys only', () => {
    expect(isForegroundRefetchKey(['s1', 'post-feed', 'timeline|home'])).toBe(true)
    expect(isForegroundRefetchKey(['s1', 'notifications', 'all|grouped:1'])).toBe(true)
    expect(isForegroundRefetchKey(['s1', 'me'])).toBe(true)
    expect(isForegroundRefetchKey(['s1', 'server-filters'])).toBe(false)
    expect(isForegroundRefetchKey(['s1', 'conversation', 'c1'])).toBe(false)
    expect(isForegroundRefetchKey(['s1', 'post', 'p1'])).toBe(false)
    expect(isForegroundRefetchKey(['signed-out', 'me'])).toBe(true)
  })

  it('rejects malformed keys', () => {
    expect(isForegroundRefetchKey(null)).toBe(false)
    expect(isForegroundRefetchKey('s1')).toBe(false)
    expect(isForegroundRefetchKey([])).toBe(false)
    expect(isForegroundRefetchKey(['s1'])).toBe(false)
    expect(isForegroundRefetchKey(['s1', 42])).toBe(false)
  })
})

describe('foreground refetch (60 s per-query gap)', () => {
  it('refetches feed/notifications/me on focus gain, skips everything else', async () => {
    const client = testClient()
    let now = 1_000_000
    const calls: Record<string, number> = {}
    const argsFor = (key: readonly unknown[], slot: string): ProbeArgs => ({key, slot, calls})
    renderHook((args: ProbeArgs) => useProbeQuery(args), {
      initialProps: argsFor(['s1', 'post-feed', 'timeline|home'], 'feed'),
      wrapper: wrapper(client),
    })
    renderHook((args: ProbeArgs) => useProbeQuery(args), {
      initialProps: argsFor(['s1', 'notifications', 'all|grouped:1'], 'notif'),
      wrapper: wrapper(client),
    })
    renderHook((args: ProbeArgs) => useProbeQuery(args), {
      initialProps: argsFor(['s1', 'me'], 'me'),
      wrapper: wrapper(client),
    })
    renderHook((args: ProbeArgs) => useProbeQuery(args), {
      initialProps: argsFor(['s1', 'server-filters'], 'other'),
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(calls).toEqual({feed: 1, notif: 1, me: 1, other: 1}))
    // eslint-disable-next-line no-console
    console.log('LIFECYCLE-MARK initial-fetch-ok')

    const fake = fakeFocusSource(true)
    const off = setupFocusManager(client, fake.source, () => now)
    // The source's initial push only starts budgets — mounts fetched already.
    expect(calls).toEqual({feed: 1, notif: 1, me: 1, other: 1})
    // eslint-disable-next-line no-console
    console.log('LIFECYCLE-MARK manager-wired')

    // First focus gain after the gap: eligible queries refetch, others not.
    now += FOREGROUND_REFETCH_MIN_GAP_MS
    fake.fire(false)
    fake.fire(true)
    // eslint-disable-next-line no-console
    console.log('LIFECYCLE-MARK fired-wait-feed')
    await waitFor(() => expect(calls.feed).toBe(2))
    await waitFor(() => expect(calls.notif).toBe(2))
    await waitFor(() => expect(calls.me).toBe(2))
    expect(calls.other).toBe(1)

    // A second gain inside the gap refetches nothing.
    fake.fire(false)
    fake.fire(true)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(calls).toEqual({feed: 2, notif: 2, me: 2, other: 1})

    // After the gap elapses, the next gain refetches again.
    now += FOREGROUND_REFETCH_MIN_GAP_MS
    fake.fire(false)
    fake.fire(true)
    await waitFor(() => expect(calls.feed).toBe(3))
    expect(calls.other).toBe(1)
    off()
  })

  it('refetchForegroundQueries budgets per query key and reports refetched keys', async () => {
    const client = testClient()
    renderHook((args: ProbeArgs) => useProbeQuery(args), {
      initialProps: {key: ['s1', 'post-feed', 'timeline|home'], slot: 'a', calls: {}},
      wrapper: wrapper(client),
    })
    renderHook((args: ProbeArgs) => useProbeQuery(args), {
      initialProps: {key: ['s1', 'post-feed', 'timeline|local'], slot: 'b', calls: {}},
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(client.getQueryCache().findAll({type: 'active'})).toHaveLength(2))

    const lastRefetch = new Map<string, number>()
    // First pass discovers and budgets, refetches nothing.
    expect(refetchForegroundQueries(client, {now: 0, lastRefetch})).toEqual([])
    // Inside the gap: nothing.
    expect(refetchForegroundQueries(client, {now: 1_000, lastRefetch})).toEqual([])
    // After the gap: both feeds refetch.
    const refetched = refetchForegroundQueries(client, {
      now: FOREGROUND_REFETCH_MIN_GAP_MS,
      lastRefetch,
    })
    expect(refetched).toHaveLength(2)
  })

  it('skips the foreground pass while offline (budget untouched)', async () => {
    const client = testClient()
    const calls: Record<string, number> = {}
    renderHook((args: ProbeArgs) => useProbeQuery(args), {
      initialProps: {key: ['s1', 'post-feed', 'timeline|home'], slot: 'feed', calls},
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(calls.feed).toBe(1))
    const lastRefetch = new Map<string, number>()
    expect(refetchForegroundQueries(client, {now: 0, lastRefetch})).toEqual([])
    onlineManager.setOnline(false)
    try {
      expect(
        refetchForegroundQueries(client, {now: FOREGROUND_REFETCH_MIN_GAP_MS, lastRefetch}),
      ).toEqual([])
      expect(calls.feed).toBe(1)
    } finally {
      onlineManager.setOnline(true)
    }
    // The offline pass never consumed the budget: back online, it refetches.
    expect(
      refetchForegroundQueries(client, {now: FOREGROUND_REFETCH_MIN_GAP_MS, lastRefetch}),
    ).toHaveLength(1)
  })
})

describe('online manager wiring', () => {
  it('routes the platform source into onlineManager', () => {
    expect(onlineManager.isOnline()).toBe(true)
    const fake = fakeOnlineSource()
    const off = setupOnlineManager(fake.source)
    fake.fire(false)
    expect(onlineManager.isOnline()).toBe(false)
    fake.fire(true)
    expect(onlineManager.isOnline()).toBe(true)
    off()
  })

  it('a throwing source never breaks setup', () => {
    expect(() =>
      setupOnlineManager({
        subscribe: () => {
          throw new Error('no native module')
        },
      }),
    ).not.toThrow()
  })

  it('a throwing focus source never breaks setup or focus handling', () => {
    const client = testClient()
    const off = setupFocusManager(client, {
      subscribe: () => {
        throw new Error('no AppState')
      },
    })
    expect(typeof off).toBe('function')
    off()
  })
})

describe('setupQueryLifecycle', () => {
  it('wires both managers and returns a combined cleanup', () => {
    const client = testClient()
    const online = fakeOnlineSource()
    const focus = fakeFocusSource(true)
    const off = setupQueryLifecycle(client, {
      onlineSource: online.source,
      focusSource: focus.source,
      now: () => 0,
    })
    expect(typeof off).toBe('function')
    online.fire(false)
    expect(onlineManager.isOnline()).toBe(false)
    online.fire(true)
    // Replacing the wiring (a second Provider mount) never throws.
    const again = setupQueryLifecycle(client, {
      onlineSource: online.source,
      focusSource: focus.source,
      now: () => 0,
    })
    expect(typeof again).toBe('function')
    off()
    again()
  })

  it('QueryProvider mounts and unmounts with the default sources (no native modules)', () => {
    const client = testClient()
    const tree = render(
      <QueryProvider client={client} persister={createQueryPersister(createMemoryStore())}>
        <></>
      </QueryProvider>,
    )
    tree.unmount()
  })
})
