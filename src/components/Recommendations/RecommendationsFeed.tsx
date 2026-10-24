import {forwardRef, useCallback, useImperativeHandle, useMemo, useRef, type ReactNode} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {SkeletonList} from '#/components/Skeleton'
import {ThreadRow} from '#/components/PostFeed/ThreadRow'
import {useRecommendationDwell, RECOMMENDATION_VIEWABILITY_CONFIG} from '#/lib/recommendationDwell'
import {useLocale} from '#/locale/i18n'
import {collapseReposts, computeFeedThreadLinks, isUnsupportedError, type Backend} from '@keystone/fedi'
import {feedItems, usePostFeedQuery} from '#/state/queries'
import {recommendationFeedParams, useRecommendationSettings} from '#/state/queries/recommendations'
import {filterModerated, filterSoftMuted, useModerationRules, useSoftMutedIds} from '#/state/queries'

// Recommendations feed (fork `notes/recommendations`, offset-paged).
// Reuses the timeline renderers (ThreadRow → PostCard); no custom card.
// Pull-to-refresh resets to offset 0; infinite scroll appends with
// offset = loaded items; dwell tracking reports visible time best-effort.

export type RecommendationsFeedHandle = {
  reload: () => void
  scrollToTop: () => void
}

export const RecommendationsFeed = forwardRef<
  RecommendationsFeedHandle,
  {sessionId: string | null; backend?: Backend | null; testID?: string; scrollHeader?: ReactNode}
>(function RecommendationsFeed({sessionId, backend, testID, scrollHeader}, ref) {
  const theme = useTheme()
  const locale = useLocale()
  const {settings} = useRecommendationSettings(sessionId)
  const rec = useMemo(
    () => recommendationFeedParams(locale, settings),
    [locale, settings],
  )
  const feed = usePostFeedQuery(sessionId, 'recommendations', {
    ...(backend ? {backend} : {}),
    limit: 10,
    rec,
  })
  const softMuted = useSoftMutedIds(sessionId)
  const moderation = useModerationRules(sessionId)
  const items = useMemo(
    () => filterSoftMuted(filterModerated(feedItems(feed.data), moderation), softMuted),
    [feed.data, moderation, softMuted],
  )
  const collapsed = useMemo(() => collapseReposts(items), [items])
  const visibleItems = useMemo(() => items.filter(i => collapsed.reps.has(i.id)), [items, collapsed])
  const links = useMemo(() => computeFeedThreadLinks(visibleItems), [visibleItems])
  const {threadLinks} = useThreadLinks(links)
  const listRef = useRef<FlatList<(typeof visibleItems)[number]>>(null)
  const {onViewableItemsChanged, flush} = useRecommendationDwell(sessionId, backend ?? null)

  useImperativeHandle(ref, () => ({
    reload: () => {
      flush()
      void feed.refetch()
    },
    scrollToTop: () => listRef.current?.scrollToOffset({offset: 0, animated: true}),
  }))

  const onEndReached = useCallback(() => {
    if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage()
  }, [feed])

  if (!sessionId) return null

  if (feed.isPending) {
    return (
      <View testID={testID} style={atoms.flex1}>
        <SkeletonList variant="post" count={5} testID="feed-skeleton" />
      </View>
    )
  }

  const hasData = feed.data != null && feed.data.pages.some(p => p.items.length > 0)
  if (feed.isError && !hasData) {
    const unavailable = isUnsupportedError(feed.error)
    return (
      <View testID={testID} style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{unavailable ? 'Not on this server.' : 'Could not load recommendations.'}</Body>
        <Caption color="faint">
          {unavailable
            ? 'This server has no recommendations feed.'
            : 'Check your connection and try again.'}
        </Caption>
        <Button label="Retry" variant="secondary" onPress={() => void feed.refetch()} testID="feed-retry" />
      </View>
    )
  }

  return (
    <View testID={testID} style={atoms.flex1}>
      <FlatList
        ref={listRef}
        testID="feed-list"
        data={visibleItems}
        keyExtractor={item => `${sessionId}:${item.id}`}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={RECOMMENDATION_VIEWABILITY_CONFIG}
        onEndReached={onEndReached}
        onEndReachedThreshold={2.5}
        ListHeaderComponent={
          scrollHeader != null ? <View testID="feed-scroll-header">{scrollHeader}</View> : undefined
        }
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={() => {
              flush()
              void feed.refetch()
            }}
            testID="feed-refresh"
            tintColor={theme.palette.muted}
            colors={[theme.palette.muted]}
            progressBackgroundColor={theme.palette.bg}
          />
        }
        renderItem={({item, index}) => (
          <ThreadRow
            post={item}
            sessionId={sessionId}
            capabilities={backend?.capabilities ?? null}
            renoters={collapsed.renotersByRep.get(item.id)}
            connectedAbove={threadLinks.connectedAbove[index] ?? false}
            connectedBelow={threadLinks.connectedBelow[index] ?? false}
            showSeparator={index > 0 && !(threadLinks.connectedAbove[index] ?? false)}
          />
        )}
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
})

function useThreadLinks(links: {connectedAbove: boolean[]; connectedBelow: boolean[]}) {
  return useMemo(() => ({threadLinks: links}), [links])
}
