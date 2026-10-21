// Shared feed UI for the read-path screens: session/backend access and
// FeedView. Data comes from the canonical `usePostFeedQuery`
// (`#/state/queries`); the descriptor grammar is in `@keystone/fedi`, the
// key is `feedQueryKey`, and the visibility rules live in
// `#/state/queries/feeds`. Rows render via ThreadRow → PostCard (the
// production path; Q6: the read-only PostRow was deleted, PostFeed is the
// test-only harness in components/PostFeed).
import {useMemo, useSyncExternalStore, useState, useCallback, useRef, useEffect, type ReactNode} from 'react'
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import {msg} from '@lingui/macro'

import {
  backendForSession,
  collapseReposts,
  computeFeedThreadLinks,
  isUnsupportedError,
  type Backend,
  type FeedDescriptor,
  type Post,
  type Session,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {SignInButton} from '#/components/SignInButton'
import {ThreadRow} from '#/components/PostFeed/ThreadRow'
import {i18n} from '#/locale/i18n'
import {countNewItems, feedItems, filterModerated, filterSoftMuted, useModerationRules, useSoftMutedIds, usePostFeedQuery} from '#/state/queries'
import {feedScrollKey, readFeedScroll, saveFeedScroll} from '#/state/feedMemory'
import {useSessionStore} from '#/state/session/SessionProvider'

// --- Session / backend access -----------------------------------------------

export function useActiveBackend(): {session: Session | null; backend: Backend | null} {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const session = snapshot.sessions.find(s => s.id === snapshot.activeId) ?? null
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  return {session, backend}
}

/** Resolve the Backend for an arbitrary session id (per-column accounts). */
export function useBackendForSessionId(sessionId: string | null): Backend | null {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(() => {
    if (!sessionId) return null
    const session = snapshot.sessions.find(s => s.id === sessionId) ?? null
    return session ? backendForSession(session) : null
  }, [snapshot, sessionId])
}

// --- New-posts pill ----------------------------------------------------------

/** Baseline is per feed key: an account/descriptor switch starts fresh. */
function useNewPosts(feedKey: string, items: Post[]) {
  const [baseline, setBaseline] = useState<{key: string; id: string | null}>({key: feedKey, id: null})
  const current = baseline.key === feedKey ? baseline.id : null
  const firstId = items[0]?.id ?? null
  if (current == null && firstId != null) {
    // First load for this key: the list IS the baseline.
    setBaseline({key: feedKey, id: firstId})
  }
  const newCount = countNewItems(items, current)
  const acknowledge = useCallback(
    () => setBaseline({key: feedKey, id: firstId}),
    [feedKey, firstId],
  )
  return {newCount, acknowledge}
}

// --- Feed view: refresh + pill + empty/loading/error ------------------------

// Skeleton rows for the initial load (F21): grey boxes in the shape of a
// post row, so the layout does not jump when the first page lands. Plain
// Views only — no animation dependency (reduced-motion safe by default).
function FeedSkeleton({testID}: {testID?: string}) {
  const theme = useTheme()
  const styles = StyleSheet.create({
    row: {flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12},
    avatar: {width: 40, height: 40, borderRadius: 20, backgroundColor: theme.palette.raise},
    col: {flex: 1, gap: 8},
    bar: {height: 12, borderRadius: 6, backgroundColor: theme.palette.raise},
  })
  return (
    <View testID={testID} style={atoms.flex1} accessibilityLabel={i18n._(msg`Loading feed`)}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={styles.row}>
          <View style={styles.avatar} />
          <View style={styles.col}>
            <View style={[styles.bar, {width: '40%'}]} />
            <View style={styles.bar} />
            <View style={[styles.bar, {width: '70%'}]} />
          </View>
        </View>
      ))}
      <View style={[atoms.centered, atoms.py_sm]}>
        <Loader testID="feed-loading" />
      </View>
    </View>
  )
}

// Chrome overlays: absolutely positioned so they never take layout space
// (mounting must not shift the feed). The pill floats over the content;
// the pinned tab copy covers the in-flow copy exactly once scrolled past.
const feedChromeStyles = StyleSheet.create({
  floatingPill: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
    elevation: 5,
  },
  pinnedBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 4,
    elevation: 4,
  },
})

export function FeedView({  sessionId,
  descriptor,
  backend,
  retry,
  testID,
  scrollHeader,
  stickyBar,
}: {
  sessionId: string | null
  descriptor: FeedDescriptor
  /** Injected backend (tests, per-column accounts). Defaults to the session's. */
  backend?: Backend | null
  /** Retry count override (tests). */
  retry?: number | false
  testID?: string
  /**
   * Content rendered as the FlatList header: it scrolls away with the feed
   * (Home mounts the composer here; the profile mounts its bio header).
   * Optional — every other caller renders no header, as before.
   */
  scrollHeader?: ReactNode
  /**
   * Bar with true-sticky behavior: rendered in-flow directly under
   * `scrollHeader` (correct rest order — bio, then tabs), plus a pinned
   * copy overlaid above the list once the in-flow copy scrolls off the
   * top. Hand-rolled (no `stickyHeaderIndices` — unsupported on web): the
   * in-flow copy reports its offset via `onLayout`, the scroll handler
   * flips a boolean only on crossing. The pinned copy is absolutely
   * positioned (no layout space, so pinning never shifts the feed) with
   * an opaque background; the covered in-flow copy stays mounted (no
   * jump, no remount) but is hidden from assistive tech while covered.
   * Optional, off by default.
   */
  stickyBar?: ReactNode
}) {
  const storeBackend = useBackendForSessionId(sessionId)
  const resolved = backend !== undefined ? backend : storeBackend
  const theme = useTheme()
  const feed = usePostFeedQuery(sessionId, descriptor, {
    ...(resolved ? {backend: resolved} : {}),
    ...(retry !== undefined ? {retry} : {}),
  })
  const softMuted = useSoftMutedIds(sessionId)
  const moderation = useModerationRules(sessionId)
  // Server-side rules (F22/MK1) drop rows first; the client soft-mute set
  // hides by account on top. Both run in EVERY feed (this is the shared
  // FeedView), never Home-only.
  const items = useMemo(
    () => filterSoftMuted(filterModerated(feedItems(feed.data), moderation), softMuted),
    [feed.data, moderation, softMuted],
  )
  // Boost collapsing (F17): an original plus its reposts shows only the
  // first repost, with the aggregated renoters on the banner. Quotes
  // never collapse — they carry their own commentary.
  const collapsed = useMemo(() => collapseReposts(items), [items])
  const visibleItems = useMemo(() => items.filter(i => collapsed.reps.has(i.id)), [items, collapsed])
  const {newCount, acknowledge} = useNewPosts(feed.queryKey.join('|'), visibleItems)
  // Same avatar-column links as PostFeed: adjacent parent/child pairs
  // share one connected column (newest-first, `replyToId` only).
  // Computed over the COLLAPSED rows so indices match the FlatList.
  const links = useMemo(() => computeFeedThreadLinks(visibleItems), [visibleItems])
  // The pill scrolls to the new posts, then dismisses (F21): the list is
  // newest-first, so the top is where the unseen items are.
  const listRef = useRef<FlatList<Post>>(null)
  // Scroll restoration (N14) key: session + descriptor, read once per mount.
  const scrollKey = feedScrollKey(sessionId, descriptor)
  // Seamless infinite scroll: the next page starts ~1200px before the
  // bottom edge, well ahead of `onEndReached` (which is itself raised to
  // 2.5 screens). Guards match the threshold handler — `hasNextPage` and
  // !`isFetchingNextPage`, so never a duplicate fetch, never a stall.
  // The same handler also writes the N14 scroll offset (a Map set, no
  // re-render).
  const {hasNextPage, isFetchingNextPage, fetchNextPage} = feed
  // True-sticky bar state: the in-flow copy reports its content offset via
  // onLayout; the scroll handler pins a copy above the list once the
  // in-flow copy scrolls off the top. Refs mirror the boolean so scrolling
  // never re-renders until the crossing actually happens.
  const [tabsPinned, setTabsPinned] = useState(false)
  const tabsOffsetY = useRef(0)
  const tabsPinnedRef = useRef(false)
  const hasStickyBar = stickyBar != null
  const onStickyBarLayout = useCallback((e: LayoutChangeEvent) => {
    tabsOffsetY.current = e.nativeEvent.layout.y
  }, [])
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const native = e.nativeEvent
      saveFeedScroll(scrollKey, native.contentOffset.y)
      const {contentSize, layoutMeasurement} = native
      if (contentSize == null || layoutMeasurement == null) return
      const distanceToEnd =
        contentSize.height - (native.contentOffset.y + layoutMeasurement.height)
      if (distanceToEnd < 1200 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
      if (hasStickyBar) {
        const shouldPin = native.contentOffset.y >= tabsOffsetY.current - 1
        if (shouldPin !== tabsPinnedRef.current) {
          tabsPinnedRef.current = shouldPin
          setTabsPinned(shouldPin)
        }
      }
    },
    [scrollKey, hasNextPage, isFetchingNextPage, fetchNextPage, hasStickyBar],
  )
  // Scroll restoration (N14): offsets are remembered per session +
  // descriptor and restored once per mount, so back-navigation returns
  // to the same position. The write happens on every scroll event (a
  // Map set — no re-render); the read fires once when content exists.
  const restoredScrollRef = useRef<string | null>(null)
  useEffect(() => {
    if (restoredScrollRef.current === scrollKey || feed.isPending || visibleItems.length === 0) return
    restoredScrollRef.current = scrollKey
    const offset = readFeedScroll(scrollKey)
    if (offset != null && offset > 0) listRef.current?.scrollToOffset({offset, animated: false})
  }, [scrollKey, feed.isPending, visibleItems.length])
  const seeNewPosts = useCallback(() => {
    listRef.current?.scrollToOffset({offset: 0, animated: true})
    acknowledge()
  }, [acknowledge])

  if (!sessionId || !resolved) {
    return (
      <View testID={testID} style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`Sign in to see this feed.`)}</Body>
        <Caption color="faint">{i18n._(msg`Feeds never show sample data when signed out.`)}</Caption>
        <SignInButton />
      </View>
    )
  }

  if (feed.isPending) {
    return (
      <View testID={testID} style={atoms.flex1}>
        <FeedSkeleton testID="feed-skeleton" />
      </View>
    )
  }

  // TanStack marks the whole query `error` even when only a next-page (or
  // background refetch) fetch failed — `feed.data` still holds the loaded
  // pages. The full error screen is only for having NO data; with data the
  // list stays mounted and the footer offers the next-page retry (F21).
  const hasData = feed.data != null && feed.data.pages.some(p => p.items.length > 0)
  if (feed.isError && !hasData) {
    const unavailable = isUnsupportedError(feed.error)
    return (
      <View testID={testID} style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{unavailable ? i18n._(msg`Not on this server.`) : i18n._(msg`Could not load this feed.`)}</Body>
        <Caption color="faint">
          {unavailable
            ? i18n._(msg`This server has no equivalent for this timeline.`)
            : i18n._(msg`Check your connection and try again.`)}
        </Caption>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => void feed.refetch()} testID="feed-retry" />
      </View>
    )
  }

  return (
    <View testID={testID} style={atoms.flex1}>
      {newCount > 0 ? (
        // Floating pill over the content (no layout bar behind it): the
        // wrapper ignores touches so the feed stays scrollable beneath,
        // the button itself stays tappable.
        <View pointerEvents="box-none" style={feedChromeStyles.floatingPill}>
          <Button
            label={i18n._(msg`${newCount} new posts`)}
            variant="secondary"
            onPress={seeNewPosts}
            testID="new-posts-pill"
          />
        </View>
      ) : null}
      {tabsPinned && stickyBar != null ? (
        // Absolute overlay: takes no layout space, so pinning never shifts
        // the feed. Opaque background — scrolled content must not show
        // through the stuck bar.
        <View
          testID="feed-sticky-bar"
          style={[feedChromeStyles.pinnedBar, {backgroundColor: theme.palette.bg}]}>
          {stickyBar}
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        testID="feed-list"
        data={visibleItems}
        keyExtractor={item => `${sessionId}:${item.id}`}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        ListHeaderComponent={
          scrollHeader != null || stickyBar != null ? (
            <View>
              {scrollHeader != null ? (
                <View testID="feed-scroll-header">{scrollHeader}</View>
              ) : null}
              {stickyBar != null ? (
                // Always mounted (mount/unmount would jump the feed); while
                // pinned the overlay covers this copy, so hide it from
                // assistive tech instead of removing it.
                <View
                  onLayout={onStickyBarLayout}
                  accessibilityElementsHidden={tabsPinned}
                  importantForAccessibility={tabsPinned ? 'no-hide-descendants' : 'auto'}>
                  {stickyBar}
                </View>
              ) : null}
            </View>
          ) : undefined
        }
        renderItem={({item, index}) => (
          <ThreadRow
            post={item}
            sessionId={sessionId}
            capabilities={resolved.capabilities}
            renoters={collapsed.renotersByRep.get(item.id)}
            connectedAbove={links.connectedAbove[index] ?? false}
            connectedBelow={links.connectedBelow[index] ?? false}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={() => void feed.refetch()}
            testID="feed-refresh"
          />
        }
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage()
        }}
        onEndReachedThreshold={2.5}
        ListEmptyComponent={
          <View style={[atoms.centered, atoms.p_md]}>
            <Body>{i18n._(msg`Nothing here yet.`)}</Body>
            <Caption color="faint">{i18n._(msg`Pull to refresh.`)}</Caption>
          </View>
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <View style={[atoms.centered, atoms.py_sm]}>
              <Loader testID="feed-more-loading" />
            </View>
          ) : feed.isFetchNextPageError ? (
            <View style={[atoms.centered, atoms.gap_sm, atoms.py_sm]}>
              <Caption color="faint">{i18n._(msg`Could not load more posts.`)}</Caption>
              <Button
                label={i18n._(msg`Retry`)}
                variant="secondary"
                onPress={() => void feed.fetchNextPage()}
                testID="feed-more-retry"
              />
            </View>
          ) : null
        }
      />
    </View>
  )
}
