// Profile Pages tab content (P6.5 Pages, slice 3): `users/pages` for the
// profile owner, paged, honest empty state. Remote users get the tab with
// an empty state when the server returns none (plan O4 default).

import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {PageCard} from '#/components/Page/PageCard'
import {SkeletonList} from '#/components/Skeleton'
import {i18n} from '#/locale/i18n'
import {msg} from '@lingui/macro'
import {FlatList} from 'react-native'
import {useActiveBackend} from '#/screens/HomeFeed'
import {usePagesByUser} from '#/state/queries/pages'

export function ProfilePages({
  userId,
  testID,
}: {
  userId: string
  testID?: string
}) {
  const {session, backend} = useActiveBackend()
  const sessionId = session?.id ?? null
  const list = usePagesByUser(sessionId, userId, backend ? {backend} : {})
  const items = (list.data?.pages ?? []).flatMap(p => p.items)

  if (list.isPending) {
    return <SkeletonList variant="row" testID={testID ? `${testID}-loading` : undefined} />
  }
  if (list.isError || !list.data) {
    return (
      <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]} testID={testID}>
        <Body>{i18n._(msg`Could not load pages.`)}</Body>
        <Caption color="faint">{i18n._(msg`Check your connection and try again.`)}</Caption>
        <Button
          label={i18n._(msg`Retry`)}
          variant="secondary"
          onPress={() => void list.refetch()}
          testID={testID ? `${testID}-retry` : undefined}
        />
      </View>
    )
  }
  if (items.length === 0) {
    return (
      <View style={[atoms.centered, atoms.p_md]} testID={testID ? `${testID}-empty` : testID}>
        <Body>{i18n._(msg`No pages yet.`)}</Body>
      </View>
    )
  }
  return (
    <FlatList
      data={items}
      keyExtractor={item => item.id}
      renderItem={({item}) => <PageCard page={item} testID={testID ? `${testID}-${item.id}` : undefined} />}
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
      }}
      onEndReachedThreshold={0.5}
      ListFooterComponent={list.isFetchingNextPage ? <Loader testID={testID ? `${testID}-more` : undefined} /> : null}
      testID={testID}
    />
  )
}
