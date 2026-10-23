// DM inbox (`/conversations`, P6.2 clickstone §2.1): the conversations the
// Mastodon-family server packs (`/api/v1/conversations`), newest first.
//
// Gated on `capabilities.direct_messages === "supported"` AND a present
// `conversations` module: pleroma/unknown and the Misskey family get the
// honest "not available" state, never an empty list pretending the server
// has no DMs. Rows are domain models only (participants + latest post +
// server unread flag); opening a row navigates to the thread, which owns
// the mark-read. Delete is two-step confirmed and server-side — the row
// disappears through invalidation + refetch, never a local prune.
//
// List state runs through the session-scoped conversation queries
// (`conversationsQueryKey` — sessionId first), so switching accounts never
// serves the previous account's inbox.

import {useCallback, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {isUnsupportedError, type Conversation, type Cursor} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {
  conversationItems,
  useConversationsQuery,
  useDeleteConversation,
  CONVERSATIONS_PAGE_LIMIT,
} from '#/state/queries'

/** Participant line: display names, falling back to the handle. Pure. */
export function conversationTitle(conversation: Conversation): string {
  const names = conversation.accounts.map(a =>
    a.displayName && a.displayName.trim().length > 0 ? a.displayName : `@${a.acct}`,
  )
  return names.length > 0 ? names.join(', ') : 'Direct message'
}

function ConversationRow({
  conversation,
  onOpen,
  onDelete,
  deleting,
}: {
  conversation: Conversation
  onOpen: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const snippet = conversation.lastPost?.content.plain.trim() || 'No messages yet.'
  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`conversations-row-${conversation.id}`}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={`${conversationTitle(conversation)}. Open conversation.`}
        testID={`conversations-open-${conversation.id}`}>
        <Body>{conversationTitle(conversation)}</Body>
      </Pressable>
      <Caption color="faint" numberOfLines={2}>
        {snippet}
      </Caption>
      <View style={[atoms.row, atoms.gap_sm]}>
        {conversation.unread ? <Caption color="faint">Unread</Caption> : null}
        <View style={{flex: 1}} />
        {confirming ? (
          <>
            <Button
              label={deleting ? 'Deleting…' : 'Delete conversation'}
              variant="secondary"
              disabled={deleting}
              onPress={onDelete}
              testID={`conversations-confirm-${conversation.id}`}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={deleting}
              onPress={() => setConfirming(false)}
              testID={`conversations-cancel-${conversation.id}`}
            />
          </>
        ) : (
          <Button
            label="Delete"
            variant="secondary"
            onPress={() => setConfirming(true)}
            testID={`conversations-delete-${conversation.id}`}
          />
        )}
      </View>
    </View>
  )
}

export function ConversationsScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const conversationsApi = backend?.conversations
  const capable = backend?.capabilities.direct_messages === 'supported'

  const list = useConversationsQuery(session?.id ?? null, {backend: backend ?? undefined})
  const deleteMutation = useDeleteConversation(session?.id ?? null, {backend: backend ?? undefined})
  const items = conversationItems(list.data)

  const loadMore = useCallback(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
  }, [list])

  const remove = useCallback(
    async (id: string) => {
      if (deletingId) return
      setDeletingId(id)
      setDeleteError(null)
      try {
        await deleteMutation.mutateAsync(id)
      } catch {
        setDeleteError('Could not delete the conversation.')
      } finally {
        setDeletingId(null)
      }
    },
    [deleteMutation, deletingId],
  )

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="conversations-screen">
        <Pagehead title="Messages" />
        <Body>Sign in to read your messages.</Body>
        <Caption color="faint">Messages never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  // `unknown` deliberately does not unlock the inbox: an unverified fork
  // gets the same honest answer as one with no conversations endpoint.
  // A 404/405 from the list call means the same (a fork without the
  // routes); anything else is a retryable error, never a fake answer.
  const missing = !conversationsApi || !capable || (list.error != null && isUnsupportedError(list.error))
  if (missing) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="conversations-screen">
        <Pagehead title="Messages" />
        <Body>Messages are not available on this server.</Body>
        <Caption color="faint">
          This server does not provide the DM inbox Keystone reads, or this build has it disabled.
        </Caption>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="conversations-screen">
      <Pagehead title="Messages" />
      {deleteError ? <Caption color="faint">{deleteError}</Caption> : null}
      {list.isPending ? (
        <SkeletonList variant="account" testID="conversations-loading" />
      ) : list.error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load messages.</Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => void list.refetch()}
            testID="conversations-retry"
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <ConversationRow
              conversation={item}
              onOpen={() => navigation.navigate('Conversation', {id: item.id})}
              onDelete={() => void remove(item.id)}
              deleting={deletingId === item.id}
            />
          )}
          onEndReached={() => loadMore()}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={list.isFetching && !list.isPending}
              onRefresh={() => void list.refetch()}
              testID="conversations-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>No conversations yet.</Body>
            </View>
          }
        />
      )}
    </View>
  )
}
