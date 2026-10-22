// One 1-on-1 chat thread (`/chat/users/:userId`, P6.2 clickstone §2.2):
// the direct messages with one user (newest first, server-paged) + the
// send box. The post-menu DM row lands here with the author's id.
//
// Fetching the timeline marks the thread read server-side (upstream
// behavior — no mark-read control). Live messages arrive through the
// `chatUser` stream channel while mounted (`useChatUserLive`,
// id-deduped into the cache); with no socket the thread still pages +
// refreshes. The title resolves the account when the server packs one —
// the 1-on-1 lite timeline deliberately carries no users, so until the
// account fetch lands the title stays the honest fallback, never a
// guessed name.

import {useCallback, useState} from 'react'
import {View} from 'react-native'
import {useRoute} from '@react-navigation/native'
import {useQuery} from '@tanstack/react-query'

import {isUnsupportedError, type ChatMessage} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {useActiveBackend} from '#/screens/HomeFeed'
import {ChatThread, type ChatThreadData} from '#/screens/ChatThread'
import {
  accountQueryKey,
  chatMessageItems,
  useChatUserLive,
  useChatUserMessagesQuery,
  useDeleteChatMessage,
  useSendChatMessage,
} from '#/state/queries'

export function ChatUserScreen() {
  const {session, backend} = useActiveBackend()
  const route = useRoute()
  const userId = (route.params as {userId?: string} | undefined)?.userId ?? null
  const [sendError, setSendError] = useState<string | null>(null)
  const [deleteState, setDeleteState] = useState<{deletingId: string | null; error: string | null}>({
    deletingId: null,
    error: null,
  })

  const chatApi = backend?.chat
  const capable = backend?.capabilities.direct_messages === 'supported'

  const thread = useChatUserMessagesQuery(session?.id ?? null, userId, {
    backend: backend ?? undefined,
  })
  useChatUserLive(session?.id ?? null, userId, {backend: backend ?? undefined})
  const sendMutation = useSendChatMessage(session?.id ?? null, {backend: backend ?? undefined})
  const deleteMutation = useDeleteChatMessage(session?.id ?? null, {backend: backend ?? undefined})
  const items = chatMessageItems(thread.data)

  // The thread pack carries no users — resolve the title from the account
  // endpoint (cached per session like every other account row). Absent
  // stays the fallback; a failed fetch never blocks the thread.
  const account = useQuery({
    queryKey: accountQueryKey(session?.id ?? 'signed-out', userId ?? ''),
    queryFn: () => backend!.account({id: userId!}),
    enabled: backend != null && session != null && userId != null,
    retry: false,
    staleTime: 60_000,
  })
  const title = account.data
    ? account.data.displayName && account.data.displayName.trim().length > 0
      ? account.data.displayName
      : `@${account.data.acct}`
    : 'Direct message'

  const send = useCallback(
    async (text: string) => {
      if (!userId) throw new Error('No user selected.')
      // The server refuses self-sends (`RECIPIENT_IS_YOURSELF`) — refuse
      // first with the honest reason instead of a doomed write.
      if (session && userId === session.accountId) {
        setSendError('You cannot send a message to yourself.')
        throw new Error('self send refused')
      }
      setSendError(null)
      try {
        await sendMutation.mutateAsync({userId, text})
      } catch {
        setSendError('Could not send the message.')
        throw new Error('send failed')
      }
    },
    [sendMutation, userId, session],
  )

  const remove = useCallback(
    async (message: ChatMessage) => {
      if (deleteState.deletingId) return
      if (!userId) return
      setDeleteState({deletingId: message.id, error: null})
      try {
        await deleteMutation.mutateAsync({userId, messageId: message.id})
      } catch {
        setDeleteState({deletingId: null, error: 'Could not delete the message.'})
      } finally {
        setDeleteState(state => (state.deletingId === message.id ? {...state, deletingId: null} : state))
      }
    },
    [deleteMutation, deleteState.deletingId, userId],
  )

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="chat-user-screen">
        <Pagehead title="Direct message" />
        <Body>Sign in to read your chats.</Body>
        <Caption color="faint">Chats never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  const missing =
    !chatApi || !capable || !userId || (thread.error != null && isUnsupportedError(thread.error))
  if (missing) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="chat-user-screen">
        <Pagehead title="Direct message" />
        <Body>Chat is not available on this server.</Body>
      </View>
    )
  }

  const threadData: ChatThreadData = {
    pages: thread.data,
    items,
    isPending: thread.isPending,
    error: thread.error,
    hasNextPage: thread.hasNextPage ?? false,
    isFetchingNextPage: thread.isFetchingNextPage,
    isFetching: thread.isFetching,
    fetchNextPage: () => void thread.fetchNextPage(),
    refetch: () => void thread.refetch(),
  }

  return (
    <View style={atoms.flex1}>
      <Pagehead title={title} />
      <ChatThread
        testPrefix="chat-user"
        thread={threadData}
        emptyLabel="No messages yet."
        sendLabel="Write a message…"
        sending={sendMutation.isPending}
        sendError={sendError}
        onSend={send}
        viewerAccountId={session.accountId}
        deleteState={deleteState}
        onDelete={message => void remove(message)}
      />
    </View>
  )
}
