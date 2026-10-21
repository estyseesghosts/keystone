// Shared feed UI for the read-path screens (slices 3.4–3.7): session/backend
// access, the read-only PostRow, and FeedView. Data comes from the canonical
// `usePostFeedQuery` (`#/state/queries`); the descriptor grammar is in
// `@keystone/fedi`, the key is `feedQueryKey`, and the visibility rules live
// in `#/state/queries/feeds` (slice 3.11 unified the former stub onto them).
import {useMemo, useSyncExternalStore, useState, useCallback, useRef} from 'react'
import {FlatList, RefreshControl, StyleSheet, View} from 'react-native'

import {
  backendForSession,
  collapseReposts,
  computeFeedThreadLinks,
  displayNameOf,
  handleOf,
  isPureRenote,
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
import {countNewItems, feedItems, filterModerated, filterSoftMuted, useModerationRules, useSoftMutedIds, usePostFeedQuery} from '#/state/queries'
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

// --- Post row (read-only; actions are Phase 4) ------------------------------

function countsLine(post: Post): string {
  const parts = [`${post.counts.replies} replies`, `${post.counts.boosts} boosts`]
  if (post.reactions) parts.push(`${post.reactions.total} reactions`)
  if (post.favourite) parts.push(`${post.favourite.count} likes`)
  return parts.join(' · ')
}

export function PostRow({post, testID}: {post: Post; testID?: string}) {
  const renoteHeader = isPureRenote(post) ? (
    <Caption color="faint">{`@${post.author.username} reposted`}</Caption>
  ) : null
  const shown = isPureRenote(post) && post.renote ? post.renote : post
  return (
    <View testID={testID ?? `post-${shown.id}`} style={[atoms.py_sm, atoms.px_md]}>
      {renoteHeader}
      <Body>{displayNameOf(shown.author)}</Body>
      <Caption color="faint">{handleOf(shown.author)}</Caption>
      <Caption color="faint">{shown.createdAt}</Caption>
      {shown.cw ? <Body>{`CW: ${shown.cw}`}</Body> : null}
      <Body>{shown.content.plain}</Body>
      <Caption color="faint">{countsLine(shown)}</Caption>
    </View>
  )
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
    <View testID={testID} style={atoms.flex1} accessibilityLabel="Loading feed">
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

export function FeedView({
  sessionId,
  descriptor,
  backend,
  retry,
  testID,
}: {
  sessionId: string | null
  descriptor: FeedDescriptor
  /** Injected backend (tests, per-column accounts). Defaults to the session's. */
  backend?: Backend | null
  /** Retry count override (tests). */
  retry?: number | false
  testID?: string
}) {
  const storeBackend = useBackendForSessionId(sessionId)
  const resolved = backend !== undefined ? backend : storeBackend
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
  const seeNewPosts = useCallback(() => {
    listRef.current?.scrollToOffset({offset: 0, animated: true})
    acknowledge()
  }, [acknowledge])

  if (!sessionId || !resolved) {
    return (
      <View testID={testID} style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>Sign in to see this feed.</Body>
        <Caption color="faint">Feeds never show sample data when signed out.</Caption>
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
        <Body>{unavailable ? 'Not on this server.' : 'Could not load this feed.'}</Body>
        <Caption color="faint">
          {unavailable
            ? 'This server has no equivalent for this timeline.'
            : 'Check your connection and try again.'}
        </Caption>
        <Button label="Retry" variant="secondary" onPress={() => void feed.refetch()} testID="feed-retry" />
      </View>
    )
  }

  return (
    <View testID={testID} style={atoms.flex1}>
      {newCount > 0 ? (
        <View style={[atoms.itemsCenter, atoms.py_sm]}>
          <Button
            label={`${newCount} new posts`}
            variant="secondary"
            onPress={seeNewPosts}
            testID="new-posts-pill"
          />
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        testID="feed-list"
        data={visibleItems}
        keyExtractor={item => `${sessionId}:${item.id}`}
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
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          <View style={[atoms.centered, atoms.p_md]}>
            <Body>Nothing here yet.</Body>
            <Caption color="faint">Pull to refresh.</Caption>
          </View>
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <View style={[atoms.centered, atoms.py_sm]}>
              <Loader testID="feed-more-loading" />
            </View>
          ) : feed.isFetchNextPageError ? (
            <View style={[atoms.centered, atoms.gap_sm, atoms.py_sm]}>
              <Caption color="faint">Could not load more posts.</Caption>
              <Button
                label="Retry"
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
