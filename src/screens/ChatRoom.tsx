// One chat room thread (`/chat/rooms/:roomId`, P6.2 clickstone §2.2):
// the room's messages (newest first, server-paged) + the send box.
//
// Fetching the timeline marks the room read server-side (upstream
// behavior — there is deliberately no mark-read control). Live messages
// arrive through the `chatRoom` stream channel while mounted
// (`useChatRoomLive`, id-deduped into the cache); with no socket the
// thread still pages + refreshes. Same gate states as the room list:
// signed out, unsupported (old stock release / wrong family), error with
// retry.

import {useCallback, useState} from 'react'
import {View} from 'react-native'
import {useRoute} from '@react-navigation/native'

import {isUnsupportedError, type ChatMessage} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {useActiveBackend} from '#/screens/HomeFeed'
import {ChatThread, type ChatThreadData} from '#/screens/ChatThread'
import {
  chatMessageItems,
  useChatRoomLive,
  useChatRoomMessagesQuery,
  useChatRoomQuery,
  useDeleteChatMessage,
  useSendChatMessage,
} from '#/state/queries'

export function ChatRoomScreen() {
  const {session, backend} = useActiveBackend()
  const route = useRoute()
  const roomId = (route.params as {roomId?: string} | undefined)?.roomId ?? null
  const [sendError, setSendError] = useState<string | null>(null)
  const [deleteState, setDeleteState] = useState<{deletingId: string | null; error: string | null}>({
    deletingId: null,
    error: null,
  })

  const chatApi = backend?.chat
  const capable = backend?.capabilities.direct_messages === 'supported'

  const room = useChatRoomQuery(session?.id ?? null, roomId, {backend: backend ?? undefined})
  const thread = useChatRoomMessagesQuery(session?.id ?? null, roomId, {
    backend: backend ?? undefined,
  })
  useChatRoomLive(session?.id ?? null, roomId, {backend: backend ?? undefined})
  const sendMutation = useSendChatMessage(session?.id ?? null, {backend: backend ?? undefined})
  const deleteMutation = useDeleteChatMessage(session?.id ?? null, {backend: backend ?? undefined})
  const items = chatMessageItems(thread.data)

  const send = useCallback(
    async (text: string) => {
      if (!roomId) throw new Error('No room selected.')
      setSendError(null)
      try {
        await sendMutation.mutateAsync({roomId, text})
      } catch {
        setSendError('Could not send the message.')
        throw new Error('send failed')
      }
    },
    [sendMutation, roomId],
  )

  const remove = useCallback(
    async (message: ChatMessage) => {
      if (deleteState.deletingId) return
      // `roomId` is non-null past the gate below; the callback is only
      // reachable from a rendered thread.
      if (!roomId) return
      setDeleteState({deletingId: message.id, error: null})
      try {
        await deleteMutation.mutateAsync({roomId, messageId: message.id})
      } catch {
        setDeleteState({deletingId: null, error: 'Could not delete the message.'})
      } finally {
        setDeleteState(state => (state.deletingId === message.id ? {...state, deletingId: null} : state))
      }
    },
    [deleteMutation, deleteState.deletingId, roomId],
  )

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="chat-room-screen">
        <Pagehead title="Chat room" />
        <Body>Sign in to read your chats.</Body>
        <Caption color="faint">Chats never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  const missing =
    !chatApi || !capable || !roomId || (thread.error != null && isUnsupportedError(thread.error))
  if (missing) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="chat-room-screen">
        <Pagehead title="Chat room" />
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
      <Pagehead title={room.data?.name ?? 'Chat room'} />
      <ChatThread
        testPrefix="chat-room"
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
