// Thread (`/notes/:id`): ancestors above, the focused post, the reply
// composer entry, then branched replies below — Keystone v1 `Note` parity.
//
// Thread behaviour lives in `packages/fedi` and is CALLED here, never
// reimplemented: Misskey `notes/conversation` (+ the packed-parent fallback
// for servers without it) and Mastodon `context` both hide behind
// `backend.post` / `backend.thread` / `backend.threadReplies`, reached here
// through the session-scoped `usePostThreadQuery` / `useThreadRepliesQuery`
// (`#/state/queries`) so requests from session A never carry session B's
// token. Card taps navigating TO this route are owned elsewhere — this
// screen only reads the `Note: {id: string}` route param.

import {useState} from 'react'
import {RefreshControl, ScrollView, StyleSheet, View} from 'react-native'
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native'

import {
  appearNoteOf,
  type Backend,
  type Post,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {PostCard} from '#/components/Post/index'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {
  usePostThreadQuery,
  useThreadRepliesQuery,
} from '#/state/queries'

// Defensive render-depth cap for nested reply branches. Real threads rarely
// pass a handful of levels; the cap only stops a malicious cycle from
// recursing forever (the fedi tree builder already guards, this is the UI
// belt).
const MAX_DEPTH = 64

const styles = StyleSheet.create({
  replyEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
  },
})

function ReplyEntry({focused}: {focused: Post}) {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const theme = useTheme()
  return (
    <Pressable
      testID="reply-entry"
      onPress={() => nav.navigate('Compose', {replyToId: focused.id})}
      accessibilityRole="button"
      accessibilityLabel={`Post your reply to ${focused.author.username}`}>
      <View
        style={[
          styles.replyEntry,
          {
            borderColor: theme.palette.border,
            backgroundColor: theme.palette.bg,
          },
        ]}>
        <Body color="faint">Post your reply</Body>
      </View>
    </Pressable>
  )
}

function ReplyBranch({
  sessionId,
  backend,
  parentId,
  expandedByDefault,
  depth,
  rootCount,
}: {
  sessionId: string
  backend: Backend
  parentId: string
  expandedByDefault: boolean
  depth: number
  /** Known reply total for the root branch header; null deeper down. */
  rootCount: number | null
}) {
  const [expanded, setExpanded] = useState(expandedByDefault)
  const replies = useThreadRepliesQuery(sessionId, parentId, {backend})

  if (!expanded) {
    return (
      <View style={[atoms.px_md, atoms.py_sm]}>
        <Button
          label="Show replies"
          variant="secondary"
          onPress={() => setExpanded(true)}
          testID={`show-replies-${parentId}`}
        />
      </View>
    )
  }

  const items = replies.data?.pages.flatMap(page => page.items) ?? []

  return (
    <View style={{paddingLeft: depth > 0 ? 12 : 0}} testID={`replies-${parentId}`}>
      {expandedByDefault ? null : (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label="Hide replies"
            variant="secondary"
            onPress={() => setExpanded(false)}
            testID={`hide-replies-${parentId}`}
          />
        </View>
      )}
      {rootCount !== null ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Caption color="faint" testID={`replies-count-${parentId}`}>
            {`Replies (${rootCount})`}
          </Caption>
        </View>
      ) : null}
      {replies.isPending ? (
        <View style={[atoms.centered, atoms.py_sm]}>
          <Loader testID={`replies-loading-${parentId}`} />
        </View>
      ) : replies.isError ? (
        <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
          <Caption color="faint">Could not load replies.</Caption>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => void replies.refetch()}
            testID={`replies-retry-${parentId}`}
          />
        </View>
      ) : items.length === 0 ? (
        <View style={[atoms.centered, atoms.p_md]}>
          <Body>Nothing here yet.</Body>
          <Caption color="faint">Be the first to reply.</Caption>
        </View>
      ) : (
        items.map(child => {
          const shown = appearNoteOf(child)
          return (
            <View key={child.id}>
              <PostCard post={child} sessionId={sessionId} testID={`reply-${child.id}`} />
              {depth + 1 >= MAX_DEPTH ? (
                <View style={[atoms.px_md, atoms.py_sm]}>
                  <Caption color="faint">Thread is too deep to expand here.</Caption>
                </View>
              ) : (
                <ReplyBranch
                  sessionId={sessionId}
                  backend={backend}
                  parentId={shown.id}
                  expandedByDefault={false}
                  depth={depth + 1}
                  rootCount={null}
                />
              )}
            </View>
          )
        })
      )}
      {replies.hasNextPage ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label={replies.isFetchingNextPage ? 'Loading…' : 'Load more replies'}
            variant="secondary"
            onPress={() => void replies.fetchNextPage()}
            testID={`more-replies-${parentId}`}
          />
        </View>
      ) : null}
    </View>
  )
}

export function NoteScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Note'>>()
  const id = route.params.id
  const {session, backend} = useActiveBackend()
  const sessionId = session?.id ?? null
  const theme = useTheme()
  const thread = usePostThreadQuery(sessionId, id, {
    ...(backend ? {backend} : {}),
  })
  const focused = thread.data?.focused ?? null

  return (
    <View style={atoms.flex1} testID="note-screen">
      <Pagehead title="Post" />
      {!session || !backend || !sessionId ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Sign in to see this thread.</Body>
          <Caption color="faint">Threads never show sample data when signed out.</Caption>
          <SignInButton />
        </View>
      ) : thread.isPending ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Loader testID="thread-loading" />
          <Caption color="faint">Loading thread…</Caption>
        </View>
      ) : thread.isError || !focused ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load this thread.</Body>
          <Caption color="faint">It may be deleted, private, or on an unreachable server.</Caption>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => void thread.refetch()}
            testID="thread-retry"
          />
        </View>
      ) : (
        <ScrollView
          style={atoms.flex1}
          testID="thread-body"
          refreshControl={
            <RefreshControl refreshing={thread.isRefetching} onRefresh={() => void thread.refetch()} />
          }>
          {thread.data.ancestors.map(a => (
            <PostCard key={a.id} post={a} sessionId={sessionId} testID={`ancestor-${a.id}`} />
          ))}
          {thread.data.incomplete ? (
            <View style={[atoms.px_md, atoms.py_sm]}>
              <Caption color="faint">Earlier reply context unavailable.</Caption>
            </View>
          ) : null}
          <View
            style={[
              {
                backgroundColor: theme.palette.bgSoft,
                borderTopWidth: 1,
                borderBottomWidth: 1,
                borderColor: theme.palette.border,
              },
            ]}
            testID={`focused-${focused.id}`}>
            <PostCard post={focused} sessionId={sessionId} foldBody={false} />
          </View>
          <ReplyEntry focused={focused} />
          <ReplyBranch
            sessionId={sessionId}
            backend={backend}
            parentId={focused.id}
            expandedByDefault
            depth={0}
            rootCount={focused.counts.replies}
          />
        </ScrollView>
      )}
    </View>
  )
}
