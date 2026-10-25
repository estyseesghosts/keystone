// Shared chat thread (P6.2 clickstone §2.2): the message list + send box
// behind both the room screen (`ChatRoom`) and the 1-on-1 screen
// (`ChatUser`). Domain models only; the caller owns the query keys and
// the live subscription.
//
// - History pages through the caller's infinite query (both directions,
//   session-scoped keys); fetching marks read server-side, so there is no
//   mark-read control here.
// - Sending is text-only this slice (the wire `fileId` stays available
//   for a follow-up; the box never pretends to attach files). Receiving
//   renders the attachment (name + open/download via the packed file URL);
//   a text-null message is never an empty author line.
// - Delete is offered only on the viewer's own messages (two-step
//   confirmed, server-side; the row disappears through invalidation +
//   refetch, never a local prune).

import {useCallback, useState} from 'react'
import {FlatList, Linking, RefreshControl, TextInput, View} from 'react-native'
import {useQueryClient, type InfiniteData} from '@tanstack/react-query'

import {msg} from '@lingui/macro'

import {safeHttpUrl, type ChatMessage, type Page} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Pressable} from '#/components/Pressable'
import {i18n} from '#/locale/i18n'
import {showToast} from '#/lib/toast'
import {trimQueryToFirstPage, usePagedLoad} from '#/state/queries/usePagedLoad'
import type {AppQueryKey} from '#/state/queries/keys'

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

/** Attachment row: the packed Drive file when the server sent one
 * (name + open via its URL), a `fileId`-only caption when the pack left
 * the file off, and null when the message carries no file. Pure. */
function ChatAttachment({message}: {message: ChatMessage}) {
  const file = message.file
  if (file) {
    const label = file.name && file.name.length > 0 ? file.name : 'Attachment'
    // Defence in depth: the Drive URL is server JSON, so it is vetted here
    // (not just in the chat adapter) — a non-http(s) file URL renders as
    // plain text, never as a link. The failure toast never echoes the URL.
    const safe = safeHttpUrl(file.url)
    return (
      <View testID={`chat-attachment-${message.id}`}>
        {safe !== null ? (
          <Pressable
            onPress={() => void Linking.openURL(safe).catch(() => showToast(i18n._(msg`Could not open this attachment.`)))}
            accessibilityRole="link"
            accessibilityLabel={`Open attachment ${label}`}
            testID={`chat-attachment-open-${message.id}`}>
            <Body>{label}</Body>
            <Caption color="faint">{`${file.mimeType} · Open attachment`}</Caption>
          </Pressable>
        ) : (
          <>
            <Body>{label}</Body>
            <Caption color="faint">Attachment is still processing.</Caption>
          </>
        )}
      </View>
    )
  }
  if (message.fileId) {
    return (
      <View testID={`chat-attachment-${message.id}`}>
        <Caption color="faint">Attachment (not loaded).</Caption>
      </View>
    )
  }
  return null
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
      <ChatAttachment message={message} />
      {!message.text && !message.file && !message.fileId ? (
        <Caption color="faint">(empty message)</Caption>
      ) : null}
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
  /**
   * Next-page failure flag (X3.3): when present it gates auto-paging and
   * arms the 429 cooldown; only the footer Retry clears it. Callers that
   * do not pass it yet fall back to "error with loaded items", so the
   * guard still holds without caller changes.
   */
  isFetchNextPageError?: boolean
  /** Cache key of the backing infinite query, when known: refresh trims
   * to the first page first (one request, not N). Absent = plain refetch. */
  queryKey?: AppQueryKey
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

  // Paging (X3.3): a next-page failure keeps the loaded messages and only
  // the footer Retry fetches again — scroll bursts and 429 cooldowns never
  // loop. `isFetchNextPageError` is still rolling out to callers, so an
  // error alongside loaded items counts as a page error.
  const hasData = thread.items.length > 0
  const paged = usePagedLoad({
    ...thread,
    isFetchNextPageError: thread.isFetchNextPageError ?? (thread.error != null && hasData),
  })
  const queryClient = useQueryClient()
  const onRefresh = useCallback(() => {
    if (thread.queryKey) trimQueryToFirstPage(queryClient, thread.queryKey)
    void thread.refetch()
  }, [queryClient, thread.queryKey, thread.refetch])

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
      ) : thread.error && !hasData ? (
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
          testID={`${testPrefix}-list`}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <ChatMessageRow
              message={item}
              mine={viewerAccountId != null && item.fromAccountId === viewerAccountId}
              deleting={deleteState.deletingId === item.id}
              onDelete={() => onDelete(item)}
            />
          )}
          onEndReached={paged.onEndReached}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={thread.isFetching && !thread.isPending}
              onRefresh={onRefresh}
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
          ListFooterComponent={
            thread.isFetchingNextPage ? (
              <View style={[atoms.centered, atoms.py_sm]}>
                <Caption color="faint">{i18n._(msg`Loading more messages…`)}</Caption>
              </View>
            ) : (thread.isFetchNextPageError ?? (thread.error != null && hasData)) ? (
              <View style={[atoms.centered, atoms.gap_sm, atoms.py_sm]}>
                <Caption color="faint">{i18n._(msg`Could not load more messages.`)}</Caption>
                {paged.cooldownLabel ? (
                  <Caption color="faint" testID={`${testPrefix}-more-cooldown`}>
                    {paged.cooldownLabel}
                  </Caption>
                ) : null}
                <Button
                  label={i18n._(msg`Retry`)}
                  variant="secondary"
                  onPress={() => thread.fetchNextPage()}
                  testID={`${testPrefix}-more-retry`}
                />
              </View>
            ) : null
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
