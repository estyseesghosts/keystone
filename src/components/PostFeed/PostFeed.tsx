// Feed list (slice 3.3): FlatList of PostCards with empty / loading /
// error states, a pull-to-refresh hook point, and a new-posts pill
// hook point.
//
// Data arrives via props in this slice — the TanStack
// `usePostFeedQuery(sessionId, descriptor)` hook lands in slice 3.2
// and will feed THESE props. The component accepts (not fetches)
// `descriptor + sessionId`, and keys off `postFeedQueryKey`.

import {FlatList, RefreshControl, StyleSheet, View} from 'react-native'

import type {Capabilities, EmojiStyle, Post} from '@keystone/fedi'

import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {PostCard} from '#/components/Post/index'

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
        keyExtractor={item => item.id}
        renderItem={({item}) => (
          <PostCard post={item} sessionId={sessionId} capabilities={capabilities} emojiStyle={emojiStyle} />
        )}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={isLoading} onRefresh={onRefresh} testID="post-feed-refresh" />
          ) : undefined
        }
        onEndReached={canLoadMore && !isFetchingMore ? () => onLoadMore?.() : undefined}
        onEndReachedThreshold={0.5}
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
