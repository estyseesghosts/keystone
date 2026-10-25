// Chat room list (`/chat`, P6.2 clickstone §2.2): the Misskey rooms the
// viewer joined (`Backend.chat.rooms`), newest membership first.
//
// Gated on `capabilities.direct_messages === "supported"` AND a present
// `chat` module: catodon/pinetree and the Mastodon family get the honest
// "not available" state, never an empty list pretending the server has no
// rooms. Rows are domain models only; opening a row navigates to the room
// thread, which marks read on fetch (there is no separate mark call —
// the timeline fetch IS the server-side mark). The sweep (`readAll`) is
// two-step confirmed and server-side — rows refresh through invalidation
// + refetch, never a local prune.
//
// List state runs through the session-scoped chat queries
// (`chatRoomsQueryKey` — sessionId first), so switching accounts never
// serves the previous account's rooms.

import {useCallback, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {msg} from '@lingui/macro'

import {isUnsupportedError} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import {i18n} from '#/locale/i18n'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {
  chatRoomItems,
  useChatRoomsQuery,
  useReadAllChat,
} from '#/state/queries'
import type {ChatRoomMembership} from '@keystone/fedi'

function membershipTitle(membership: ChatRoomMembership): string {
  const name = membership.room?.name.trim()
  return name && name.length > 0 ? name : i18n._(msg`Unnamed room`)
}

function membershipSubtitle(membership: ChatRoomMembership): string {
  const description = membership.room?.description?.trim()
  if (description && description.length > 0) return description
  const owner = membership.room?.owner
  if (owner) {
    const shown =
      owner.displayName && owner.displayName.trim().length > 0 ? owner.displayName : `@${owner.acct}`
    return i18n._(msg`by ${shown}`)
  }
  return i18n._(msg`No description.`)
}

function ChatRoomRow({
  membership,
  onOpen,
}: {
  membership: ChatRoomMembership
  onOpen: () => void
}) {
  const room = membership.room
  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`chatrooms-row-${membership.id}`}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={i18n._(msg`${membershipTitle(membership)}. Open chat room.`)}
        testID={`chatrooms-open-${room?.id ?? membership.id}`}>
        <Body>{membershipTitle(membership)}</Body>
      </Pressable>
      <Caption color="faint" numberOfLines={2}>
        {membershipSubtitle(membership)}
      </Caption>
    </View>
  )
}

export function ChatRoomsScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const [confirmingReadAll, setConfirmingReadAll] = useState(false)
  const [readAllError, setReadAllError] = useState<string | null>(null)

  const chatApi = backend?.chat
  const capable = backend?.capabilities.direct_messages === 'supported'

  const list = useChatRoomsQuery(session?.id ?? null, {backend: backend ?? undefined})
  const readAll = useReadAllChat(session?.id ?? null, {backend: backend ?? undefined})
  const items = chatRoomItems(list.data)

  const loadMore = useCallback(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
  }, [list])

  const runReadAll = useCallback(async () => {
    setReadAllError(null)
    try {
      await readAll.mutateAsync()
    } catch {
      setReadAllError(i18n._(msg`Could not mark chats read.`))
    } finally {
      setConfirmingReadAll(false)
    }
  }, [readAll])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="chatrooms-screen">
        <Pagehead title={i18n._(msg`Chat`)} />
        <Body>{i18n._(msg`Sign in to read your chats.`)}</Body>
        <Caption color="faint">{i18n._(msg`Chats never show sample data when signed out.`)}</Caption>
        <SignInButton />
      </View>
    )
  }

  // `unknown` deliberately does not unlock the list: an unverified fork
  // gets the same honest answer as one with no `chat/*` endpoints. A
  // 404/405 from the list call means the same (an old stock release);
  // anything else is a retryable error, never a fake answer.
  const missing =
    !chatApi || !capable || (list.error != null && isUnsupportedError(list.error))
  if (missing) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="chatrooms-screen">
        <Pagehead title={i18n._(msg`Chat`)} />
        <Body>{i18n._(msg`Chat is not available on this server.`)}</Body>
        <Caption color="faint">
          {i18n._(
            msg`This server does not provide the chat rooms Keystone reads, or this build has them disabled.`,
          )}
        </Caption>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="chatrooms-screen">
      <Pagehead title={i18n._(msg`Chat`)} />
      {readAllError ? <Caption color="faint">{readAllError}</Caption> : null}
      {list.isPending ? (
        <SkeletonList variant="row" testID="chatrooms-loading" />
      ) : list.error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Could not load chats.`)}</Body>
          <Button
            label={i18n._(msg`Retry`)}
            variant="secondary"
            onPress={() => void list.refetch()}
            testID="chatrooms-retry"
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <ChatRoomRow
              membership={item}
              onOpen={() => {
                if (item.room) navigation.navigate('ChatRoom', {roomId: item.room.id})
              }}
            />
          )}
          onEndReached={() => loadMore()}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={list.isFetching && !list.isPending}
              onRefresh={() => void list.refetch()}
              testID="chatrooms-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListHeaderComponent={
            items.length > 0 ? (
              <View style={[atoms.px_md, atoms.py_sm]}>
                {confirmingReadAll ? (
                  <View style={[atoms.row, atoms.gap_sm]}>
                    <Button
                      label={readAll.isPending ? i18n._(msg`Marking…`) : i18n._(msg`Mark all read`)}
                      variant="secondary"
                      disabled={readAll.isPending}
                      onPress={() => void runReadAll()}
                      testID="chatrooms-readall-confirm"
                    />
                    <Button
                      label={i18n._(msg`Cancel`)}
                      variant="secondary"
                      disabled={readAll.isPending}
                      onPress={() => setConfirmingReadAll(false)}
                      testID="chatrooms-readall-cancel"
                    />
                  </View>
                ) : (
                  <Button
                    label={i18n._(msg`Mark all read`)}
                    variant="secondary"
                    onPress={() => setConfirmingReadAll(true)}
                    testID="chatrooms-readall"
                  />
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>{i18n._(msg`No chat rooms yet.`)}</Body>
            </View>
          }
        />
      )}
    </View>
  )
}
