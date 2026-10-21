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

import {useEffect, useState} from 'react'
import {FlatList, RefreshControl, StyleSheet, View} from 'react-native'
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native'

import {
  appearNoteOf,
  displayNameOf,
  handleOf,
  isUnsupportedError,
  type Account,
  type Backend,
  type ClipSummary,
  type Page,
  type Post,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {PostCard} from '#/components/Post/index'
import {Pressable} from '#/components/Pressable'
import {Tabs} from '#/components/Tabs'
import {SignInButton} from '#/components/SignInButton'
import {usePostShadowState} from '#/state/cache'
import {navigationRef} from '#/navigationRef'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {
  useNoteReactionsQuery,
  usePostThreadQuery,
  useRepostsQuery,
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

function AccountRow({account}: {account: Account}) {
  return (
    <Pressable
      testID={`account-row-${account.id}`}
      onPress={() => {
        if (!navigationRef.isReady()) return
        navigationRef.navigate('Main', {screen: 'User', params: {id: account.id}} as never)
      }}
      accessibilityRole="link"
      accessibilityLabel={`Open profile of ${displayNameOf(account)}`}>
      <View style={[atoms.px_md, atoms.py_sm, {flexDirection: 'row', alignItems: 'center', gap: 12}]}>
        <Body numberOfLines={1}>{displayNameOf(account)}</Body>
        <Caption color="muted" numberOfLines={1}>
          {handleOf(account)}
        </Caption>
      </View>
    </Pressable>
  )
}

function PagedList<T>({
  state,
  kind,
  testID,
  renderItem,
}: {
  state: {
    isPending: boolean
    isError: boolean
    error: unknown
    data: {pages: Page<T>[]} | undefined
    hasNextPage: boolean
    isFetchingNextPage: boolean
    refetch: () => void
    fetchNextPage: () => void
  }
  kind: string
  testID: string
  renderItem: (item: T, index: number) => React.ReactNode
}) {
  if (state.isPending) {
    return (
      <View style={[atoms.centered, atoms.py_sm]}>
        <Loader testID={`${testID}-loading`} />
      </View>
    )
  }
  if (state.isError) {
    const unavailable = isUnsupportedError(state.error)
    return (
      <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
        <Caption color="faint">
          {unavailable ? `No ${kind} listing on this server.` : `Could not load ${kind}.`}
        </Caption>
        <Button label="Retry" variant="secondary" onPress={() => void state.refetch()} testID={`${testID}-retry`} />
      </View>
    )
  }
  const items = state.data?.pages.flatMap(page => page.items) ?? []
  if (items.length === 0) {
    return (
      <View style={[atoms.centered, atoms.p_md]} testID={testID}>
        <Body>Nothing here yet.</Body>
      </View>
    )
  }
  return (
    <View testID={testID}>
      {items.map((item, i) => renderItem(item, i))}
      {state.hasNextPage ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label={state.isFetchingNextPage ? 'Loading…' : `Load more ${kind}`}
            variant="secondary"
            onPress={() => void state.fetchNextPage()}
            testID={`${testID}-more`}
          />
        </View>
      ) : null}
    </View>
  )
}

function RepostsList({sessionId, backend, postId}: {sessionId: string; backend: Backend; postId: string}) {
  const list = useRepostsQuery(sessionId, postId, {backend})
  return (
    <PagedList
      state={list}
      kind="boosts"
      testID={`reposts-${postId}`}
      renderItem={(item: Account) => <AccountRow key={item.id} account={item} />}
    />
  )
}

function ReactionsList({sessionId, backend, postId}: {sessionId: string; backend: Backend; postId: string}) {
  const list = useNoteReactionsQuery(sessionId, postId, {backend})
  return (
    <PagedList
      state={list}
      kind="reactions"
      testID={`reactions-${postId}`}
      renderItem={(row: {id: string; reaction: string; account: Account}) => (
        <View key={row.id} style={[atoms.px_md, atoms.py_sm, {flexDirection: 'row', alignItems: 'center', gap: 12}]}>
          <Body>{row.reaction}</Body>
          <AccountRow account={row.account} />
        </View>
      )}
    />
  )
}

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

// "In clips" row (F20, v1 `Note` parity): which of the viewer's clips
// contain the focused post. Misskey-family only — without `backend.clips`
// the row hides, never an honest-disabled stub (the menu's add-to-clip
// flow is the way in).
function InClipsRow({backend, postId}: {backend: Backend; postId: string}) {
  const [clips, setClips] = useState<ClipSummary[] | null>(null)
  useEffect(() => {
    if (!backend.clips) return
    let cancelled = false
    setClips(null)
    void backend.clips
      .containing(postId)
      .then(rows => {
        if (!cancelled) setClips(rows)
      })
      .catch(() => {
        if (!cancelled) setClips([])
      })
    return () => {
      cancelled = true
    }
  }, [backend, postId])
  if (!backend.clips || clips == null || clips.length === 0) return null
  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`in-clips-${postId}`}>
      <Caption color="faint">In clips</Caption>
      <View style={[atoms.row, atoms.gap_sm, {flexWrap: 'wrap'}]}>
        {clips.map(c => (
          <Pressable
            key={c.id}
            testID={`in-clip-${c.id}`}
            onPress={() => {
              if (navigationRef.isReady()) navigationRef.navigate('Clip', {id: c.id})
            }}
            accessibilityRole="link"
            accessibilityLabel={`Open clip ${c.name}`}>
            <Body>{c.name}</Body>
          </Pressable>
        ))}
      </View>
    </View>
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

// Root reply row (F24): one direct reply of the focused post as a FlatList
// row — a PostCard plus its (collapsed, View-based) child branch. The
// MAX_DEPTH cycle guard mirrors ReplyBranch: the nested branch starts at
// depth 1, exactly as the old root ReplyBranch (depth 0) rendered it.
function RootReplyRow({
  sessionId,
  backend,
  child,
}: {
  sessionId: string
  backend: Backend
  child: Post
}) {
  const shown = appearNoteOf(child)
  return (
    <View>
      <PostCard post={child} sessionId={sessionId} testID={`reply-${child.id}`} />
      {0 + 1 >= MAX_DEPTH ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Caption color="faint">Thread is too deep to expand here.</Caption>
        </View>
      ) : (
        <ReplyBranch
          sessionId={sessionId}
          backend={backend}
          parentId={shown.id}
          expandedByDefault={false}
          depth={0 + 1}
          rootCount={null}
        />
      )}
    </View>
  )
}

export function NoteScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Note'>>()
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const id = route.params.id
  const {session, backend} = useActiveBackend()
  const sessionId = session?.id ?? null
  const theme = useTheme()
  const thread = usePostThreadQuery(sessionId, id, {
    ...(backend ? {backend} : {}),
  })
  const focused = thread.data?.focused ?? null
  // Deleting the focused post blanks its card (shadow isDeleted): leave
  // the detail for the previous screen instead (v1 `navigate("/")`, F20).
  const shadow = usePostShadowState(sessionId ?? '', focused?.id ?? '')
  useEffect(() => {
    if (shadow?.isDeleted) nav.goBack()
  }, [shadow?.isDeleted, nav])
  // Detail tabs (v1 `Note` parity, F19): replies live below the
  // composer entry; boosts and reactions list the actors.
  const [tab, setTab] = useState<'replies' | 'reposts' | 'reactions'>('replies')
  // Root replies ride the outer FlatList's rows (F24): a single
  // VirtualizedList whose header is the ancestors + focused post + entry +
  // tabs, never PostCards inside a ScrollView. Nested branches stay
  // View-based inside each row. Disabled until the focused post resolves,
  // and prefetched across tabs off the same session-scoped query key.
  const rootParentId = focused?.id ?? ''
  const rootReplies = useThreadRepliesQuery(sessionId, rootParentId, {
    ...(backend ? {backend} : {}),
  })
  const rootItems = rootReplies.data?.pages.flatMap(page => page.items) ?? []

  return (
    <View style={atoms.flex1} testID="note-screen">
      <Pagehead title="Note" />
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
        <FlatList
          style={atoms.flex1}
          testID="thread-body"
          data={tab === 'replies' ? rootItems : []}
          keyExtractor={item => item.id}
          renderItem={({item}) => <RootReplyRow sessionId={sessionId} backend={backend} child={item} />}
          ListHeaderComponent={
            <>
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
              <InClipsRow backend={backend} postId={focused.id} />
              <ReplyEntry focused={focused} />
              <Tabs
                tabs={
                  [
                    {key: 'replies', label: 'Replies'},
                    {key: 'reposts', label: 'Reposts'},
                    {key: 'reactions', label: 'Reactions'},
                  ] as {key: typeof tab; label: string}[]
                }
                active={tab}
                onChange={setTab}
                testID="note-tabs"
                testIDPrefix="note-tab"
                accessibilityLabel="Post details"
              />
              {tab === 'replies' ? (
                <View testID={`replies-${focused.id}`}>
                  <View style={[atoms.px_md, atoms.py_sm]}>
                    <Caption color="faint" testID={`replies-count-${focused.id}`}>
                      {`Replies (${focused.counts.replies})`}
                    </Caption>
                  </View>
                  {rootReplies.isPending ? (
                    <View style={[atoms.centered, atoms.py_sm]}>
                      <Loader testID={`replies-loading-${focused.id}`} />
                    </View>
                  ) : rootReplies.isError ? (
                    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
                      <Caption color="faint">Could not load replies.</Caption>
                      <Button
                        label="Retry"
                        variant="secondary"
                        onPress={() => void rootReplies.refetch()}
                        testID={`replies-retry-${focused.id}`}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={
            tab === 'replies' && !rootReplies.isPending && !rootReplies.isError ? (
              <View style={[atoms.centered, atoms.p_md]}>
                <Body>Nothing here yet.</Body>
                <Caption color="faint">Be the first to reply.</Caption>
              </View>
            ) : null
          }
          ListFooterComponent={
            tab === 'replies' ? (
              rootReplies.hasNextPage ? (
                <View style={[atoms.px_md, atoms.py_sm]}>
                  <Button
                    label={rootReplies.isFetchingNextPage ? 'Loading…' : 'Load more replies'}
                    variant="secondary"
                    onPress={() => void rootReplies.fetchNextPage()}
                    testID={`more-replies-${focused.id}`}
                  />
                </View>
              ) : null
            ) : tab === 'reposts' ? (
              <RepostsList sessionId={sessionId} backend={backend} postId={focused.id} />
            ) : (
              <ReactionsList sessionId={sessionId} backend={backend} postId={focused.id} />
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={thread.isRefetching}
              onRefresh={() => void thread.refetch()}
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
        />
      )}
    </View>
  )
}
