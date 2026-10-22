// Notifications queries (W4/C11/N18): react-query list state for the
// Notifications screen, keyed by `notificationsQueryKey` (sessionId FIRST —
// multi-account correctness: switching accounts switches keys, never data).
//
// - `useNotificationsQuery` pages `Backend.notifications` with the filter
//   preset's include/exclude types plus the grouped/flat mode. The filter
//   string in the key encodes BOTH the preset id and the grouped mode, so a
//   mode switch never serves the other mode's cached page.
// - `useMarkNotificationsRead` calls the backend mutation and invalidates
//   this session's notification queries (the read flags refetch — never
//   locally faked).
// - `useUnreadNotificationsCount` (N18) derives the badge count from the
//   query cache: unread (`read === false`) rows on the newest page of every
//   cached notifications query for the session, deduped by id. `null` means
//   unknown (signed out, or nothing fetched yet) — never a second
//   streaming-backed counter; streaming stays with its owner.

import {useCallback, useSyncExternalStore} from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'

import {
  backendForSession,
  findSession,
  type Backend,
  type Cursor,
  type KeyValueStore,
  type Notification,
  type Page,
} from '@keystone/fedi'

import {appStorage} from '#/storage'

import {notificationsQueryKey, type AppQueryKey} from './keys'
import {GC_TIME, STALE} from './stale'
import {SIGNED_OUT_SCOPE} from './usePostFeedQuery'

export const NOTIFICATIONS_PAGE_LIMIT = 20

export interface NotificationsFilter {
  includeTypes?: string[]
  excludeTypes?: string[]
}

export interface NotificationsQueryOptions {
  /** Session seam (tests inject a memory store; defaults to the app MMKV). */
  store?: KeyValueStore
  /** Backend override (screens pass the active backend; defaults to the session's). */
  backend?: Backend | null
  /** Page size. */
  limit?: number
  /** Retry count (tests pass 0 to fail fast). Defaults to 2. */
  retry?: number | false
}

/** Filter part of the query key: preset id + grouped mode (never collide). */
export function notificationsFilterKey(filterId: string, grouped: boolean): string {
  return `${filterId}|grouped:${grouped ? '1' : '0'}`
}

/** Backend for a stored session id, or null when unknown (never a guest backend). */
function resolveSessionBackend(store: KeyValueStore, sessionId: string): Backend | null {
  const session = findSession(store, sessionId)
  return session ? backendForSession(session) : null
}

/** Flatten infinite pages into one list, deduping by id (newest first wins). */
export function notificationsItems(data: InfiniteData<Page<Notification>> | undefined): Notification[] {
  if (!data) return []
  const seen = new Set<string>()
  const out: Notification[] = []
  for (const item of data.pages.flatMap(page => page.items)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

export function useNotificationsQuery(
  sessionId: string | null,
  filterId: string,
  filter: NotificationsFilter,
  grouped: boolean,
  options: NotificationsQueryOptions = {},
) {
  const limit = options.limit ?? NOTIFICATIONS_PAGE_LIMIT
  const backend =
    options.backend !== undefined
      ? options.backend
      : sessionId != null
        ? resolveSessionBackend(options.store ?? appStorage(), sessionId)
        : null
  const queryKey = notificationsQueryKey(sessionId ?? SIGNED_OUT_SCOPE, notificationsFilterKey(filterId, grouped))
  const query = useInfiniteQuery<Page<Notification>, Error, InfiniteData<Page<Notification>>, AppQueryKey, Cursor | null>({
    queryKey,
    queryFn: ({pageParam}) => {
      if (!backend) throw new Error('useNotificationsQuery: no backend for session')
      return backend.notifications({
        cursor: pageParam,
        limit,
        includeTypes: filter.includeTypes,
        excludeTypes: filter.excludeTypes,
        grouped,
      })
    },
    initialPageParam: null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    enabled: backend != null,
    retry: options.retry ?? 2,
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

export function useMarkNotificationsRead(
  sessionId: string | null,
  options: NotificationsQueryOptions = {},
) {
  const queryClient = useQueryClient()
  const backend =
    options.backend !== undefined
      ? options.backend
      : sessionId != null
        ? resolveSessionBackend(options.store ?? appStorage(), sessionId)
        : null
  return useMutation<void, Error>({
    mutationFn: async () => {
      if (!backend) throw new Error('Sign in to mark notifications read.')
      await backend.markNotificationsRead()
    },
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({queryKey: [sessionId, 'notifications']})
      }
    },
  })
}

/**
 * Dismiss ONE notification (Mastodon family — `dismissNotification` is
 * optional on `Backend` and absent on Misskey). Errors are surfaced to the
 * caller untouched: a 404/405 `ApiError` means the server does not have the
 * endpoint (`isUnsupportedError`), which the screen renders as a hidden
 * action with a reason, never as an error wall. Success invalidates the
 * session's notification queries so the row disappears from the SERVER's
 * answer — the cache is never locally pruned into a lie.
 */
export function useDismissNotification(
  sessionId: string | null,
  options: NotificationsQueryOptions = {},
) {
  const queryClient = useQueryClient()
  const backend =
    options.backend !== undefined
      ? options.backend
      : sessionId != null
        ? resolveSessionBackend(options.store ?? appStorage(), sessionId)
        : null
  return useMutation<void, Error, string>({
    mutationFn: async (id: string) => {
      if (!backend) throw new Error('Sign in to dismiss notifications.')
      if (!backend.dismissNotification) {
        throw new Error('This server cannot dismiss a notification.')
      }
      await backend.dismissNotification(id)
    },
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({queryKey: [sessionId, 'notifications']})
      }
    },
  })
}

/**
 * Clear EVERY notification (Mastodon family). Destructive and server-side:
 * the UI confirms first, then invalidates the session's notification
 * queries on success. Same unsupported-error discipline as dismiss.
 */
export function useClearNotifications(
  sessionId: string | null,
  options: NotificationsQueryOptions = {},
) {
  const queryClient = useQueryClient()
  const backend =
    options.backend !== undefined
      ? options.backend
      : sessionId != null
        ? resolveSessionBackend(options.store ?? appStorage(), sessionId)
        : null
  return useMutation<void, Error>({
    mutationFn: async () => {
      if (!backend) throw new Error('Sign in to clear notifications.')
      if (!backend.clearNotifications) {
        throw new Error('This server cannot clear notifications.')
      }
      await backend.clearNotifications()
    },
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({queryKey: [sessionId, 'notifications']})
      }
    },
  })
}

/** Count unread rows across the newest cached page per query (deduped by id). */
function countUnreadInCache(
  queries: Array<readonly [unknown, InfiniteData<Page<Notification>> | undefined]>,
): {count: number; any: boolean} {
  const seen = new Set<string>()
  let count = 0
  let any = false
  for (const [, data] of queries) {
    // Only infinite-query data carries pages; anything else in the cache
    // under this prefix is ignored (never counted, never crashed on).
    const newest = Array.isArray(data?.pages) ? data.pages[0] : undefined
    if (!newest) continue
    any = true
    for (const item of newest.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      // `read: null` (Misskey/Sharkey omit isRead) is unknown — never
      // counted as unread, never counted as read. Only `false` is unread.
      if (item.read === false) count += 1
    }
  }
  return {count, any}
}

/**
 * Unread badge count (N18) derived from the notifications query cache.
 * `null` = unknown (signed out, or nothing fetched yet). Subscribes to the
 * cache so mark-all-read invalidation flows into the badge.
 */
export function useUnreadNotificationsCount(sessionId: string | null): number | null {
  const queryClient = useQueryClient()
  const subscribe = useCallback(
    (onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange),
    [queryClient],
  )
  const getSnapshot = useCallback((): number | null => {
    if (!sessionId) return null
    const queries = queryClient.getQueriesData<InfiniteData<Page<Notification>>>({
      queryKey: [sessionId, 'notifications'],
    })
    if (queries.length === 0) return null
    const {count, any} = countUnreadInCache(queries)
    return any ? count : null
  }, [queryClient, sessionId])
  return useSyncExternalStore(subscribe, getSnapshot)
}
