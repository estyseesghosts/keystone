// Test-only feed harness (Q6): props-driven FlatList of ThreadRows for
// unit tests. Production renders FeedView (`src/screens/HomeFeed.tsx`),
// which owns the query + moderation + pill. Do not mount this in screens.

import {useCallback, useMemo} from 'react'
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import {computeFeedThreadLinks, type Capabilities, type EmojiStyle, type Post} from '@keystone/fedi'

import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'

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
  hasNewPosts = false,
  newPostsCount = 0,
  onSeeNewPosts,
  capabilities,
  emojiStyle = 'twemoji',
  testID,
}: PostFeedProps) {
  void descriptor
  // Avatar-column links (newest-first, adjacency only): a reply directly
  // under its parent shares one connected column. Pure `replyToId`
  // check — quotes/renotes alone never link.
  const links = useMemo(() => computeFeedThreadLinks(posts), [posts])
  // Scroll-proximity prefetch: start the next page ~1200px before the
  // bottom edge, well ahead of `onEndReached` (itself raised to 2.5
  // screens). Same guards as the threshold handler — `canLoadMore` and
  // !`isFetchingMore`, so never a duplicate fetch.
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const {contentOffset, contentSize, layoutMeasurement} = e.nativeEvent
      if (contentSize == null || layoutMeasurement == null) return
      const distanceToEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height)
      if (distanceToEnd < 1200 && canLoadMore && !isFetchingMore) onLoadMore?.()
    },
    [canLoadMore, isFetchingMore, onLoadMore],
  )
  return (
    <View style={{flex: 1}} testID={testID ?? 'post-feed'}>
      {hasNewPosts && (
        <View style={styles.pillWrap}>
          <Button
            testID="new-posts-pill"
            label={newPostsCount > 0 ? `Show ${newPostsCount} new posts` : 'Show new posts'}
            variant="secondary"
            onPress={() => onSeeNewPosts?.()}
          />
        </View>
      )}
      <FlatList
        testID="post-feed-list"
        data={posts}
        keyExtractor={item => `${sessionId}:${item.id}`}
        renderItem={({item, index}) => (
          <ThreadRow
            post={item}
            sessionId={sessionId}
            capabilities={capabilities}
            emojiStyle={emojiStyle}
            connectedAbove={links.connectedAbove[index] ?? false}
            connectedBelow={links.connectedBelow[index] ?? false}
          />
        )}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={isLoading} onRefresh={onRefresh} testID="post-feed-refresh" />
          ) : undefined
        }
        onEndReached={canLoadMore && !isFetchingMore ? () => onLoadMore?.() : undefined}
        onEndReachedThreshold={2.5}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.state} testID="post-feed-loading">
              <Loader testID="post-feed-loader" />
            </View>
          ) : isError ? (
            <View style={styles.state} testID="post-feed-error">
              <Body>Couldn&apos;t load this feed</Body>
              <Caption color="muted">{errorMessage ?? 'Check your connection and try again.'}</Caption>
              {onRefresh && <Button testID="post-feed-retry" label="Retry" variant="secondary" onPress={onRefresh} />}
            </View>
          ) : (
            <View style={styles.state} testID="post-feed-empty">
              <Body>No posts yet</Body>
            </View>
          )
        }
        ListFooterComponent={
          isFetchingMore ? (
            <View style={styles.footer} testID="post-feed-more-loading">
              <Loader testID="post-feed-more-loader" />
            </View>
          ) : null
        }
      />
    </View>
  )
}
