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
// - `useUnreadNotificationsCount` (N18, P6.5) returns the SERVER's unread
//   count (`useNotificationsCountQuery`); `null` means unknown (signed out,
//   unsupported, or nothing answered yet) — never a second streaming-backed
//   counter; streaming stays with its owner.
// - `useUnreadBadge` resolves the bell state (`count` / presence `dot` /
//   null) from the count query plus the presence signal (warm Misskey-family
//   `me.ext.me.hasUnreadNotification`, or a cached `read === false` row).

import {useCallback, useRef, useSyncExternalStore} from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'

import {
  ApiError,
  backendForSession,
  findSession,
  isUnsupportedError,
  type Account,
  type Backend,
  type Cursor,
  type KeyValueStore,
  type Notification,
  type Page,
} from '@keystone/fedi'

import {appStorage} from '#/storage'

import {meQueryKey, notificationsCountQueryKey, notificationsQueryKey, type AppQueryKey} from './keys'
import {GC_TIME, STALE} from './stale'
import {retryPolicy} from './retry'
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
    queryFn: ({pageParam, signal}) => {
      if (!backend) throw new Error('useNotificationsQuery: no backend for session')
      return backend.notifications({
        cursor: pageParam,
        limit,
        includeTypes: filter.includeTypes,
        excludeTypes: filter.excludeTypes,
        grouped,
        ...(signal ? {signal} : {}),
      })
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
        void queryClient.invalidateQueries({queryKey: notificationsCountQueryKey(sessionId)})
        void queryClient.invalidateQueries({queryKey: meQueryKey(sessionId)})
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
        void queryClient.invalidateQueries({queryKey: notificationsCountQueryKey(sessionId)})
        void queryClient.invalidateQueries({queryKey: meQueryKey(sessionId)})
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
        void queryClient.invalidateQueries({queryKey: notificationsCountQueryKey(sessionId)})
        void queryClient.invalidateQueries({queryKey: meQueryKey(sessionId)})
      }
    },
  })
}

// --- Server-authoritative unread count (P6.5) ------------------------------

export interface NotificationsCountQueryOptions {
  /** Session seam (tests inject a memory store; defaults to the app MMKV). */
  store?: KeyValueStore
  /** Backend override (screens pass the active backend; defaults to the session's). */
  backend?: Backend | null
  /** Retry count (tests pass 0 to fail fast). Defaults to 2. */
  retry?: number | false
  /** Caller cancellation (overrides react-query's signal when given). */
  signal?: AbortSignal
}

/** Finite non-negative count out of a warm Misskey-family `me` bag, else
 * undefined (never 0 for unknown — absent means "cannot count"). Pure. */
function placeholderCountFromMe(me: Account | null | undefined): number | undefined {
  const raw = me?.ext.me as Record<string, unknown> | undefined
  const value = raw?.unreadNotificationsCount
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

/**
 * Server-authoritative unread count (P6.5): `Backend.notificationsUnreadCount`
 * under `notificationsCountQueryKey` (sessionId FIRST, like every key).
 * "Unsupported" is query error state (read by `useUnreadBadge` as the dot
 * fallback), never an error wall — the badge renders nothing or a dot.
 * `placeholderData` (never `initialData`) seeds from the warm `me` cache so
 * the number paints before the round trip; the real fetch still happens.
 */
export function useNotificationsCountQuery(
  sessionId: string | null,
  options: NotificationsCountQueryOptions = {},
) {
  const backend =
    options.backend !== undefined
      ? options.backend
      : sessionId != null
        ? resolveSessionBackend(options.store ?? appStorage(), sessionId)
        : null
  const queryClient = useQueryClient()
  const queryKey =
    sessionId != null
      ? notificationsCountQueryKey(sessionId)
      : ([SIGNED_OUT_SCOPE, 'notifications-count'] as AppQueryKey)
  const placeholder =
    sessionId != null
      ? placeholderCountFromMe(queryClient.getQueryData<Account>(meQueryKey(sessionId)))
      : undefined
  const query = useQuery<number, Error, number, AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      if (!backend) throw new Error('useNotificationsCountQuery: no backend for session')
      if (typeof backend.notificationsUnreadCount !== 'function') {
        throw new ApiError(
          'Notification unread count is not on this server.',
          404,
          'errors.unsupported.notification_unread_count',
        )
      }
      return backend.notificationsUnreadCount({signal: options.signal ?? signal})
    },
    staleTime: STALE.NOTIFICATIONS,
    gcTime: GC_TIME.NOTIFICATIONS,
    enabled: backend != null,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
    ...(placeholder !== undefined ? {placeholderData: placeholder} : {}),
  })
  return {...query, queryKey}
}

/** Bell badge state (P6.5): an exact count, a presence dot (unread exists
 * but the server cannot count), or null (nothing to show). The UI caps the
 * display at `99+`; `count === 0` reads null. Pure type — resolved by
 * `useUnreadBadge`. */
export type UnreadBadgeState = {kind: 'count'; count: number} | {kind: 'dot'} | null

/**
 * Presence signal for the dot fallback (P6.5): true when the Misskey-family
 * `me` bag says `hasUnreadNotification`, or any cached notification row is
 * `read === false`. No signal → no dot, never a guess. Pure (unit-tested).
 */
export function unreadPresence(
  notificationsData: Array<InfiniteData<Page<Notification>> | undefined>,
  me: Account | null | undefined,
): boolean {
  const flag = (me?.ext.me as Record<string, unknown> | undefined)?.hasUnreadNotification
  if (flag === true) return true
  for (const data of notificationsData) {
    if (!data || !Array.isArray(data.pages)) continue
    for (const page of data.pages) {
      if (!page || !Array.isArray(page.items)) continue
      for (const item of page.items) {
        if (item.read === false) return true
      }
    }
  }
  return false
}

function badgeFromCount(count: number | null | undefined): UnreadBadgeState {
  if (typeof count !== 'number' || !Number.isFinite(count)) return null
  const n = Math.floor(count)
  return n > 0 ? {kind: 'count', count: n} : null
}

/** Structural equality for badge states (the snapshot memo below). */
function sameBadgeState(a: UnreadBadgeState, b: UnreadBadgeState): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'count' && b.kind === 'count') return a.count === b.count
  return true
}

/** Pure §4 resolution over one client's cache (unit-testable shape; the
 * hook memoizes its result so `useSyncExternalStore` sees a stable
 * snapshot — a fresh object identity per read would loop forever). */
function resolveBadgeState(queryClient: QueryClient, sessionId: string): UnreadBadgeState {
  const countKey = notificationsCountQueryKey(sessionId)
  const rawCount = queryClient.getQueryData<number>(countKey)
  // An answered count is final — including 0 (→ null). Only the
  // unanswered case falls through to the seed / dot paths below.
  if (typeof rawCount === 'number' && Number.isFinite(rawCount)) {
    return badgeFromCount(rawCount)
  }
  const state = queryClient.getQueryState<number>(countKey)
  const me = queryClient.getQueryData<Account>(meQueryKey(sessionId))
  if (state?.error == null) {
    // No answer yet and no failure (pending, or disabled with no
    // backend): a warm `me` seeds the number within one frame,
    // mirroring the query's placeholderData (which lives on the
    // observer, not in the cache). A failed count never shows stale
    // seed — silence on the shell, never an error wall.
    const seeded = placeholderCountFromMe(me)
    if (seeded !== undefined) return badgeFromCount(seeded)
  }
  if (state?.error != null && isUnsupportedError(state.error)) {
    const caches = queryClient
      .getQueriesData<InfiniteData<Page<Notification>>>({queryKey: [sessionId, 'notifications']})
      .filter(([key]) => Array.isArray(key) && key[1] === 'notifications')
      .map(([, data]) => data)
    return unreadPresence(caches, me) ? {kind: 'dot'} : null
  }
  return null
}

/**
 * Bell badge state (P6.5) implementing the plan §4 resolution order:
 * a numeric count answers → count (0 → null); "unsupported" → dot only
 * with a real presence signal, else null; anything else (signed out, no
 * backend, pending, auth/net failure) → null. Mounts the count query so
 * the number arrives and stays live; subscribes to the cache so live
 * arrivals and mark-read invalidation flow into the badge.
 */
export function useUnreadBadge(sessionId: string | null): UnreadBadgeState {
  useNotificationsCountQuery(sessionId)
  const queryClient = useQueryClient()
  const lastRef = useRef<UnreadBadgeState>(null)
  const subscribe = useCallback(
    (onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange),
    [queryClient],
  )
  const getSnapshot = useCallback((): UnreadBadgeState => {
    if (!sessionId) {
      lastRef.current = null
      return null
    }
    const next = resolveBadgeState(queryClient, sessionId)
    // Stable identity across reads: `useSyncExternalStore` re-renders on
    // every snapshot change, and a fresh object per read would loop.
    if (!sameBadgeState(lastRef.current, next)) lastRef.current = next
    return lastRef.current
  }, [queryClient, sessionId])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Unread badge count (P6.5): the server count, `null` when unknown or
 * unsupported. Keeps its name and `number | null` signature (the
 * Notifications screen caption and the shell badge consume it).
 */
export function useUnreadNotificationsCount(sessionId: string | null): number | null {
  const badge = useUnreadBadge(sessionId)
  return badge != null && badge.kind === 'count' ? badge.count : null
}
