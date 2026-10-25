// Paging guard for every infinite list (repair X3.3: networking H2, L6;
// rn-ui L1, L4).
//
// A failed next-page fetch must never cause a request loop: after an error
// the list keeps its loaded pages and only the explicit Retry button may
// fetch again. A 429 (`Retry-After`) additionally cools auto-paging down
// until the server's deadline elapses, with a visible localized countdown.
// Pull-to-refresh trims the cache to the first page before refetching, so
// a refresh costs one request, not N.
//
// End-of-feed heuristics (networking L6) — DO NOT CHANGE HERE. A feed ends
// only when the backend reports it: `getNextPageParam` returns `undefined`
// when the page says `end: true` ("no cursor") or the page came back
// empty. A short page (`items.length < limit`) NEVER ends a feed: the
// server may filter rows after the limit (mutes/visibility), so a short
// page still carries a cursor. Mastodon `Link`-header parsing lives in the
// pagination layer (X4.4); Misskey cursor paging in `pageOf` (X5.2). This
// helper only gates WHEN a next-page fetch may fire, never WHETHER more
// pages exist.

import {useCallback, useEffect, useRef, useState} from 'react'
import {useQueryClient, type InfiniteData, type QueryClient} from '@tanstack/react-query'

import {plural} from '@lingui/macro'

import {i18n} from '#/locale/i18n'

import {retryAfterMsOf} from './retry'
import type {AppQueryKey} from './keys'

/** One tick of the visible 429 countdown. */
const COOLDOWN_TICK_MS = 1000

/**
 * The slice of an infinite query (or a presentational thread like
 * `ChatThreadData`) that gates paging. `isFetchNextPageError` and `error`
 * are optional so query-less harnesses compile; absent means "no error".
 */
export interface PagedLoadSource {
  hasNextPage: boolean | undefined
  isFetchingNextPage: boolean
  isFetchNextPageError?: boolean
  fetchNextPage: () => void | Promise<unknown>
  error?: unknown
}

export interface PagedLoad {
  /**
   * Scroll/end handler: no-ops unless a fetch may fire — that is, when
   * there IS a next page, none is in flight, the last next-page fetch did
   * NOT fail, no 429 cooldown is running, and no earlier burst event is
   * still latched. Wire it to BOTH `onEndReached` and any proximity
   * `onScroll` prefetch; the latch makes burst events call once.
   */
  onEndReached: () => void
  /** True while a 429 cooldown suppresses auto-paging. */
  coolingDown: boolean
  /** Ms left on the cooldown (0 when idle); ticks down while cooling. */
  cooldownRemainingMs: number
  /** Localized countdown line for the footer, or null when idle. */
  cooldownLabel: string | null
}

/**
 * Gate for `onEndReached` / scroll-proximity prefetch. Use it in every
 * infinite list (HomeFeed both call sites, Notifications,
 * RecommendationsFeed, Conversations, ChatThread, PostFeed).
 *
 * - Error guard: while `isFetchNextPageError` is true, auto-paging stays
 *   silent. Only the explicit Retry button (which calls `fetchNextPage`
 *   directly, bypassing this guard) clears the error — on success the
 *   query clears the flag itself.
 * - Latch: the first admitted event sets a ref; further events no-op
 *   until `isFetchingNextPage` has gone true and back to false. Scroll
 *   bursts within one frame (or a slow first render) fire exactly once.
 * - 429 cooldown: when the failure carries `retryAfterMs` (see
 *   `retryAfterMsOf`), auto-paging stays suppressed until the deadline
 *   elapses, with `cooldownLabel` counting down. The explicit Retry button
 *   is NOT suppressed — a user tap always bypasses the cooldown.
 */
export function usePagedLoad(source: PagedLoadSource): PagedLoad {
  const {hasNextPage, isFetchingNextPage, isFetchNextPageError = false, fetchNextPage} = source
  const error = source.error ?? null

  const latched = useRef(false)
  const sawFetching = useRef(false)
  const [cooldownLeft, setCooldownLeft] = useState(0)

  // Arm (or extend) the 429 cooldown when a next-page failure carries a
  // server delay. Cleared the moment the error flag clears (Retry
  // succeeded) — never by a timer alone, never by scrolling.
  useEffect(() => {
    if (!isFetchNextPageError) {
      setCooldownLeft(0)
      return
    }
    const ms = retryAfterMsOf(error)
    if (ms != null && ms > 0) {
      setCooldownLeft(prev => Math.max(prev, ms))
    }
  }, [isFetchNextPageError, error])

  const coolingDown = cooldownLeft > 0

  // Visible countdown: one re-render per second while cooling.
  useEffect(() => {
    if (!coolingDown) return
    const id = setInterval(() => {
      setCooldownLeft(left => (left <= COOLDOWN_TICK_MS ? 0 : left - COOLDOWN_TICK_MS))
    }, COOLDOWN_TICK_MS)
    return () => clearInterval(id)
  }, [coolingDown])

  // Latch release: the admitted fetch must have been observed in flight
  // before the idle state releases the latch — otherwise a fetch that
  // resolves synchronously (or an error that never sets fetching) would
  // either stick shut or never latch at all.
  useEffect(() => {
    if (!latched.current) return
    if (isFetchingNextPage) {
      sawFetching.current = true
    } else if (sawFetching.current) {
      latched.current = false
      sawFetching.current = false
    }
  }, [isFetchingNextPage])

  const onEndReached = useCallback(() => {
    if (!hasNextPage) return
    if (isFetchingNextPage) return
    if (isFetchNextPageError) return
    if (coolingDown) return
    if (latched.current) return
    latched.current = true
    sawFetching.current = false
    void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, coolingDown, fetchNextPage])

  const seconds = Math.max(1, Math.ceil(cooldownLeft / COOLDOWN_TICK_MS))
  const cooldownLabel = coolingDown
    ? i18n._(
        plural(seconds, {
          one: 'Auto-load paused by the server — resumes in # second.',
          other: 'Auto-load paused by the server — resumes in # seconds.',
        }),
      )
    : null

  return {onEndReached, coolingDown, cooldownRemainingMs: coolingDown ? cooldownLeft : 0, cooldownLabel}
}

/**
 * Keep only the first page of an infinite cache entry (pure): refresh
 * costs one request, not N. `pageParams` is trimmed in lockstep so the
 * entry stays a valid `InfiniteData` (TanStack zips pages to params).
 */
export function trimInfiniteDataToFirstPage<T>(
  data: InfiniteData<T> | undefined,
): InfiniteData<T> | undefined {
  if (!data) return data
  if (data.pages.length <= 1) return data
  return {pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1)}
}

/**
 * Trim a cached infinite query to its first page in place. No-op when the
 * entry is missing or already a single page. Call before `refetch()` in
 * every pull-to-refresh on an infinite list.
 */
export function trimQueryToFirstPage(queryClient: QueryClient, queryKey: AppQueryKey): void {
  queryClient.setQueryData<InfiniteData<unknown>>(queryKey, old => trimInfiniteDataToFirstPage(old))
}

/**
 * Pull-to-refresh for infinite queries: trim the cache to the first page,
 * then refetch. Returns a stable-ish callback for `RefreshControl`.
 */
export function useRefreshFirstPage(
  queryKey: AppQueryKey,
  refetch: () => void | Promise<unknown>,
): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => {
    trimQueryToFirstPage(queryClient, queryKey)
    void refetch()
  }, [queryClient, queryKey, refetch])
}
