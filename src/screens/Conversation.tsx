// One DM thread (`/conversations/:id`, P6.2 clickstone §2.1): the
// participants, the reply chain, and the latest post from domain models
// only. History comes from `backend.thread(lastPost)` — the DM chain is a
// reply chain, and neither server exposes a conversation-statuses endpoint
// on `/api/v1`, so nothing is invented. Replying navigates to the composer
// with the last post as context (the existing status-post path; the
// composer already defaults a direct parent to direct + recipients, so no
// compose code is duplicated here). Opening the thread marks it read once
// (the server owns the flag; the inbox refetches through the mutation's
// invalidation). Delete is two-step confirmed and goes back on success.

import {useEffect, useRef, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, useRoute, type NavigationProp} from '@react-navigation/native'

import {isUnsupportedError, type Post} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {conversationTitle} from '#/screens/Conversations'
import {
  useConversationQuery,
  useDeleteConversation,
  useMarkConversationRead,
} from '#/state/queries'

function ThreadPost({post}: {post: Post}) {
  const author =
    post.author.displayName && post.author.displayName.trim().length > 0
      ? post.author.displayName
      : `@${post.author.acct}`
  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
      <Caption color="faint">{author}</Caption>
      <Body>{post.content.plain}</Body>
    </View>
  )
}

export function ConversationScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const route = useRoute()
  const id = (route.params as {id?: string} | undefined)?.id ?? null
  const [ancestors, setAncestors] = useState<Post[] | null>(null)
  const [threadError, setThreadError] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const markedRef = useRef<string | null>(null)

  const conversationsApi = backend?.conversations
  const capable = backend?.capabilities.direct_messages === 'supported'

  const thread = useConversationQuery(session?.id ?? null, id, {backend: backend ?? undefined})
  const markRead = useMarkConversationRead(session?.id ?? null, {backend: backend ?? undefined})
  const remove = useDeleteConversation(session?.id ?? null, {backend: backend ?? undefined})
  const conversation = thread.data ?? null
  const lastPost = conversation?.lastPost ?? null

  // History for the DM chain (reply ancestors of the latest post).
  useEffect(() => {
    let live = true
    setAncestors(null)
    setThreadError(false)
    const post = thread.data?.lastPost ?? null
    if (!backend || !post) return
    void backend
      .thread(post)
      .then(res => {
        if (live) setAncestors(res.ancestors)
      })
      .catch(() => {
        if (live) setThreadError(true)
      })
    return () => {
      live = false
    }
  }, [backend, thread.data])

  // Mark-read runs once per opened thread, only while the server says
  // unread — an already-read thread sends no write.
  useEffect(() => {
    if (!conversation || !conversation.unread || !id) return
    if (markedRef.current === id) return
    markedRef.current = id
    void markRead.mutateAsync(id).catch(() => {
      // A failed mark-read never blocks the thread; the unread flag simply
      // refetches as unread. No error wall for a best-effort write.
    })
    // Mark-read is a fire-once effect per thread, not a render input;
    // `markRead` is the stable mutation object from the hook.
  }, [conversation, id])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="conversation-screen">
        <Pagehead title="Conversation" />
        <Body>Sign in to read your messages.</Body>
        <Caption color="faint">Messages never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (!conversationsApi || !capable || !id || (thread.error != null && isUnsupportedError(thread.error))) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="conversation-screen">
        <Pagehead title="Conversation" />
        <Body>Messages are not available on this server.</Body>
      </View>
    )
  }

  const onDelete = async () => {
    if (deleting || !id) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await remove.mutateAsync(id)
      navigation.goBack()
    } catch {
      setDeleteError('Could not delete the conversation.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <View style={atoms.flex1} testID="conversation-screen">
      <Pagehead title={conversation ? conversationTitle(conversation) : 'Conversation'} />
      {deleteError ? <Caption color="faint">{deleteError}</Caption> : null}
      {thread.isPending ? (
        <SkeletonList variant="row" testID="conversation-loading" />
      ) : thread.error || !conversation ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load this conversation.</Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => void thread.refetch()}
            testID="conversation-retry"
          />
        </View>
      ) : (
        <FlatList
          data={lastPost ? [...(ancestors ?? []), lastPost] : []}
          keyExtractor={item => item.id}
          renderItem={({item}) => <ThreadPost post={item} />}
          refreshControl={
            <RefreshControl
              refreshing={thread.isFetching && !thread.isPending}
              onRefresh={() => void thread.refetch()}
              testID="conversation-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListEmptyComponent={
            threadError ? (
              <View style={[atoms.centered, atoms.p_md]}>
                <Body>Could not load the message history.</Body>
              </View>
            ) : (
              <View style={[atoms.centered, atoms.p_md]}>
                <Body>No messages yet.</Body>
              </View>
            )
          }
        />
      )}
      {conversation && !thread.isPending && !thread.error ? (
        <View style={[atoms.px_md, atoms.py_sm, atoms.row, atoms.gap_sm]}>
          <Button
            label="Reply"
            variant="secondary"
            onPress={() => {
              if (lastPost) navigation.navigate('Compose', {replyToId: lastPost.id})
            }}
            testID="conversation-reply"
          />
          {confirmingDelete ? (
            <>
              <Button
                label={deleting ? 'Deleting…' : 'Delete conversation'}
                variant="secondary"
                disabled={deleting}
                onPress={() => void onDelete()}
                testID="conversation-confirm-delete"
              />
              <Button
                label="Cancel"
                variant="secondary"
                disabled={deleting}
                onPress={() => setConfirmingDelete(false)}
                testID="conversation-cancel-delete"
              />
            </>
          ) : (
            <Button
              label="Delete"
              variant="secondary"
              onPress={() => setConfirmingDelete(true)}
              testID="conversation-delete"
            />
          )}
        </View>
      ) : null}
    </View>
  )
}
