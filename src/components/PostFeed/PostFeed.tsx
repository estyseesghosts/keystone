// Test-only feed harness (Q6): props-driven FlatList of ThreadRows for
// unit tests. Production renders FeedView (`src/screens/HomeFeed.tsx`),
// which owns the query + moderation + pill. Do not mount this in screens.

import {useCallback, useMemo, useRef, useState} from 'react'
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import {msg, plural} from '@lingui/macro'

import {computeFeedThreadLinks, type Capabilities, type EmojiStyle, type Post} from '@keystone/fedi'

import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {ErrorBoundary} from '#/components/ErrorBoundary'
import {Loader} from '#/components/Loader'
import {i18n} from '#/locale/i18n'
import {useSuspendOnBlur} from '#/state/activePlayer'
import {usePagedLoad} from '#/state/queries/usePagedLoad'

import {ThreadRow} from './ThreadRow'

const styles = StyleSheet.create({
  state: {alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8},
  pillWrap: {alignItems: 'center', paddingVertical: 8},
  footer: {padding: 16, alignItems: 'center'},
})

export type PostFeedProps = {
  sessionId: string
  descriptor: string
  posts?: Post[]
  /** First-page load in flight. */
  isLoading?: boolean
  /** First-page load failed. */
  isError?: boolean
  errorMessage?: string
  /** Pull-to-refresh hook point (slice 3.2 wires the query refetch). */
  onRefresh?: () => void
  /** Pagination hook point (slice 3.2 wires fetchNextPage). */
  onLoadMore?: () => void
  isFetchingMore?: boolean
  canLoadMore?: boolean
  /** Next-page failure flag (X3.3): while true, auto-paging stays silent
   * and only the footer Retry (which calls `onLoadMore` directly) fetches
   * again. */
  isFetchNextPageError?: boolean
  /** The next-page failure itself, when known (carries 429 `retryAfterMs`
   * for the cooldown countdown). */
  moreError?: unknown
  /** New-posts pill hook point (streaming lands in slice 3.10). */
  hasNewPosts?: boolean
  newPostsCount?: number
  onSeeNewPosts?: () => void
  capabilities?: Capabilities | null
  emojiStyle?: EmojiStyle
  testID?: string
}

export function PostFeed({
  sessionId,
  descriptor,
  posts = [],
  isLoading = false,
  isError = false,
  errorMessage,
  onRefresh,
  onLoadMore,
  isFetchingMore = false,
  canLoadMore = false,
  isFetchNextPageError = false,
  moreError = null,
  hasNewPosts = false,
  newPostsCount = 0,
  onSeeNewPosts,
  capabilities,
  emojiStyle = 'twemoji',
  testID,
}: PostFeedProps) {
  void descriptor
  // Navigation blur suspends every player (repair X7.2, media M5): a tab
  // switch or push pauses inline media even when rows stay mounted.
  // No-op with no navigator (tests, previews).
  useSuspendOnBlur()
  // Avatar-column links (newest-first, adjacency only): a reply directly
  // under its parent shares one connected column. Pure `replyToId`
  // check — quotes/renotes alone never link.
  const links = useMemo(() => computeFeedThreadLinks(posts), [posts])
  // Scroll-proximity prefetch: start the next page ~1200px before the
  // bottom edge, well ahead of `onEndReached` (itself raised to 2.5
  // screens). BOTH this handler and `onEndReached` go through the shared
  // `usePagedLoad` gate (X3.3): `canLoadMore` and !`isFetchingMore`, plus
  // the error guard (a failed page never refires), the burst latch (one
  // call per fetch), and the 429 cooldown — so never a duplicate fetch.
  const paged = usePagedLoad({
    hasNextPage: canLoadMore,
    isFetchingNextPage: isFetchingMore,
    isFetchNextPageError,
    fetchNextPage: () => onLoadMore?.(),
    error: moreError,
  })
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const {contentOffset, contentSize, layoutMeasurement} = e.nativeEvent
      if (contentSize == null || layoutMeasurement == null) return
      const distanceToEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height)
      if (distanceToEnd < 1200) paged.onEndReached()
    },
    [paged],
  )
  // Viewability-driven players (repair X7.2, media M5): only rows the
  // list reports as viewable may play. The callback identity is stable
  // (a ref) so FlatList never re-registers; the equality guard skips
  // identical sets so scroll frames skip the row subtree.
  const [viewableIds, setViewableIds] = useState<ReadonlySet<string>>(() => new Set())
  const onViewableItemsChanged = useRef(
    ({viewableItems}: {viewableItems: Array<{item: Post}>}) => {
      setViewableIds(prev => {
        const next = new Set(viewableItems.map(v => v.item.id))
        if (prev.size === next.size && [...prev].every(id => next.has(id))) return prev
        return next
      })
    },
  ).current
  const viewabilityConfig = useRef({itemVisiblePercentThreshold: 50}).current
  // Stable row element (same rule as FeedView): memoized ThreadRow
  // skips unchanged rows on scroll frames. The per-row boundary mirrors
  // production (repair X8.1): this harness is the row-boundary test bed,
  // so it wraps rows exactly like `FeedView` does.
  const renderRow = useCallback(
    ({item, index}: {item: Post; index: number}) => (
      <ErrorBoundary variant="row" context={item.id}>
        <ThreadRow
          post={item}
          sessionId={sessionId}
          capabilities={capabilities}
          emojiStyle={emojiStyle}
          connectedAbove={links.connectedAbove[index] ?? false}
          connectedBelow={links.connectedBelow[index] ?? false}
          // Same rule as production FeedView: bound every post except
          // inside a connected run and above the first row.
          showSeparator={index > 0 && !(links.connectedAbove[index] ?? false)}
          active={viewableIds.has(item.id)}
        />
      </ErrorBoundary>
    ),
    [sessionId, capabilities, emojiStyle, links, viewableIds],
  )
  return (
    <View style={{flex: 1}} testID={testID ?? 'post-feed'}>
      {hasNewPosts && (
        <View style={styles.pillWrap}>
          <Button
            testID="new-posts-pill"
            label={
              newPostsCount > 0
                ? i18n._(
                    plural(newPostsCount, {
                      one: `Show ${newPostsCount} new post`,
                      other: `Show ${newPostsCount} new posts`,
                    }),
                  )
                : i18n._(msg`Show new posts`)
            }
            variant="secondary"
            onPress={() => onSeeNewPosts?.()}
          />
        </View>
      )}
      <FlatList
        testID="post-feed-list"
        data={posts}
        keyExtractor={item => `${sessionId}:${item.id}`}
        // Conservative windowing (P4.1), mirroring FeedView. No
        // `getItemLayout` (variable row heights) and no
        // `removeClippedSubviews` (unverified on Android).
        windowSize={7}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        renderItem={renderRow}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={isLoading} onRefresh={onRefresh} testID="post-feed-refresh" />
          ) : undefined
        }
        onEndReached={paged.onEndReached}
        onEndReachedThreshold={2.5}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.state} testID="post-feed-loading">
              <Loader testID="post-feed-loader" />
            </View>
          ) : isError ? (
            <View style={styles.state} testID="post-feed-error">
              <Body>{i18n._(msg`Couldn't load this feed`)}</Body>
              <Caption color="muted">{errorMessage ?? i18n._(msg`Check your connection and try again.`)}</Caption>
              {onRefresh && <Button testID="post-feed-retry" label={i18n._(msg`Retry`)} variant="secondary" onPress={onRefresh} />}
            </View>
          ) : (
            <View style={styles.state} testID="post-feed-empty">
              <Body>{i18n._(msg`No posts yet`)}</Body>
            </View>
          )
        }
        ListFooterComponent={
          isFetchingMore ? (
            <View style={styles.footer} testID="post-feed-more-loading">
              <Loader testID="post-feed-more-loader" />
            </View>
          ) : isFetchNextPageError ? (
            <View style={styles.footer} testID="post-feed-more-error">
              <Caption color="muted">{i18n._(msg`Could not load more posts.`)}</Caption>
              {paged.cooldownLabel ? (
                <Caption color="muted" testID="post-feed-more-cooldown">
                  {paged.cooldownLabel}
                </Caption>
              ) : null}
              <Button
                testID="post-feed-more-retry"
                label={i18n._(msg`Retry`)}
                variant="secondary"
                onPress={() => onLoadMore?.()}
              />
            </View>
          ) : null
        }
      />
    </View>
  )
}
