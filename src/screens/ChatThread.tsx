// Shared chat thread (P6.2 clickstone §2.2): the message list + send box
// behind both the room screen (`ChatRoom`) and the 1-on-1 screen
// (`ChatUser`). Domain models only; the caller owns the query keys and
// the live subscription.
//
// - History pages through the caller's infinite query (both directions,
//   session-scoped keys); fetching marks read server-side, so there is no
//   mark-read control here.
// - Sending is text-only this slice (the wire `fileId` stays available
//   for a follow-up; the box never pretends to attach files).
// - Delete is offered only on the viewer's own messages (two-step
//   confirmed, server-side; the row disappears through invalidation +
//   refetch, never a local prune).

import {useState} from 'react'
import {FlatList, RefreshControl, TextInput, View} from 'react-native'
import type {InfiniteData} from '@tanstack/react-query'

import type {ChatMessage, Page} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'

/** Author line: packed name, else handle, else a stable id suffix — never
 * an invented name. Pure. */
export function chatMessageAuthor(message: ChatMessage): string {
  const account = message.fromAccount
  if (account) {
    if (account.displayName && account.displayName.trim().length > 0) return account.displayName
    return `@${account.acct}`
  }
  return `…${message.fromAccountId.slice(-6)}`
}

function ChatMessageRow({
  message,
  mine,
  deleting,
  onDelete,
}: {
  message: ChatMessage
  mine: boolean
  deleting: boolean
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`chat-message-${message.id}`}>
      <Caption color="faint">{chatMessageAuthor(message)}</Caption>
      {message.text ? <Body>{message.text}</Body> : null}
      {mine ? (
        <View style={[atoms.row, atoms.gap_sm]}>
          <View style={{flex: 1}} />
          {confirming ? (
            <>
              <Button
                label={deleting ? 'Deleting…' : 'Delete message'}
                variant="secondary"
                disabled={deleting}
                onPress={onDelete}
                testID={`chat-delete-confirm-${message.id}`}
              />
              <Button
                label="Cancel"
                variant="secondary"
                disabled={deleting}
                onPress={() => setConfirming(false)}
                testID={`chat-delete-cancel-${message.id}`}
              />
            </>
          ) : (
            <Button
              label="Delete"
              variant="secondary"
              onPress={() => setConfirming(true)}
              testID={`chat-delete-${message.id}`}
            />
          )}
        </View>
      ) : null}
    </View>
  )
}

export interface ChatThreadData {
  pages: InfiniteData<Page<ChatMessage>> | undefined
  items: ChatMessage[]
  isPending: boolean
  error: unknown
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetching: boolean
  fetchNextPage: () => void
  refetch: () => void
}

export function ChatThread({
  testPrefix,
  thread,
  emptyLabel,
  sendLabel,
  sending,
  sendError,
  onSend,
  viewerAccountId,
  deleteState,
  onDelete,
}: {
  /** testID prefix (`chat-room` / `chat-user`). */
  testPrefix: string
  thread: ChatThreadData
  emptyLabel: string
  sendLabel: string
  sending: boolean
  sendError: string | null
  onSend: (text: string) => Promise<void>
  /** The viewer's account id — delete shows only on matching senders. */
  viewerAccountId: string | null
  deleteState: {deletingId: string | null; error: string | null}
  onDelete: (message: ChatMessage) => void
}) {
  const theme = useTheme()
  const [draft, setDraft] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setLocalError(null)
    try {
      await onSend(text)
      setDraft('')
    } catch {
      setLocalError('Could not send the message.')
    }
  }

  return (
    <View style={atoms.flex1} testID={`${testPrefix}-screen`}>
      {thread.isPending ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Caption color="faint">Loading…</Caption>
        </View>
      ) : thread.error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load messages.</Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => thread.refetch()}
            testID={`${testPrefix}-retry`}
          />
        </View>
      ) : (
        <FlatList
          data={thread.items}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <ChatMessageRow
              message={item}
              mine={viewerAccountId != null && item.fromAccountId === viewerAccountId}
              deleting={deleteState.deletingId === item.id}
              onDelete={() => onDelete(item)}
            />
          )}
          onEndReached={() => {
            if (thread.hasNextPage && !thread.isFetchingNextPage) thread.fetchNextPage()
          }}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={thread.isFetching && !thread.isPending}
              onRefresh={() => thread.refetch()}
              testID={`${testPrefix}-refresh`}
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>{emptyLabel}</Body>
            </View>
          }
        />
      )}
      {deleteState.error ? <Caption color="faint">{deleteState.error}</Caption> : null}
      {sendError ? <Caption color="faint">{sendError}</Caption> : null}
      {localError ? <Caption color="faint">{localError}</Caption> : null}
      <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]}>
        <TextInput
          style={{flex: 1}}
          value={draft}
          onChangeText={setDraft}
          placeholder={sendLabel}
          editable={!sending}
          multiline
          testID={`${testPrefix}-input`}
        />
        <Button
          label={sending ? 'Sending…' : 'Send'}
          disabled={sending || draft.trim().length === 0}
          disabledReason={draft.trim().length === 0 ? 'Write a message first.' : undefined}
          onPress={() => void send()}
          testID={`${testPrefix}-send`}
        />
      </View>
    </View>
  )
}
