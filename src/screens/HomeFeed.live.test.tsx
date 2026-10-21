// FeedView live mount (WS-G S4) + scroll-memory entries (N14): live
// arrivals feed the pill, deletes/updates reconcile without a reload,
// the stream badge shows connection state, and back-navigation restores
// position + cached entries.
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, renderHook, screen, waitFor} from '@testing-library/react-native'
import {FlatList} from 'react-native'

import {createMemoryStore, type Backend, type Notification, type Post, type PostUpdateEvent, type StreamHandle, type StreamState} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {useLiveNotifications} from '#/state/streaming'
import {notificationsQueryKey} from '#/state/queries/keys'
import {notificationsFilterKey} from '#/state/queries/notifications'

import {makePost} from '#/components/__tests__/fixtures'

import {FeedView} from './HomeFeed'

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {queries: {staleTime: 30_000, retry: false, gcTime: 60_000}},
  })
}

function renderWithProviders(
  ui: React.ReactElement,
  store: ReturnType<typeof createSessionStore>,
  client: QueryClient = testClient(),
) {
  i18n.load('en', {})
  i18n.activate('en')
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={client}>
          <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
            {ui}
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

async function signedIn() {
  const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: HOME_ORIGIN})
  const added = await store.add({
    origin: 'https://a.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-a',
    grant: 'password',
    hosting: 'third-party',
  })
  return {store, sessionId: added.id}
}

interface LiveHarness {
  handle: StreamHandle
  emitPost: (post: Post) => void
  emitNotification: (n: Notification) => void
  emitState: (s: StreamState) => void
  postSubs: Map<string, {onUpdated?: (e: PostUpdateEvent) => void; onDeleted?: () => void}>
  subscribes: () => number
}

function makeLiveHandle(initial: StreamState = 'connected'): LiveHarness {
  let postCb: ((post: Post) => void) | null = null
  let notifCb: ((n: Notification) => void) | null = null
  const postSubs = new Map<string, {onUpdated?: (e: PostUpdateEvent) => void; onDeleted?: () => void}>()
  let state = initial
  const listeners = new Set<(s: StreamState) => void>()
  let subscribes = 0
  const handle: StreamHandle = {
    subscribeTimeline: (_source, onPost) => {
      subscribes += 1
      postCb = onPost
      return {unsubscribe: () => { postCb = null }, status: () => 'subscribed'}
    },
    subscribePost: (id, h) => {
      postSubs.set(id, h)
      return () => { postSubs.delete(id) }
    },
    onNotification: handler => {
      notifCb = handler
      return () => { notifCb = null }
    },
    status: () => state,
    onStatusChange: handler => {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    },
  }
  return {
    handle,
    emitPost: post => postCb?.(post),
    emitNotification: n => notifCb?.(n),
    emitState: s => {
      state = s
      for (const fn of [...listeners]) fn(s)
    },
    postSubs,
    subscribes: () => subscribes,
  }
}

function livePost(id: string, text: string): Post {
  return makePost({id, content: {mfm: text, plain: text}})
}

function liveBackend(
  harness: LiveHarness,
  over: {timeline?: jest.Mock; post?: jest.Mock; capabilities?: unknown; stream?: (() => StreamHandle | null) | null} = {},
) {
  const timeline =
    over.timeline ?? jest.fn(async () => ({items: [livePost('p1', 'first post')], cursor: null, end: true}))
  const post = over.post ?? jest.fn(async (id: string) => livePost(id, `fresh ${id}`))
  const backend = {
    timeline,
    post,
    capabilities: over.capabilities ?? {streaming: 'supported'},
  } as unknown as Backend & {timeline: jest.Mock; post: jest.Mock}
  if (over.stream !== null) {
    ;(backend as unknown as {stream: () => StreamHandle | null}).stream = over.stream ?? (() => harness.handle)
  }
  return backend
}

function scrollEvent(y: number, contentHeight = 5000, viewHeight = 800) {
  return {
    nativeEvent: {
      contentOffset: {x: 0, y},
      contentSize: {width: 390, height: contentHeight},
      layoutMeasurement: {width: 390, height: viewHeight},
    },
  }
}

describe('FeedView live insert + pill (WS-G S4)', () => {
  it('buffers arrivals behind the pill and inserts on tap with no duplicates', async () => {
    const {store, sessionId} = await signedIn()
    const harness = makeLiveHandle()
    const backend = liveBackend(harness)
    renderWithProviders(
      <FeedView sessionId={sessionId} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
      store,
    )
    expect(await screen.findByText('first post')).toBeTruthy()
    expect(screen.getByTestId('stream-status')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.queryByTestId('new-posts-pill')).toBeNull()

    await act(async () => { harness.emitPost(livePost('p2', 'live post')) })
    expect(await screen.findByTestId('new-posts-pill')).toBeTruthy()
    // A streamed race with the cached page never double-inserts.
    await act(async () => { harness.emitPost(livePost('p1', 'first post')) })
    expect(screen.getByText('1 new posts')).toBeTruthy()

    fireEvent.press(screen.getByTestId('new-posts-pill'))
    expect(await screen.findByText('live post')).toBeTruthy()
    expect(screen.queryByTestId('new-posts-pill')).toBeNull()
    expect(backend.timeline).toHaveBeenCalledTimes(1)
  })

  it('deletes captured live remove the row without a reload', async () => {
    const {store, sessionId} = await signedIn()
    const harness = makeLiveHandle()
    const timeline = jest.fn(async () => ({
      items: [livePost('p1', 'post one'), livePost('p2', 'post two')],
      cursor: null,
      end: true,
    }))
    const backend = liveBackend(harness, {timeline})
    renderWithProviders(
      <FeedView sessionId={sessionId} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
      store,
    )
    expect(await screen.findByText('post one')).toBeTruthy()
    await waitFor(() => expect(harness.postSubs.has('p1')).toBe(true))

    await act(async () => { harness.postSubs.get('p1')?.onDeleted?.() })
    await waitFor(() => expect(screen.queryByText('post one')).toBeNull())
    expect(screen.getByText('post two')).toBeTruthy()
    expect(timeline).toHaveBeenCalledTimes(1)
  })

  it('updates captured live refetch the post; a failed refetch keeps the row', async () => {
    const {store, sessionId} = await signedIn()
    const harness = makeLiveHandle()
    const post = jest.fn(async (id: string) => livePost(id, `fresh ${id}`))
    const backend = liveBackend(harness, {
      timeline: jest.fn(async () => ({items: [livePost('p1', 'stale post')], cursor: null, end: true})),
      post,
    })
    renderWithProviders(
      <FeedView sessionId={sessionId} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
      store,
    )
    expect(await screen.findByText('stale post')).toBeTruthy()
    await waitFor(() => expect(harness.postSubs.has('p1')).toBe(true))

    await act(async () => { harness.postSubs.get('p1')?.onUpdated?.({id: 'p1', type: 'reacted'}) })
    expect(await screen.findByText('fresh p1')).toBeTruthy()
    expect(post).toHaveBeenCalledWith('p1')

    post.mockRejectedValueOnce(new Error('flaky'))
    await act(async () => { harness.postSubs.get('p1')?.onUpdated?.({id: 'p1', type: 'pollVoted'}) })
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(screen.getByText('fresh p1')).toBeTruthy()
  })

  it('a delete racing a buffered arrival never re-inserts the removed post', async () => {
    const {store, sessionId} = await signedIn()
    const harness = makeLiveHandle()
    const backend = liveBackend(harness)
    renderWithProviders(
      <FeedView sessionId={sessionId} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
      store,
    )
    expect(await screen.findByText('first post')).toBeTruthy()

    await act(async () => { harness.emitPost(livePost('p2', 'doomed post')) })
    expect(await screen.findByTestId('new-posts-pill')).toBeTruthy()
    await waitFor(() => expect(harness.postSubs.has('p2')).toBe(true))
    await act(async () => { harness.postSubs.get('p2')?.onDeleted?.() })
    fireEvent.press(screen.getByTestId('new-posts-pill'))
    await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).toBeNull())
    expect(screen.queryByText('doomed post')).toBeNull()
  })
})

describe('FeedView stream badge (WS-G S4)', () => {
  it('shows connected/reconnecting and retries on error (no unread count)', async () => {
    const {store, sessionId} = await signedIn()
    const harness = makeLiveHandle()
    const backend = liveBackend(harness)
    renderWithProviders(
      <FeedView sessionId={sessionId} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
      store,
    )
    expect(await screen.findByText('first post')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()

    await act(async () => { harness.emitState('reconnecting') })
    expect(screen.getByText('Reconnecting…')).toBeTruthy()

    await act(async () => { harness.emitState('error') })
    expect(screen.getByText('Live updates unavailable')).toBeTruthy()
    const subscribes = harness.subscribes()
    fireEvent.press(screen.getByTestId('stream-retry'))
    await waitFor(() => expect(harness.subscribes()).toBeGreaterThan(subscribes))
    // The new live reads the handle state; the badge recovers when the
    // socket does.
    await act(async () => { harness.emitState('connected') })
    expect(screen.getByText('Live')).toBeTruthy()

    // The second badge rule: connection state only, never a count — and
    // the W4 unread badge stays out of the feed.
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
  })

  it('hides the badge on paging-only feeds and keeps the local-diff pill', async () => {
    const {store, sessionId} = await signedIn()
    const timeline = jest.fn(async () => ({items: [livePost('p1', 'old post')], cursor: null, end: true}))
    const backend = liveBackend(makeLiveHandle(), {
      timeline,
      capabilities: {streaming: 'unsupported'},
      stream: null,
    })
    renderWithProviders(
      <FeedView sessionId={sessionId} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
      store,
    )
    expect(await screen.findByText('old post')).toBeTruthy()
    expect(screen.queryByTestId('stream-status')).toBeNull()

    timeline.mockResolvedValue({items: [livePost('p2', 'new post'), livePost('p1', 'old post')], cursor: null, end: true})
    const list = screen.getByTestId('feed-list')
    const control = (list.props as {refreshControl?: {props: {onRefresh: () => void}}}).refreshControl
    control?.props.onRefresh()
    expect(await screen.findByTestId('new-posts-pill')).toBeTruthy()
  })

  it('stands down on per-family channel gaps instead of a stuck badge', async () => {
    const {store, sessionId} = await signedIn()
    const gapHandle: StreamHandle = {
      ...makeLiveHandle().handle,
      subscribeTimeline: () => ({unsubscribe: () => undefined, status: () => 'disabled'}),
    }
    const backend = liveBackend(makeLiveHandle(), {
      stream: () => gapHandle,
    })
    renderWithProviders(
      <FeedView sessionId={sessionId} descriptor="timeline|social" backend={backend} retry={false} testID="feed" />,
      store,
    )
    expect(await screen.findByText('first post')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('stream-status')).toBeNull())
  })
})

describe('FeedView scroll memory + entries (WS-G N14)', () => {
  it('back restores the offset and serves entries from the cache', async () => {
    const {store, sessionId} = await signedIn()
    const harness = makeLiveHandle()
    const backend = liveBackend(harness, {
      timeline: jest.fn(async () => ({items: [livePost('p1', 'cached post')], cursor: null, end: true})),
    })
    const client = testClient()
    const spy = jest.spyOn(FlatList.prototype, 'scrollToOffset')
    try {
      const first = renderWithProviders(
        <FeedView sessionId={sessionId} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
        store,
        client,
      )
      expect(await screen.findByText('cached post')).toBeTruthy()
      const list = screen.getByTestId('feed-list')
      fireEvent.scroll(list, scrollEvent(420))
      first.unmount()

      spy.mockClear()
      renderWithProviders(
        <FeedView sessionId={sessionId} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
        store,
        client,
      )
      expect(await screen.findByText('cached post')).toBeTruthy()
      await waitFor(() => expect(spy).toHaveBeenCalledWith({offset: 420, animated: false}))
      // Entries came from the persisted query cache — no refetch.
      expect(backend.timeline).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('a descriptor switch with no saved offset resets to the top', async () => {
    const {store, sessionId} = await signedIn()
    const harness = makeLiveHandle()
    const backend = liveBackend(harness)
    const client = testClient()
    const spy = jest.spyOn(FlatList.prototype, 'scrollToOffset')
    try {
      const rendered = renderWithProviders(
        <FeedView sessionId={sessionId} descriptor="timeline|home" backend={backend} retry={false} testID="feed" />,
        store,
        client,
      )
      expect(await screen.findByText('first post')).toBeTruthy()
      fireEvent.scroll(screen.getByTestId('feed-list'), scrollEvent(420))

      spy.mockClear()
      rendered.rerender(
        <I18nProvider i18n={i18n}>
          <ThemeProvider theme="light">
            <QueryClientProvider client={client}>
              <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
                <FeedView sessionId={sessionId} descriptor="timeline|local" backend={backend} retry={false} testID="feed" />
              </SessionProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </I18nProvider>,
      )
      expect(await screen.findByText('first post')).toBeTruthy()
      await waitFor(() => expect(spy).toHaveBeenCalledWith({offset: 0, animated: false}))
    } finally {
      spy.mockRestore()
    }
  })
})

describe('useLiveNotifications (WS-G S4)', () => {
  function hookWrapper(client: QueryClient) {
    return ({children}: {children: React.ReactNode}) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
  }

  it('ingests arrivals into the `all` listing so the badge updates without reload', async () => {
    const client = testClient()
    const key = notificationsQueryKey('s', notificationsFilterKey('all', true))
    client.setQueryData(key, {
      pages: [{items: [{id: 'n1', read: false} as unknown as Notification], cursor: null, end: true}],
      pageParams: [null],
    })
    const harness = makeLiveHandle()
    const backend = liveBackend(harness)
    renderHook(() => useLiveNotifications('s', backend), {wrapper: hookWrapper(client)})
    await act(async () => {
      harness.emitNotification({id: 'n2', read: false} as unknown as Notification)
    })
    const data = client.getQueryData<{pages: Array<{items: Notification[]}>}>(key)!
    expect(data.pages[0].items.map(n => n.id)).toEqual(['n2', 'n1'])
  })

  it('stays inert without a handle (paging-only)', async () => {
    const client = testClient()
    const backend = liveBackend(makeLiveHandle(), {capabilities: {streaming: 'unsupported'}, stream: null})
    renderHook(() => useLiveNotifications('s', backend), {wrapper: hookWrapper(client)})
    expect(client.getQueriesData({queryKey: ['s', 'notifications']})).toHaveLength(0)
  })
})
