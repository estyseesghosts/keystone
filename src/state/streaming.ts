import {useCallback, useEffect, useRef, useState} from 'react'
import {useQueryClient, type InfiniteData, type QueryClient} from '@tanstack/react-query'

import {
  NOTIFICATION_FILTER_PRESETS,
  parseFeedDescriptor,
  type Backend,
  type FeedChannelState,
  type FeedSource,
  type Notification,
  type Page,
  type PostUpdateEvent,
  type StreamHandle,
  type StreamState,
} from '@keystone/fedi'
import type {Post} from '@keystone/fedi'

import {patchPostInCaches} from '#/state/cache'
import {feedQueryKey} from '#/state/queries/keys'

// Live-update glue (slice 3.10) between the ported stream handles
// (`packages/fedi` 2.2 Misskey pool / 2.3 Mastodon socket — reused, not
// rewritten) and the feed caches (3.2 query layer, which owns insertion).
//
// Discipline:
// - Arrivals NEVER jump scroll: they buffer as pending behind the
//   new-posts pill; only an explicit `flush()` (pill tap) delivers them.
// - Dedupe by id on insert: a streamed note racing a pending API page
//   can never double-insert (same one-line rule as the pool header).
// - Reconnect with backoff lives inside the ported handles (Misskey pool:
//   1s doubling to 30s + jitter; Mastodon: 2s^n to 30s). This layer only
//   surfaces `status()` + `onStatusChange()` for badges/pills and offers
//   `resubscribe()` as the manual retry. No extra timers here.
// - Multi-account isolation: every live entry is keyed by sessionId (see
//   `feedSourceKey` + `createLiveRegistry`). Switching accounts never
//   shows the previous account's live posts.

/** Stable string for a feed source, for query-key scoping + registries. */
export function feedSourceKey(source: FeedSource): string {
  if ('kind' in source) return `timeline|${source.kind}`
  if ('antennaId' in source) return `antenna|${source.antennaId}`
  if ('listId' in source) return `list|${source.listId}`
  if ('tag' in source) return `tag|${source.tag}`
  return `clip|${source.clipId}`
}

/** Registry key combining account + feed (both required). */
export function liveKey(sessionId: string, source: FeedSource): string {
  return `${sessionId}|${feedSourceKey(source)}`
}

export interface FeedLiveOpts {
  /** The session's stream handle (`backend.stream()`); null = unsupported. */
  handle: StreamHandle | null
  source: FeedSource
  /** Posts already in the cache (dedupe seed). The cache stays the owner. */
  knownIds?: Iterable<string>
  /** Called ONLY from `flush()` (pill tap) with the buffered batch. */
  onInsert: (posts: Post[]) => void
  /** A watched post was deleted (both families capture watched ids —
   * Misskey broadcast, Mastodon `user` stream filtered by id; see the
   * `createFeedLive` note on the feed-level seam). */
  onDelete?: (id: string) => void
  /** A watched post changed (reaction/reply/renote/poll deltas). */
  onUpdate?: (event: PostUpdateEvent) => void
  /** Called whenever an arrival is buffered (drives the pill; no polling). */
  onPending?: () => void
}

export interface FeedLive {
  /** Pending buffered posts (oldest-first). */
  pending(): Post[]
  pendingCount(): number
  /** Deliver the buffer to `onInsert` and clear it (pill tap). */
  flush(): Post[]
  /** Discard the buffer without delivering. */
  clear(): void
  /** Watch one more post id for delete/update capture (idempotent). */
  watch(id: string): void
  status(): StreamState
  /** The timeline channel's own state (badges distinguish "no channel"
   * from "channel pending"). */
  channelStatus(): FeedChannelState
  onStatusChange(handler: (state: StreamState) => void): () => void
  /** Drop the subscription (unmount / account switch). */
  dispose(): void
}

/**
 * Follow one feed's live channel. When the backend has no streaming
 * (`handle` null or the source unsupported), the returned live is
 * `unavailable` and feeds keep paging + manual refresh — never an error.
 *
 * Delete/update capture (MD10 app half, WS-G mount): every watched post
 * id gets a per-post `subscribePost` capture forwarding to
 * `onDelete`/`onUpdate` (buffered arrivals are watched on insert;
 * `knownIds` seeds the cache baseline, `watch()` adds more later). Both
 * families implement `subscribePost` over their shared channel (Misskey
 * broadcast captures, Mastodon `user` stream filtered by id), so
 * watched-id deletes/updates reach the callbacks on either family.
 *
 * Feed-level seam (by design, not a gap): the `StreamHandle` interface
 * carries no feed-level delete channel — `subscribeTimeline` delivers
 * inserts only. A post with no watched id has no cached row to remove
 * (and `onInsert` dedupes against the cache), so the next page fetch
 * drops it. No pill UI here: arrivals still buffer behind
 * `pending()`/`flush()`.
 */
export function createFeedLive(opts: FeedLiveOpts): FeedLive {
  const {handle, source, onInsert, onDelete, onUpdate, onPending} = opts
  const seen = new Set<string>(opts.knownIds ?? [])
  let buffer: Post[] = []
  let subscription: {unsubscribe(): void; status(): FeedChannelState} | null = null
  const postUnsubs = new Map<string, () => void>()

  /** Watch one post id for delete/update events (best-effort: capture is
   * never on any load path — paging + refresh stay the source of truth). */
  function watchPost(id: string): void {
    if (!handle || !id || postUnsubs.has(id)) return
    if (!onDelete && !onUpdate) return
    try {
      const off = handle.subscribePost(id, {
        onUpdated: event => onUpdate?.(event),
        onDeleted: () => {
          postUnsubs.delete(id)
          onDelete?.(id)
        },
      })
      postUnsubs.set(id, off)
    } catch {
      // A capture that throws at subscribe time is dropped, never fatal.
    }
  }

  function unwatchAll(): void {
    for (const off of postUnsubs.values()) {
      try {
        off()
      } catch {
        // Ignore — dispose is best-effort.
      }
    }
    postUnsubs.clear()
  }

  // Seed the cache baseline so already-loaded posts report deletes/updates.
  for (const id of seen) watchPost(id)

  if (handle) {
    subscription = handle.subscribeTimeline(source, post => {
      if (seen.has(post.id)) return
      seen.add(post.id)
      watchPost(post.id)
      buffer = [...buffer, post]
      try {
        onPending?.()
      } catch {
        // A pending listener must never break dispatch.
      }
    })
  }

  return {
    pending: () => buffer,
    pendingCount: () => buffer.length,

    flush(): Post[] {
      if (buffer.length === 0) return []
      const batch = buffer
      buffer = []
      onInsert(batch)
      return batch
    },

    clear(): void {
      buffer = []
    },

    watch(id: string): void {
      // Marking known cache ids also keeps arrival-dedupe exact: a
      // streamed post that raced a page fetch is dropped at arrival, not
      // just at flush — the pill never counts rows already in the list.
      if (!id) return
      seen.add(id)
      watchPost(id)
    },

    status(): StreamState {
      if (!handle || !subscription) return 'unavailable'
      return handle.status()
    },

    channelStatus(): FeedChannelState {
      if (!handle || !subscription) return 'unavailable'
      return subscription.status()
    },

    onStatusChange(handler: (state: StreamState) => void): () => void {
      if (!handle) {
        return () => undefined
      }
      return handle.onStatusChange(handler)
    },

    dispose(): void {
      subscription?.unsubscribe()
      subscription = null
      unwatchAll()
      buffer = []
    },
  }
}

export interface PostLiveHandlers {
  onUpdated?: (event: PostUpdateEvent) => void
  onDeleted?: () => void
}

/** Follow one post's live updates (detail screen). No-op when unsupported. */
export function createPostLive(
  handle: StreamHandle | null,
  id: string,
  handlers: PostLiveHandlers,
): () => void {
  if (!handle) return () => undefined
  return handle.subscribePost(id, handlers)
}

/**
 * Per-account live registry. One `FeedLive` per `(sessionId, source)`;
 * entries dispose on `release()`. Guards the multi-account rule: live
 * posts for session A are unreachable from session B's key.
 */
export function createLiveRegistry() {
  const entries = new Map<string, FeedLive>()

  return {
    acquire(key: string, create: () => FeedLive): FeedLive {
      const existing = entries.get(key)
      if (existing) return existing
      const live = create()
      entries.set(key, live)
      return live
    },
    get(key: string): FeedLive | undefined {
      return entries.get(key)
    },
    release(key: string): void {
      const live = entries.get(key)
      if (live) {
        live.dispose()
        entries.delete(key)
      }
    },
    clear(): void {
      for (const live of entries.values()) live.dispose()
      entries.clear()
    },
    size(): number {
      return entries.size
    },
  }
}

export type LiveRegistry = ReturnType<typeof createLiveRegistry>

// --- Descriptor → live channel (WS-G mount) ---------------------------------

/**
 * Live-channel source for a feed descriptor, or null when the feed has no
 * live channel on any family. Timelines/lists/antennas/tags map 1:1 onto
 * `FeedSource`; clips/user tabs/search/explore/bookmarks/mentions/channels
 * have no channel anywhere (v1 parity: `TimelineFeed.hasChannel` plus the
 * clip exclusion — those feeds page + refresh only, never an error, never
 * a faked socket). Per-family gaps inside a mapped source (Mastodon
 * `social`, unauthenticated auth channels) are answered by the handle as
 * a disabled subscription — the mount reads `channelStatus()` and stands
 * down rather than showing a stuck "connecting" badge.
 *
 * Unparsable descriptors also answer null (the query layer throws on those
 * before any live mount, so this is unreachable in practice, never a
 * silent feed).
 */
export function feedSourceForDescriptor(descriptor: string): FeedSource | null {
  let parsed: ReturnType<typeof parseFeedDescriptor>
  try {
    parsed = parseFeedDescriptor(descriptor)
  } catch {
    return null
  }
  switch (parsed.kind) {
    case 'timeline':
      return {kind: parsed.timeline}
    case 'list':
      return {listId: parsed.id}
    case 'antenna':
      return {antennaId: parsed.id}
    case 'tag':
      return {tag: parsed.tag}
    default:
      return null
  }
}

// --- Live cache writes (WS-G mount) ------------------------------------------

type FeedData = InfiniteData<Page<Post>>
type NotificationsData = InfiniteData<Page<Notification>>

/**
 * Prepend live posts into one feed query's first page. Dedupe by id
 * against the whole cached query AND within the batch (a streamed note
 * racing a pending API page can never double-insert), newest-first into
 * the newest-first cache. Posts already removed (deleted while buffered)
 * never reach here — the caller filters those. Returns the inserted
 * count. No cached query (feed not loaded yet) → 0; the next fetch
 * covers those posts.
 */
export function prependLivePosts(
  client: QueryClient,
  sessionId: string,
  descriptor: string,
  posts: Post[],
): number {
  if (posts.length === 0) return 0
  const key = feedQueryKey(sessionId, descriptor)
  const data = client.getQueryData<FeedData>(key)
  if (!data || !Array.isArray(data.pages) || data.pages.length === 0) return 0
  const known = new Set<string>()
  for (const page of data.pages) {
    if (!page || !Array.isArray(page.items)) continue
    for (const item of page.items) known.add(item.id)
  }
  const fresh: Post[] = []
  for (const post of posts) {
    if (known.has(post.id)) continue
    known.add(post.id)
    fresh.push(post)
  }
  if (fresh.length === 0) return 0
  // The live buffer is oldest-first; the cache is newest-first.
  const ordered = [...fresh].reverse()
  const [first, ...rest] = data.pages
  client.setQueryData<FeedData>(key, {
    ...data,
    pages: [{...first, items: [...ordered, ...first.items]}, ...rest],
  })
  return fresh.length
}

/**
 * Remove a live-deleted post from every cached copy for the session
 * (feeds, single posts, notification rows). Returns the queries changed.
 */
export function removeLivePost(client: QueryClient, sessionId: string, id: string): number {
  return patchPostInCaches(client, sessionId, id, () => null)
}

export interface LiveNotificationIngest {
  prepended: number
  invalidated: number
}

/**
 * Ingest one live notification into the session's notification caches.
 * The `all` listing (no include/exclude filter, either grouping mode)
 * gets the row prepended with dedupe — the unread badge derives from the
 * cache, so it updates without a refetch. Every other filter view is
 * invalidated instead of guessed at: the SERVER is the filter authority
 * (filter type strings differ per family), and a verbatim-typed guess
 * could plant a row the server would never return. Inactive queries
 * refetch on their next mount; active ones refetch immediately.
 */
export function ingestLiveNotification(
  client: QueryClient,
  sessionId: string,
  notification: Notification,
): LiveNotificationIngest {
  let prepended = 0
  let invalidated = 0
  const entries = client.getQueriesData<NotificationsData>({
    queryKey: [sessionId, 'notifications'],
  })
  for (const [key, data] of entries) {
    const filterPart = key[2]
    const presetId = typeof filterPart === 'string' ? filterPart.split('|')[0] : ''
    const preset = NOTIFICATION_FILTER_PRESETS.find(p => p.id === presetId)
    const isAll = preset != null && preset.includeTypes == null && preset.excludeTypes == null
    if (!isAll || !data || !Array.isArray(data.pages) || data.pages.length === 0) {
      void client.invalidateQueries({queryKey: key})
      invalidated += 1
      continue
    }
    if (data.pages.some(page => page.items.some(item => item.id === notification.id))) continue
    const [first, ...rest] = data.pages
    client.setQueryData<NotificationsData>(key, {
      ...data,
      pages: [{...first, items: [notification, ...first.items]}, ...rest],
    })
    prepended += 1
  }
  return {prepended, invalidated}
}

// --- Mount hooks (WS-G) -------------------------------------------------------

/** Newest-N live capture bound (v1 `CAPTURE_LIMIT` parity: only the
 * newest visible notes get delete/update capture; the rest reconcile on
 * the next refresh). */
export const LIVE_CAPTURE_LIMIT = 50

export interface FeedLiveMountOptions {
  sessionId: string | null
  descriptor: string
  /** Resolved backend. `stream()` is read once per identity, inside the
   * mount effect — never during render. */
  backend: Backend | null
  /** Visible post ids (newest-first) seeding delete/update capture. */
  watchIds?: readonly string[]
}

export interface FeedLiveMount {
  /** Live is mounted (capability + handle + channel all agree). When
   * false the feed pages + refreshes and the local-diff pill owns the
   * "new posts" count — never a stuck badge, never a fake insert. */
  active: boolean
  /** Buffered arrivals (the live-fed pill count). */
  pendingCount: number
  status: StreamState
  /** Deliver the buffer into the feed cache (pill tap). */
  flush: () => void
  /** Drop the subscription and re-dial (error retry). */
  resubscribe: () => void
}

/**
 * Mount one feed's live channel (WS-G S4 UI). Gated on the `streaming`
 * capability (`supported` only — `unknown` never unlocks live affordances)
 * AND a non-null `backend.stream()` handle; per-family channel gaps
 * (disabled subscription) stand down silently. Multi-account isolation:
 * the effect is keyed on `sessionId`, so switching accounts disposes the
 * old feed's live before the new one mounts.
 *
 * React discipline (WS-C/WS-F findings): the subscription lives in an
 * effect, never in render; `watchIds` flow through a joined key so a new
 * array identity alone never resubscribes; mutable capture sets live in
 * refs.
 */
export function useFeedLive({
  sessionId,
  descriptor,
  backend,
  watchIds,
}: FeedLiveMountOptions): FeedLiveMount {
  const client = useQueryClient()
  const capable = backend?.capabilities?.streaming === 'supported'
  const [live, setLive] = useState<FeedLive | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [status, setStatus] = useState<StreamState>('unavailable')
  const [nonce, setNonce] = useState(0)
  // Ids deleted while buffered: the flush filter drops them so a delete
  // racing an arrival can never re-insert a removed post.
  const deletedRef = useRef<Set<string>>(new Set())
  // Latest visible ids for the capture-sync effect (ref: never a
  // resubscribe trigger).
  const watchIdsRef = useRef<readonly string[]>([])
  watchIdsRef.current = watchIds ?? []

  useEffect(() => {
    if (sessionId == null || !capable || backend == null || typeof backend.stream !== 'function') {
      return
    }
    let source: FeedSource | null = null
    try {
      source = feedSourceForDescriptor(descriptor)
    } catch {
      return
    }
    if (source == null) return
    let handle: StreamHandle | null = null
    try {
      handle = backend.stream()
    } catch {
      return
    }
    if (handle == null) return
    deletedRef.current.clear()
    const seenSeed = watchIdsRef.current.slice(0, LIVE_CAPTURE_LIMIT)
    let created!: FeedLive
    created = createFeedLive({
      handle,
      source,
      knownIds: seenSeed,
      onInsert: posts => {
        const batch = posts.filter(p => !deletedRef.current.has(p.id))
        if (batch.length > 0) prependLivePosts(client, sessionId, descriptor, batch)
      },
      onDelete: id => {
        deletedRef.current.add(id)
        removeLivePost(client, sessionId, id)
      },
      onUpdate: event => {
        if (typeof backend.post !== 'function') return
        // Reconcile from the server (v1 `refreshNote` parity): counts,
        // reactions and poll state re-read, never locally guessed. A
        // failed refetch keeps the current row — the next load corrects
        // it.
        void backend.post(event.id).then(
          fresh => {
            patchPostInCaches(client, sessionId, event.id, () => fresh)
          },
          () => {},
        )
      },
      onPending: () => {
        setPendingCount(created.pendingCount())
      },
    })
    // A disabled channel (per-family gap, unauthenticated auth channel)
    // is paging-only: stand down instead of mounting a stuck badge.
    if (created.channelStatus() === 'disabled' || created.channelStatus() === 'unavailable') {
      created.dispose()
      return
    }
    setLive(created)
    setPendingCount(created.pendingCount())
    setStatus(created.status())
    const off = created.onStatusChange(setStatus)
    return () => {
      off()
      created.dispose()
      setLive(null)
      setPendingCount(0)
      setStatus('unavailable')
    }
  }, [sessionId, descriptor, backend, capable, nonce, client])

  // Capture the newest visible ids (join key: array identity alone never
  // refires). Older watches stay subscribed until dispose — a delete for
  // an off-screen cached post still removes it cache-wide, which is more
  // correct than v1's unwatch, at one tiny closure per id.
  const watchKey = (watchIds ?? []).slice(0, LIVE_CAPTURE_LIMIT).join(',')
  useEffect(() => {
    if (!live) return
    for (const id of watchKey.split(',').filter(Boolean)) {
      try {
        live.watch(id)
      } catch {
        // A capture that throws at subscribe time is dropped, never fatal.
      }
    }
  }, [live, watchKey])

  const flush = useCallback(() => {
    live?.flush()
    setPendingCount(0)
  }, [live])
  const resubscribe = useCallback(() => setNonce(n => n + 1), [])

  return {
    active: live != null,
    pendingCount,
    status: live ? status : 'unavailable',
    flush,
    resubscribe,
  }
}

/**
 * Mount the live notification channel (WS-G S4 UI): arrivals ingest into
 * the session's notification caches, so the unread badge and the `all`
 * listing update without a reload. Same `streaming`-capability gate as
 * feeds; unsupported stays paging-only, never an error.
 */
export function useLiveNotifications(sessionId: string | null, backend: Backend | null): void {
  const client = useQueryClient()
  const capable = backend?.capabilities?.streaming === 'supported'
  useEffect(() => {
    if (sessionId == null || !capable || backend == null || typeof backend.stream !== 'function') {
      return
    }
    let handle: StreamHandle | null = null
    try {
      handle = backend.stream()
    } catch {
      return
    }
    if (handle == null) return
    return handle.onNotification(notification => {
      ingestLiveNotification(client, sessionId, notification)
    })
  }, [sessionId, backend, capable, client])
}
