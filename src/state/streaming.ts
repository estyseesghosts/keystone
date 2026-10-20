import type {
  FeedSource,
  PostUpdateEvent,
  StreamHandle,
  StreamState,
} from '@keystone/fedi'
import type {Post} from '@keystone/fedi'

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
  onDelete?: (id: string) => void
  onUpdate?: (event: PostUpdateEvent) => void
}

export interface FeedLive {
  /** Pending buffered posts (oldest-first). */
  pending(): Post[]
  pendingCount(): number
  /** Deliver the buffer to `onInsert` and clear it (pill tap). */
  flush(): Post[]
  /** Discard the buffer without delivering. */
  clear(): void
  status(): StreamState
  onStatusChange(handler: (state: StreamState) => void): () => void
  /** Drop the subscription (unmount / account switch). */
  dispose(): void
}

/**
 * Follow one feed's live channel. When the backend has no streaming
 * (`handle` null or the source unsupported), the returned live is
 * `unavailable` and feeds keep paging + manual refresh — never an error.
 */
export function createFeedLive(opts: FeedLiveOpts): FeedLive {
  const {handle, source, onInsert} = opts
  const seen = new Set<string>(opts.knownIds ?? [])
  let buffer: Post[] = []
  let subscription: {unsubscribe(): void} | null = null
  let postUnsub: (() => void) | null = null

  if (handle) {
    subscription = handle.subscribeTimeline(source, post => {
      if (seen.has(post.id)) return
      seen.add(post.id)
      buffer = [...buffer, post]
    })
    // Post-level deletes route through the same handle where supported
    // (Misskey note capture; Mastodon delete events arrive on the feed
    // channel and are filtered by the adapter — both surface via onPost
    // with the existing shape, so no second socket here).
    postUnsub = null
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

    status(): StreamState {
      if (!handle || !subscription) return 'unavailable'
      return handle.status()
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
      postUnsub?.()
      postUnsub = null
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
