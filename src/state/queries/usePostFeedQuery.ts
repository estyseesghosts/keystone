import {useMemo} from 'react'
import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query'

import {
  ApiError,
  backendForSession,
  findSession,
  parseFeedDescriptor,
  sessionBackendKey,
  type Backend,
  type Cursor,
  type FeedDescriptor,
  type KeyValueStore,
  type Page,
  type ParsedFeedDescriptor,
  type Post,
} from '@keystone/fedi'

import {appStorage} from '#/storage'

import {feedQueryKey, type AppQueryKey} from './keys'
import {GC_TIME, STALE} from './stale'
import {retryPolicy} from './retry'

// Post-feed infinite query (slice 3.2): serves every timeline screen and
// every deck column. `usePostFeedQuery(sessionId, descriptor)` pages the
// `Backend` for exactly that session over `backendForSession`, so the
// token can only ever reach its own origin (same guarantee as the client
// facade). Query keys carry the sessionId first — switching accounts
// switches keys, never data (regression-tested).
//
// Unsupported descriptors answer the honest typed 404 (`errors.unsupported.*`,
// the same convention as the Mastodon backend) so the UI shows an honest
// unavailable state — never an empty feed, never faked data.

export const FEED_PAGE_LIMIT = 20

/** Signed-out key scope: the query is disabled, and the key can never collide. */
export const SIGNED_OUT_SCOPE = 'signed-out'

export interface PostFeedQueryOptions {
  /** Session seam (tests inject a memory store; defaults to the app MMKV). */
  store?: KeyValueStore
  /** Backend override (tests inject fakes; defaults to `backendForSession`). */
  backend?: Backend
  /** Page size. */
  limit?: number
  /** Retry count (tests pass 0 to fail fast). Defaults to 2. */
  retry?: number | false
  /** Recommendation feed params (only read when the descriptor is
   * `recommendations`; absent = server defaults). */
  rec?: {lang?: string; withSensitive?: boolean; withRenotes?: boolean; refresh?: boolean}
}

/**
 * Fetch one page of a parsed descriptor from a backend. Exported for unit
 * tests (dispatch matrix) — screens use the hook.
 */
export async function fetchFeedPage(
  backend: Backend,
  parsed: ParsedFeedDescriptor,
  cursor: Cursor | null,
  limit: number = FEED_PAGE_LIMIT,
  rec?: {lang?: string; withSensitive?: boolean; withRenotes?: boolean; refresh?: boolean},
  signal?: AbortSignal,
): Promise<Page<Post>> {
  const opts = {cursor, limit, ...(signal ? {signal} : {})}
  switch (parsed.kind) {
    case 'timeline':
      return backend.timeline(parsed.timeline, opts)
    case 'recommendations': {
      if (!backend.recommendations) {
        throw new ApiError(
          'Recommendations are not available on this server.',
          404,
          'errors.unsupported.recommendations',
        )
      }
      return backend.recommendations.feed({
        cursor,
        limit: limit === FEED_PAGE_LIMIT ? 10 : limit,
        ...(rec?.lang !== undefined ? {lang: rec.lang} : {}),
        ...(rec?.withSensitive !== undefined ? {withSensitive: rec.withSensitive} : {}),
        ...(rec?.withRenotes !== undefined ? {withRenotes: rec.withRenotes} : {}),
        ...(rec?.refresh !== undefined ? {refresh: rec.refresh} : {}),
        ...(signal ? {signal} : {}),
      })
    }
    case 'list': {
      if (!backend.lists) {
        throw new ApiError('Lists are not available on this server.', 404, 'errors.unsupported.lists')
      }
      return backend.lists.timeline(parsed.id, opts)
    }
    case 'antenna': {
      if (!backend.antennas) {
        throw new ApiError(
          'Antennas are not available on this server.',
          404,
          'errors.unsupported.antennas',
        )
      }
      return backend.antennas.notes(parsed.id, opts)
    }
    case 'channel':
      // Misskey-family channel feed (`channels/timeline`). The Mastodon
      // family leaves `channels` undefined — honest unsupported, never a
      // faked feed.
      if (!backend.channels) {
        throw new ApiError(
          'Channels are not available on this server.',
          404,
          'errors.unsupported.channels',
        )
      }
      return backend.channels.notes(parsed.id, opts)
    case 'clip': {
      if (!backend.clips) {
        throw new ApiError('Clips are not available on this server.', 404, 'errors.unsupported.clips')
      }
      return backend.clips.notes(parsed.id, opts)
    }
    case 'tag':
      return backend.search.tags(parsed.tag, opts)
    case 'search':
      return backend.search.posts(parsed.query, opts)
    case 'explore': {
      if (!backend.explore) {
        throw new ApiError(
          'Trending posts are not available on this server.',
          404,
          'errors.unsupported.explore',
        )
      }
      return backend.explore.posts(opts)
    }
    case 'bookmarks': {
      if (!backend.bookmarks) {
        throw new ApiError(
          'Bookmarks are not available on this server.',
          404,
          'errors.unsupported.bookmarks',
        )
      }
      const page = await backend.bookmarks.list(opts)
      return {items: page.items.map(row => row.post), cursor: page.cursor, end: page.end}
    }
    case 'mentions': {
      // Mentions ride the notifications listing (flat rows carrying the
      // target post); rows without a visible post are dropped, never faked.
      const page = await backend.notifications({cursor, limit, includeTypes: ['mention', 'reply'], ...(signal ? {signal} : {})})
      return {
        items: page.items.map(n => n.post).filter((p): p is Post => p != null),
        cursor: page.cursor,
        end: page.end,
      }
    }
    case 'user': {
      // Misskey `users/notes` defaults differ per tab (core/backend.ts), so
      // every tab sends its flags explicitly — never relies on defaults.
      switch (parsed.tab) {
        case 'posts':
          return backend.accountPosts(parsed.id, {...opts, withReplies: false, withRenotes: false})
        case 'all':
          // v1's All tab: replies AND renotes together (A1).
          return backend.accountPosts(parsed.id, {...opts, withReplies: true, withRenotes: true})
        case 'replies':
          return backend.accountPosts(parsed.id, {...opts, withReplies: true, withRenotes: false})
        case 'media':
          return backend.accountPosts(parsed.id, {...opts, withFiles: true, withRenotes: false})
        case 'featured':
          return backend.accountFeaturedPosts(parsed.id, opts)
      }
    }
  }
}

/** Flatten infinite pages into one list (screens render this). Pages can
 * overlap at their edges (a new post inserted between the first fetch and
 * the next-page fetch shifts cursors), so ids are deduped keeping the
 * FIRST (newest) occurrence — F21. */
export function feedItems(data: InfiniteData<Page<Post>> | undefined): Post[] {
  if (!data) return []
  const seen = new Set<string>()
  const out: Post[] = []
  for (const item of data.pages.flatMap(page => page.items)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/**
 * Infinite post-feed query for one session + descriptor. Disabled (no fetch,
 * no data) when signed out or the session is unknown — the caller shows its
 * signed-out state instead.
 */
export function usePostFeedQuery(
  sessionId: string | null,
  descriptor: FeedDescriptor | string,
  options: PostFeedQueryOptions = {},
): UseInfiniteQueryResult<InfiniteData<Page<Post>>, Error> & {queryKey: AppQueryKey} {
  const parsed = parseFeedDescriptor(descriptor)
  const limit = options.limit ?? FEED_PAGE_LIMIT
  const store = options.store ?? appStorage()
  const session = sessionId != null ? findSession(store, sessionId) : null
  // Memo on the session's registry identity — not the store snapshot —
  // so a health refresh or another account's activity keeps the pooled
  // backend (and its socket) instead of rebuilding it every render. The
  // key carries the token/flavor/evidence, so a rotation still rebuilds.
  const sessionKey = session != null ? sessionBackendKey(session) : null
  const backend = useMemo(
    () =>
      options.backend ??
      (sessionId != null && sessionKey != null ? resolveSessionBackend(store, sessionId) : null),
    [options.backend, store, sessionId, sessionKey],
  )
  const recSuffix =
    parsed.kind === 'recommendations' && options.rec
      ? JSON.stringify([options.rec.lang ?? null, options.rec.withSensitive ?? null, options.rec.withRenotes ?? null])
      : null
  const queryKey =
    recSuffix != null
      ? feedQueryKey(sessionId ?? SIGNED_OUT_SCOPE, `${descriptor}|${recSuffix}`)
      : feedQueryKey(sessionId ?? SIGNED_OUT_SCOPE, descriptor)
  const query = useInfiniteQuery<Page<Post>, Error, InfiniteData<Page<Post>>, AppQueryKey, Cursor | null>({
    queryKey,
    queryFn: ({pageParam, signal}) => {
      if (!backend) throw new Error('usePostFeedQuery: no backend for session')
      return fetchFeedPage(backend, parsed, pageParam, limit, options.rec, signal)
    },
    initialPageParam: null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    enabled: backend != null,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

/** Backend for a stored session id, or null when unknown (never a guest backend). */
function resolveSessionBackend(store: KeyValueStore, sessionId: string): Backend | null {
  const session = findSession(store, sessionId)
  return session ? backendForSession(session) : null
}
