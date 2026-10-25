// Thread (`/notes/:id`): ancestors above, the focused post, the inline
// reply composer, then branched replies below — Keystone v1 `Note` parity.
//
// Thread behaviour lives in `packages/fedi` and is CALLED here, never
// reimplemented: Misskey `notes/conversation` (+ the packed-parent fallback
// for servers without it) and Mastodon `context` both hide behind
// `backend.post` / `backend.thread` / `backend.threadReplies`, reached here
// through the session-scoped `usePostThreadQuery` / `useThreadRepliesQuery`
// (`#/state/queries`) so requests from session A never carry session B's
// token. Card taps navigating TO this route are owned elsewhere — this
// screen only reads the `Note: {id: string}` route param.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {FlatList, Image, Keyboard, Pressable as RNPressable, RefreshControl, StyleSheet, TextInput, View, type View as ViewType} from 'react-native'
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native'

import {
  appearNoteOf,
  buildPostDraft,
  composeDefaultsFor,
  composeGates,
  countComposeChars,
  defaultVisibilityFor,
  displayNameOf,
  emptyComposeState,
  handleOf,
  isUnsupportedError,
  ApiError,
  type Account,
  type Backend,
  type ClipSummary,
  type Page,
  type Post,
  type Session,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {SkeletonList} from '#/components/Skeleton'
import {PostCard} from '#/components/Post/index'
import {Pressable} from '#/components/Pressable'
import {Tabs} from '#/components/Tabs'
import {SignInButton} from '#/components/SignInButton'
import {MediaIcon, SmileIcon} from '#/components/icons'
import {usePostShadowState} from '#/state/cache'
import {navigationRef} from '#/navigationRef'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {i18n} from '#/locale/i18n'
import {msg} from '@lingui/macro'
import {useQueryClient} from '@tanstack/react-query'
import {useAutogrowInput, autogrowStyle} from '#/components/Composer/useAutogrowInput'
import {NO_OUTLINE} from '#/components/Composer/noOutline'
import {pickMedia} from '#/components/Composer/pickMedia'
import {AnchoredPopup} from '#/components/Popup'
import {EmojiPicker} from '#/components/EmojiPicker'
import {
  useCreatePost,
  useUploads,
} from '#/state/queries/composer'
import {
  useNoteReactionsQuery,
  usePostThreadQuery,
  useRepostsQuery,
  useThreadRepliesQuery,
  threadQueryKey,
  threadRepliesQueryKey,
} from '#/state/queries'

// Defensive render-depth cap for nested reply branches. Real threads rarely
// pass a handful of levels; the cap only stops a malicious cycle from
// recursing forever (the fedi tree builder already guards, this is the UI
// belt).
const MAX_DEPTH = 64

const styles = StyleSheet.create({
  inlineReply: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  inlineAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  inlineAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineInputCol: {
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  inlineInput: {
    minHeight: 40,
    textAlignVertical: 'top',
  },
  inlineReplyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  inlineInputColCollapsed: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  inlineInputCollapsed: {
    minHeight: 36,
    textAlignVertical: 'center',
  },
  inlineToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  inlineTool: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  inlineUploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
})

// Thread connectors (E8, v1 `Note` parity, own code): a 1px left edge
// ties same-thread cards together — the ancestor chain above the
// focused post, each root reply row below it, and every nested branch
// level. v1 draws the same idea through the avatar column with
// `::before` rules (web-only); the edge is the native equivalent —
// adjacent rows share the indent so the segments read as one spine.
// PostCard internals are untouched: the edge wraps each card.
function threadEdge(borderColor: string) {
  return {borderLeftWidth: 1, borderLeftColor: borderColor, marginLeft: 16, paddingLeft: 12}
}

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

// Inline reply composer (replies Slice A): the viewer's avatar + an
// expanding input + a Reply button, posting through the same
// `useCreatePost` mutation as every other composer, with `replyTo` preset
// to the focused post. Collapsed it is avatar + placeholder + Reply only;
// first focus/typing expands the toolbar (media + emoji, sticky once
// open). Text + media + emoji only — polls, CW, visibility, and
// scheduling stay in the overlay composer. On success the input clears and
// the exact thread-replies keys this screen reads are invalidated, so the
// new reply appears without leaving (E10). Signed-out never reaches here:
// the screen renders the sign-in prompt instead.
function InlineReply({
  session,
  backend,
  focused,
  threadId,
}: {
  session: Session
  backend: Backend
  focused: Post
  /** Route post id: the `usePostThreadQuery` key this screen reads. */
  threadId: string
}) {
  const theme = useTheme()
  const client = useQueryClient()
  const sessionId = session.id
  const family = session.family
  const gates = useMemo(
    () => composeGates(family, backend.capabilities, backend),
    [family, backend],
  )
  // Static family defaults, not the server-limits query: the overlay
  // composer already fetches per-instance limits, and the server stays
  // authoritative here — a refusal surfaces honestly below.
  const limits = useMemo(() => composeDefaultsFor(family), [family])
  const uploads = useUploads(backend)
  const create = useCreatePost(session, backend)
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Collapsed until first interaction (X-style: avatar + placeholder +
  // Reply only): focusing or typing expands the toolbar, which then stays
  // expanded — no collapse, no toggle.
  const [expanded, setExpanded] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const emojiAnchor = useRef<ViewType | null>(null)
  // Inline box rests at one row and grows with the prose to 240px, then
  // scrolls internally. Same hook as both composer chromes.
  const autogrow = useAutogrowInput(40, 240, text)
  // A reply never widens its parent's audience (same default as the
  // overlay composer).
  const visibilityRaw = useMemo(
    () => defaultVisibilityFor(family, focused).raw,
    [family, focused],
  )
  const avatarUri = session.user?.avatarUrl ?? null
  const avatarName = session.user?.displayName ?? session.accountId
  const count = countComposeChars(family, text)
  const over = count > limits.maxChars
  const mediaFull = uploads.items.length >= limits.maxMedia
  const canSubmit = text.trim().length > 0 || uploads.items.length > 0

  const addMedia = async () => {
    try {
      const result = await pickMedia({limit: limits.maxMedia - uploads.items.length})
      // Denied is shown, never a silent cancel (same idiom as the overlay
      // composer).
      if (result.kind === 'denied') {
        setError(
          result.canAskAgain
            ? i18n._(msg`Media library access was denied. Allow access to attach photos or videos.`)
            : i18n._(
                msg`Media library access was denied. Enable it in the system settings to attach photos or videos.`,
              ),
        )
        return
      }
      if (result.kind === 'cancelled') return
      const refused = uploads.add(result.files)
      const tooLarge = [...result.rejected, ...refused]
      if (tooLarge.length === 1) {
        setError(i18n._(msg`"${tooLarge[0]}" is too large to attach (over 10 MB).`))
      } else if (tooLarge.length > 1) {
        setError(i18n._(msg`${tooLarge.length} files were too large to attach (over 10 MB).`))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n._(msg`Could not open the media picker.`))
    }
  }

  const submit = async () => {
    if (busy || !canSubmit) return
    setError(null)
    // Validate text rules first (staged media ids fill after upload).
    const pre = buildPostDraft(
      {
        ...emptyComposeState({replyTo: focused, visibilityRaw}),
        text,
        media: uploads.items.map(u => ({
          id: u.mediaId ?? u.key,
          alt: u.alt,
          sensitive: u.sensitive,
        })),
      },
      {family, gates, limits},
    )
    if (!pre.ok) {
      setError(pre.reason)
      return
    }
    setBusy(true)
    try {
      let mediaIds: string[] = []
      if (uploads.items.length > 0) {
        const ids = await uploads.ensureUploaded()
        if (!ids) {
          setError(i18n._(msg`Some attachments failed to upload. Retry or remove them.`))
          return
        }
        mediaIds = ids
      }
      const built = buildPostDraft(
        {
          ...emptyComposeState({replyTo: focused, visibilityRaw}),
          text,
          media: mediaIds.map(m => ({id: m, alt: ''})),
        },
        {family, gates, limits},
      )
      if (!built.ok) {
        setError(built.reason)
        return
      }
      await create.mutateAsync({draft: built.draft})
      setText('')
      uploads.clear()
      setError(null)
      // E10, closed for this path: the mutation only writes feed keys, so
      // the thread-replies list this screen reads is invalidated here —
      // the posted reply appears without leaving. The focused post's own
      // (reply-count) query goes with it; the header reads whichever lands
      // first.
      await client.invalidateQueries({queryKey: threadRepliesQueryKey(sessionId, focused.id)})
      await client.invalidateQueries({queryKey: threadQueryKey(sessionId, threadId)})
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n._(msg`Could not post.`))
    } finally {
      setBusy(false)
    }
  }

  const avatar = avatarUri ? (
    <Image
      source={{uri: avatarUri}}
      style={styles.inlineAvatar}
      accessibilityRole="image"
      accessibilityLabel={avatarName}
    />
  ) : (
    <View
      style={[
        styles.inlineAvatar,
        styles.inlineAvatarFallback,
        {backgroundColor: theme.palette.raise},
      ]}>
      <Body>{avatarName.slice(0, 1).toUpperCase()}</Body>
    </View>
  )
  const replyButton = (
    <Button
      label={busy ? i18n._(msg`Posting…`) : i18n._(msg`Reply`)}
      onPress={() => void submit()}
      disabled={busy || over || !canSubmit}
      disabledReason={
        over
          ? i18n._(msg`Over the character limit.`)
          : busy
            ? i18n._(msg`Posting...`)
            : !canSubmit
              ? i18n._(msg`Write something first.`)
              : undefined
      }
      testID="inline-reply-submit"
      compact
    />
  )

  // Collapsed (X-style): ONE compact row — avatar, single-line input, and
  // Reply pill, vertically centered. No toolbar, no dead space. First
  // focus/typing swaps to the expanded column below.
  if (!expanded) {
    return (
      <View
        style={[
          styles.inlineReplyRow,
          {borderColor: theme.palette.border, backgroundColor: theme.palette.bg},
        ]}
        testID="inline-reply">
        {avatar}
        <View style={styles.inlineInputColCollapsed}>
          <TextInput
            testID="inline-reply-input"
            multiline
            value={text}
            onChangeText={t => {
              setText(t)
              setExpanded(true)
              autogrow.remeasure()
            }}
            onSelectionChange={e => setCaret(e.nativeEvent.selection.end)}
            onFocus={() => setExpanded(true)}
            placeholder={i18n._(msg`Post your reply`)}
            placeholderTextColor={theme.palette.faint}
            accessibilityLabel={i18n._(msg`Post your reply`)}
            ref={autogrow.inputRef}
            style={[
              styles.inlineInputCollapsed,
              {
                color: theme.palette.text,
                fontSize: 15 * theme.fontScaleMultiplier,
                lineHeight: 21 * theme.fontScaleMultiplier,
              },
              autogrowStyle(autogrow.height),
              NO_OUTLINE,
            ]}
            onContentSizeChange={autogrow.onContentSizeChange}
          />
        </View>
        {replyButton}
      </View>
    )
  }

  return (
    <View
      style={[
        styles.inlineReply,
        {borderColor: theme.palette.border, backgroundColor: theme.palette.bg},
      ]}
      testID="inline-reply">
      {avatar}
      <View style={styles.inlineInputCol}>
        <TextInput
          testID="inline-reply-input"
          multiline
          value={text}
          onChangeText={t => {
            setText(t)
            setExpanded(true)
            autogrow.remeasure()
          }}
          onSelectionChange={e => setCaret(e.nativeEvent.selection.end)}
          onFocus={() => setExpanded(true)}
          // Focus carries across the collapsed→expanded branch switch
          // below (the collapsed input unmounts): the expanded box mounts
          // exactly at expansion, so autoFocus only ever fires there.
          autoFocus
          placeholder={i18n._(msg`Post your reply`)}
          placeholderTextColor={theme.palette.faint}
          accessibilityLabel={i18n._(msg`Post your reply`)}
          ref={autogrow.inputRef}
          style={[
            styles.inlineInput,
            {
              color: theme.palette.text,
              fontSize: 15 * theme.fontScaleMultiplier,
              lineHeight: 21 * theme.fontScaleMultiplier,
            },
            autogrowStyle(autogrow.height),
            NO_OUTLINE,
          ]}
          onContentSizeChange={autogrow.onContentSizeChange}
        />
        {uploads.items.map(u => (
          <View key={u.key} style={styles.inlineUploadRow} testID={`inline-reply-upload-${u.key}`}>
            {u.previewUri ? (
              <Image source={{uri: u.previewUri}} style={styles.inlineThumb} accessibilityLabel={u.alt || u.name} />
            ) : null}
            <View style={{flex: 1}}>
              <Caption color="muted" numberOfLines={1}>
                {u.name} -{' '}
                {u.status === 'staged'
                  ? i18n._(msg`ready to upload`)
                  : u.status === 'uploading'
                    ? i18n._(msg`uploading...`)
                    : u.status === 'done'
                      ? i18n._(msg`uploaded`)
                      : (u.error ?? i18n._(msg`failed`))}
              </Caption>
            </View>
            <Pressable
              testID={`inline-reply-upload-remove-${u.key}`}
              onPress={() => uploads.remove(u.key)}
              accessibilityRole="button"
              accessibilityLabel={i18n._(msg`Remove ${u.name}`)}
              hitSlop={8}>
              <Caption color="muted">{i18n._(msg`Remove`)}</Caption>
            </Pressable>
          </View>
        ))}
        {error ? (
          <Body testID="inline-reply-error" accessibilityRole="alert">
            {error}
          </Body>
        ) : null}
        <View style={styles.inlineToolbar}>
          <Pressable
            testID="inline-reply-media"
            onPress={() => void addMedia()}
            disabled={!gates.media.enabled || mediaFull}
            accessibilityRole="button"
            accessibilityLabel={
              !gates.media.enabled
                ? `${i18n._(msg`Attach media`)}. ${gates.media.reason}`
                : mediaFull
                  ? `${i18n._(msg`Attach media`)}. ${i18n._(msg`Attachment limit reached.`)}`
                  : uploads.items.length > 0
                    ? i18n._(msg`Attach media (${uploads.items.length} attached)`)
                    : i18n._(msg`Attach media`)
            }
            hitSlop={8}>
            <MediaIcon size={20} color={theme.palette.muted} />
          </Pressable>
          <RNPressable
            ref={emojiAnchor}
            testID="inline-reply-emoji"
            onPress={() => {
              // Same E5 reasoning as the compact composer: the popup is
              // a separate Modal window, so dismiss first to anchor it
              // against the full window.
              Keyboard.dismiss()
              setEmojiOpen(v => !v)
            }}
            accessibilityRole="button"
            accessibilityLabel={i18n._(msg`Insert emoji`)}
            hitSlop={8}
            style={styles.inlineTool}>
            <SmileIcon size={20} color={theme.palette.muted} />
          </RNPressable>
          <View style={atoms.flex1} />
          {replyButton}
        </View>
        {emojiOpen ? (
          <AnchoredPopup
            anchor={emojiAnchor}
            onClose={() => setEmojiOpen(false)}
            testID="inline-reply-emoji-popup"
            minWidth={320}>
            <EmojiPicker
              sessionId={sessionId}
              onPick={e => {
                const at = Math.min(caret, text.length)
                setText(text.slice(0, at) + e.key + text.slice(at))
                setCaret(at + e.key.length)
                setEmojiOpen(false)
              }}
            />
          </AnchoredPopup>
        ) : null}
      </View>
    </View>
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
  const theme = useTheme()
  const edge = depth > 0 ? {borderLeftWidth: 1, borderLeftColor: theme.palette.border} : null

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
    <View
      style={[{paddingLeft: depth > 0 ? 12 : 0}, edge]}
      testID={`replies-${parentId}`}>
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
  const theme = useTheme()
  const shown = appearNoteOf(child)
  return (
    <View style={threadEdge(theme.palette.border)} testID={`thread-edge-${child.id}`}>
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

  // E10: the thread query is never invalidated on create-success (the
  // create-post mutation only writes feed keys), and the old
  // pull-to-refresh refetched the focused post but NOT its replies — so
  // a reply posted from detail never appeared without exiting +
  // reopening. Both paths below refetch here, event-driven, never
  // polling: manual refresh reloads post + replies, and returning from
  // the Compose overlay (which blurs this screen) refetches on focus.
  // The inline composer above closes the gap for its own path directly:
  // its success handler invalidates the exact thread-replies + thread
  // keys this screen reads.
  const refreshThread = useCallback(() => {
    void thread.refetch()
    if (rootParentId.length > 0) void rootReplies.refetch()
  }, [thread, rootParentId, rootReplies])
  // The focus callback subscribes ONCE (empty deps): its body must see
  // fresh queries without resubscribing, or every re-render would
  // resubscribe-while-focused and refetch — a polling loop by accident.
  const refreshThreadRef = useRef(refreshThread)
  useEffect(() => {
    refreshThreadRef.current = refreshThread
  })
  const seenFocus = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (!seenFocus.current) {
        seenFocus.current = true
        return
      }
      refreshThreadRef.current()
    }, []),
  )

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
        <SkeletonList variant="post" testID="thread-loading" />
      ) : thread.isError || !focused ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          {thread.error instanceof ApiError && thread.error.status === 429 ? (
            <>
              <Body testID="thread-rate-limited">Rate limited by the server.</Body>
              <Caption color="faint">The server is throttling requests right now. Wait a moment, then try again.</Caption>
            </>
          ) : (
            <>
              <Body>Could not load this thread.</Body>
              <Caption color="faint">It may be deleted, private, or on an unreachable server.</Caption>
            </>
          )}
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
          keyExtractor={item => `${sessionId}:${item.id}`}
          renderItem={({item}) => <RootReplyRow sessionId={sessionId} backend={backend} child={item} />}
          ListHeaderComponent={
            <>
              {thread.data.ancestors.length > 0 ? (
                <View style={threadEdge(theme.palette.border)} testID="ancestor-chain">
                  {thread.data.ancestors.map(a => (
                    <PostCard key={a.id} post={a} sessionId={sessionId} testID={`ancestor-${a.id}`} />
                  ))}
                </View>
              ) : null}
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
              <InlineReply session={session} backend={backend} focused={focused} threadId={id} />
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
                      {/* Loaded rows are a true subset of the server total,
                          so the header never reads below what is on screen
                          while the focused post's counts catch up. */}
                      {`Replies (${Math.max(focused.counts.replies, rootItems.length)})`}
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
              refreshing={thread.isRefetching || rootReplies.isRefetching}
              onRefresh={() => refreshThread()}
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
