// Pages index (P6.5 Pages, slice 3): Featured | My pages | Liked.
// Featured is a single public fetch; mine/liked page through the cursor.
// My/Liked hide where `mine`/`liked` are absent (Pinetree) with one line
// saying why. Header `+` opens the editor (slice 4 owns the screen).

import {useState} from 'react'
import {FlatList, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'
import {msg} from '@lingui/macro'

import type {PageModel} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {PageCard} from '#/components/Page/PageCard'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {SkeletonList} from '#/components/Skeleton'
import {Tabs} from '#/components/Tabs'
import {i18n} from '#/locale/i18n'
import {errorText} from '#/lib/localeErrors'
import {useActiveBackend} from '#/screens/HomeFeed'
import type {RootParamList} from '#/routes'
import {useFeaturedPages, useLikedPages, useMyPages} from '#/state/queries/pages'

type IndexTab = 'featured' | 'mine' | 'liked'

function PageList({
  items,
  empty,
  testID,
  onEndReached,
  refreshing,
  onRefresh,
}: {
  items: PageModel[]
  empty: string
  testID: string
  onEndReached?: () => void
  refreshing?: boolean
  onRefresh?: () => void
}) {
  if (items.length === 0) {
    return (
      <View style={[atoms.centered, atoms.p_md]} testID={`${testID}-empty`}>
        <Body>{empty}</Body>
      </View>
    )
  }
  return (
    <FlatList
      data={items}
      keyExtractor={item => item.id}
      renderItem={({item}) => <PageCard page={item} testID={`${testID}-${item.id}`} />}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshing={refreshing}
      onRefresh={onRefresh}
      testID={testID}
    />
  )
}

function FeaturedTab({sessionId, testID}: {sessionId: string; testID: string}) {
  const {backend} = useActiveBackend()
  const featured = useFeaturedPages(sessionId, backend ? {backend} : {})
  if (featured.isPending) return <SkeletonList variant="row" testID={`${testID}-loading`} />
  if (featured.isError)
    return (
      <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{i18n._(msg`Could not load featured pages.`)}</Body>
        <Caption color="faint">{errorText(i18n, featured.error, '')}</Caption>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => void featured.refetch()} testID={`${testID}-retry`} />
      </View>
    )
  return (
    <PageList
      items={featured.data ?? []}
      empty={i18n._(msg`No featured pages right now.`)}
      testID={testID}
      refreshing={featured.isRefetching}
      onRefresh={() => void featured.refetch()}
    />
  )
}

function MineTab({sessionId, testID}: {sessionId: string; testID: string}) {
  const {backend} = useActiveBackend()
  const mine = useMyPages(sessionId, backend ? {backend} : {})
  const items = (mine.data?.pages ?? []).flatMap(p => p.items)
  if (mine.isPending) return <SkeletonList variant="row" testID={`${testID}-loading`} />
  if (mine.isError)
    return (
      <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{i18n._(msg`Could not load your pages.`)}</Body>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => void mine.refetch()} testID={`${testID}-retry`} />
      </View>
    )
  return (
    <View style={atoms.flex1}>
      <PageList
        items={items}
        empty={i18n._(msg`You haven't created any pages yet.`)}
        testID={testID}
        onEndReached={() => {
          if (mine.hasNextPage && !mine.isFetchingNextPage) void mine.fetchNextPage()
        }}
        refreshing={mine.isRefetching}
        onRefresh={() => void mine.refetch()}
      />
      {mine.isFetchingNextPage ? <Loader testID={`${testID}-more`} /> : null}
    </View>
  )
}

function LikedTab({sessionId, testID}: {sessionId: string; testID: string}) {
  const {backend} = useActiveBackend()
  const liked = useLikedPages(sessionId, backend ? {backend} : {})
  const items = (liked.data?.pages ?? []).flatMap(p => p.items)
  if (liked.isPending) return <SkeletonList variant="row" testID={`${testID}-loading`} />
  if (liked.isError)
    return (
      <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{i18n._(msg`Could not load liked pages.`)}</Body>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => void liked.refetch()} testID={`${testID}-retry`} />
      </View>
    )
  return (
    <View style={atoms.flex1}>
      <PageList
        items={items}
        empty={i18n._(msg`You haven't liked any pages yet.`)}
        testID={testID}
        onEndReached={() => {
          if (liked.hasNextPage && !liked.isFetchingNextPage) void liked.fetchNextPage()
        }}
        refreshing={liked.isRefetching}
        onRefresh={() => void liked.refetch()}
      />
      {liked.isFetchingNextPage ? <Loader testID={`${testID}-more`} /> : null}
    </View>
  )
}

export function PagesScreen() {
  const {session, backend} = useActiveBackend()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const sessionId = session?.id ?? null
  const [tab, setTab] = useState<IndexTab>('featured')
  const canUsePages = backend?.pages != null
  const showMine = backend?.pages?.mine != null
  const showLiked = backend?.pages?.liked != null

  if (!sessionId || !backend) {
    return (
      <View testID="pages-screen" style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Pagehead title={i18n._(msg`Pages`)} />
        <Body>{i18n._(msg`Sign in to see pages.`)}</Body>
        <SignInButton />
      </View>
    )
  }

  if (!canUsePages) {
    return (
      <View testID="pages-screen" style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Pagehead title={i18n._(msg`Pages`)} />
        <Body>{i18n._(msg`Pages are not available on this server.`)}</Body>
        <Caption color="faint">{i18n._(msg`This server has no Pages feature.`)}</Caption>
      </View>
    )
  }

  const visibleTabs: IndexTab[] = ['featured', ...(showMine ? ['mine' as const] : []), ...(showLiked ? ['liked' as const] : [])]
  const active: IndexTab = visibleTabs.includes(tab) ? tab : 'featured'
  const labels: Record<IndexTab, string> = {
    featured: i18n._(msg`Featured`),
    mine: i18n._(msg`My pages`),
    liked: i18n._(msg`Liked`),
  }
  return (
    <View testID="pages-screen" style={atoms.flex1}>
      <Pagehead title={i18n._(msg`Pages`)} />
      <View style={[atoms.row, atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
        <View style={atoms.flex1}>
          <Tabs
            tabs={visibleTabs.map(t => ({key: t, label: labels[t]}))}
            active={active}
            onChange={setTab}
            testID="pages-tabs"
            testIDPrefix="pages-tab"
            accessibilityLabel={i18n._(msg`Pages lists`)}
          />
        </View>
        <Button
          label={i18n._(msg`New`)}
          variant="primary"
          onPress={() => navigation.navigate('PageEdit')}
          testID="pages-new"
        />
      </View>
      {!showMine && !showLiked ? (
        <Caption color="faint" testID="pages-personal-unavailable">
          {i18n._(msg`This server doesn't provide personal page lists.`)}
        </Caption>
      ) : !showMine ? (
        <Caption color="faint" testID="pages-personal-unavailable">
          {i18n._(msg`This server doesn't provide your page list.`)}
        </Caption>
      ) : !showLiked ? (
        <Caption color="faint" testID="pages-personal-unavailable">
          {i18n._(msg`This server doesn't provide liked pages.`)}
        </Caption>
      ) : null}
      {active === 'featured' ? (
        <FeaturedTab sessionId={sessionId} testID="pages-featured" />
      ) : active === 'mine' ? (
        <MineTab sessionId={sessionId} testID="pages-mine" />
      ) : (
        <LikedTab sessionId={sessionId} testID="pages-liked" />
      )}
    </View>
  )
}
