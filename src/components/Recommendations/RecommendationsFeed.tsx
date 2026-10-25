import {forwardRef, useCallback, useImperativeHandle, useMemo, useRef, type ReactNode} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {msg} from '@lingui/macro'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {SkeletonList} from '#/components/Skeleton'
import {ThreadRow} from '#/components/PostFeed/ThreadRow'
import {useRecommendationDwell, RECOMMENDATION_VIEWABILITY_CONFIG} from '#/lib/recommendationDwell'
import {useLocale, useI18n} from '#/locale/i18n'
import {collapseReposts, computeFeedThreadLinks, isUnsupportedError, type Backend} from '@keystone/fedi'
import {feedItems, usePostFeedQuery} from '#/state/queries'
import {useBackendForSessionId} from '#/screens/HomeFeed'
import {recommendationFeedParams, useRecommendationSettings} from '#/state/queries/recommendations'
import {filterModerated, filterSoftMuted, useModerationRules, useSoftMutedIds} from '#/state/queries'
import {usePagedLoad, useRefreshFirstPage} from '#/state/queries/usePagedLoad'

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
  const i18n = useI18n()
  const {settings} = useRecommendationSettings(sessionId)
  // Same resolution as FeedView: the injected prop wins (tests,
  // per-column accounts); otherwise the session's own backend, so
  // capabilities and dwell never see a null-backend fallback.
  const storeBackend = useBackendForSessionId(sessionId)
  const resolved = backend !== undefined ? backend : storeBackend
  const rec = useMemo(
    () => recommendationFeedParams(locale, settings),
    [locale, settings],
  )
  const feed = usePostFeedQuery(sessionId, 'recommendations', {
    ...(resolved ? {backend: resolved} : {}),
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
  const {onViewableItemsChanged, flush} = useRecommendationDwell(sessionId, resolved ?? null)

  // Paging (X3.3): the shared gate — a failed page or a 429 cooldown never
  // loops; only the footer Retry fetches again. Refresh trims to the first
  // page first (one request, not N).
  const paged = usePagedLoad(feed)
  const refreshFirst = useRefreshFirstPage(feed.queryKey, feed.refetch)
  const onRefresh = useCallback(() => {
    flush()
    refreshFirst()
  }, [flush, refreshFirst])

  useImperativeHandle(ref, () => ({
    reload: () => {
      flush()
      refreshFirst()
    },
    scrollToTop: () => listRef.current?.scrollToOffset({offset: 0, animated: true}),
  }))

  const onEndReached = paged.onEndReached

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
        <Body>{unavailable ? i18n._(msg`Not on this server.`) : i18n._(msg`Could not load recommendations.`)}</Body>
        <Caption color="faint">
          {unavailable
            ? i18n._(msg`This server has no recommendations feed.`)
            : i18n._(msg`Check your connection and try again.`)}
        </Caption>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => void feed.refetch()} testID="feed-retry" />
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
            onRefresh={onRefresh}
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
            capabilities={resolved?.capabilities ?? null}
            renoters={collapsed.renotersByRep.get(item.id)}
            connectedAbove={threadLinks.connectedAbove[index] ?? false}
            connectedBelow={threadLinks.connectedBelow[index] ?? false}
            showSeparator={index > 0 && !(threadLinks.connectedAbove[index] ?? false)}
          />
        )}
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
              {paged.cooldownLabel ? (
                <Caption color="faint" testID="feed-more-cooldown">
                  {paged.cooldownLabel}
                </Caption>
              ) : null}
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
})

function useThreadLinks(links: {connectedAbove: boolean[]; connectedBelow: boolean[]}) {
  return useMemo(() => ({threadLinks: links}), [links])
}
