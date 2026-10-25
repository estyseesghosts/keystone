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
  useRoute,
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
  formatByteLimit,
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
import {goBackOrFeed} from '#/components/shell/shellNav'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {i18n} from '#/locale/i18n'
import {msg, plural} from '@lingui/macro'
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

// Reply-chain depth backstop (flat chains): thread cycles (a replies
// to b replies to a, federated or malicious) would recurse forever
// through the per-level reply queries, so any chain at or past this
// depth renders nothing. Real threads never approach it, and it never
// shows a dead-end caption — the reveal simply stops there once the
// queries run dry or this stops it.
const MAX_CHAIN_DEPTH = 64

/** True once a reply chain has hit the cycle backstop (renders nothing). */
export function isChainCapped(depth: number, max: number = MAX_CHAIN_DEPTH): boolean {
  return depth >= max
}

// Reply order (Slice B): the families disagree — Misskey `notes/replies`
// answers newest-first while Mastodon `context` descendants arrive
// oldest-first — so the read site sorts by creation time instead of
// trusting (or reversing) server order. The query itself is untouched:
// feeds and pagination elsewhere keep their own order.
function chronological(items: Post[]): Post[] {
  return [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

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
    // Fills the row height so the placeholder text centers against the
    // Reply pill by layout, never by shrinking the font.
    alignSelf: 'stretch',
    justifyContent: 'center',
    minWidth: 0,
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

// Reply spine (flat chains, X-style — own code): every reply row is
// full-width — zero indent, zero per-depth borders or guides. The only
// connector is a 2px vertical spine through the avatar column, drawn
// UNDER the card (mounted before it, pointer-transparent) so avatars
// sit on the line. A row draws a TOP stub (row top → avatar center)
// iff the row directly above it is its parent, and a BOTTOM stub
// (avatar center → row bottom) iff a shown child row sits directly
// below it: one continuous line along a true parent→child→grandchild
// adjacency, breaks everywhere else. No elbows, no branching ticks.
// The show-more link row never draws stubs.
//
// Geometry pins the PostCard avatar box (16px horizontal / 12px vertical
// card padding, 40px avatar): column center x=36, avatar center y=32.
// A context line above the avatar row (boost/reply badges) pushes the
// true center down, but the stubs stay colinear, so the line still reads
// as one — the joint only shows where a leaf's line terminates.
const SPINE_X = 36
const SPINE_JOINT = 32
const SPINE_WIDTH = 2

function AccountRow({account}: {account: Account}) {
  return (
    <Pressable
      testID={`account-row-${account.id}`}
      onPress={() => {
        if (!navigationRef.isReady()) return
        navigationRef.navigate('Main', {screen: 'User', params: {id: account.id}} as never)
      }}
      accessibilityRole="link"
      accessibilityLabel={i18n._(msg`Open profile of ${displayNameOf(account)}`)}>
      <View style={[atoms.px_md, atoms.py_sm, {flexDirection: 'row', alignItems: 'center', gap: 12}]}>
        <Body numberOfLines={1}>{displayNameOf(account)}</Body>
        <Caption color="muted" numberOfLines={1}>
          {handleOf(account)}
        </Caption>
      </View>
    </Pressable>
  )
}

// Paged account/reaction listing labels, resolved at render time (a
// module constant would freeze the boot locale). Unknown kinds render
// raw: they are data, never translated.
function kindLabel(kind: string): string {
  if (kind === 'reactions') return i18n._(msg`reactions`)
  if (kind === 'boosts') return i18n._(msg`boosts`)
  return kind
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
    const kindName = kindLabel(kind)
    return (
      <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
        <Caption color="faint">
          {unavailable
            ? i18n._(msg`No ${kindName} listing on this server.`)
            : i18n._(msg`Could not load ${kindName}.`)}
        </Caption>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => void state.refetch()} testID={`${testID}-retry`} />
      </View>
    )
  }
  const items = state.data?.pages.flatMap(page => page.items) ?? []
  if (items.length === 0) {
    return (
      <View style={[atoms.centered, atoms.p_md]} testID={testID}>
        <Body>{i18n._(msg`Nothing here yet.`)}</Body>
      </View>
    )
  }
  return (
    <View testID={testID}>
      {items.map((item, i) => renderItem(item, i))}
      {state.hasNextPage ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label={state.isFetchingNextPage ? i18n._(msg`Loading…`) : i18n._(msg`Load more ${kindLabel(kind)}`)}
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
  // Reply only): pressing the placeholder expands the real input with
  // its toolbar (media + emoji), which then stays expanded — no
  // collapse, no toggle.
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
        setError(i18n._(msg`"${tooLarge[0].name}" is too large to attach (limit ${formatByteLimit(tooLarge[0].limit)}).`))
      } else if (tooLarge.length > 1) {
        setError(
          i18n._(
            plural(tooLarge.length, {
              one: `# file was too large to attach.`,
              other: `# files were too large to attach.`,
            }),
          ),
        )
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

  // Collapsed (X-style): ONE compact row — avatar, placeholder text,
  // and Reply pill, all vertically centered by the row's
  // `alignItems: center`. The placeholder is a plain Body text element at
  // the body prose metrics (15/21), never a TextInput: two centered Text
  // elements in one centered row cannot misalign, and no internal
  // TextInput text layout is tuned. No toolbar, no dead space. Pressing
  // the placeholder swaps to the expanded column below (sticky — no
  // collapse, no toggle).
  if (!expanded) {
    const placeholderLabel = i18n._(msg`Post your reply`)
    return (
      <View
        style={[
          styles.inlineReplyRow,
          {borderColor: theme.palette.border, backgroundColor: theme.palette.bg},
        ]}
        testID="inline-reply">
        {avatar}
        <Pressable
          testID="inline-reply-placeholder"
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel={placeholderLabel}
          style={styles.inlineInputColCollapsed}>
          <Body
            color="faint"
            numberOfLines={1}
            style={{
              fontSize: 15 * theme.fontScaleMultiplier,
              lineHeight: 21 * theme.fontScaleMultiplier,
            }}>
            {placeholderLabel}
          </Body>
        </Pressable>
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
          // (the collapsed placeholder unmounts): the expanded box mounts
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
      <Caption color="faint">{i18n._(msg`In clips`)}</Caption>
      <View style={[atoms.row, atoms.gap_sm, {flexWrap: 'wrap'}]}>
        {clips.map(c => (
          <Pressable
            key={c.id}
            testID={`in-clip-${c.id}`}
            onPress={() => {
              if (navigationRef.isReady()) navigationRef.navigate('Clip', {id: c.id})
            }}
            accessibilityRole="link"
            accessibilityLabel={i18n._(msg`Open clip ${c.name}`)}>
            <Body>{c.name}</Body>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

// One flat reply row: the untouched PostCard plus its spine stubs (if
// any) — full-width, zero indent, zero depth styling. The overlay mounts
// BEFORE the card so the spine runs under the avatar (avatars sit on
// the line); it is pointer-transparent so card taps are unaffected.
// PostCard still owns card-tap navigation to its own Note screen.
// `hideReplyContext` is adjacency-driven (the row directly above is the
// parent, so the "Replying to" caption would repeat the spine): callers
// compute it, never PostCard's feed default.
function ReplyRowView({
  post,
  sessionId,
  topStub,
  bottomStub,
  hideReplyContext = false,
}: {
  post: Post
  sessionId: string
  /** The row directly above this one is this row's parent. */
  topStub: boolean
  /** A shown child row sits directly below this one. */
  bottomStub: boolean
  /** The parent post is the row directly above: hide its caption. */
  hideReplyContext?: boolean
}) {
  const theme = useTheme()
  return (
    <View testID={`reply-row-${post.id}`}>
      {topStub || bottomStub ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {topStub ? (
            <View
              testID={`reply-spine-top-${post.id}`}
              style={{
                position: 'absolute',
                left: SPINE_X - SPINE_WIDTH / 2,
                top: 0,
                height: SPINE_JOINT,
                width: SPINE_WIDTH,
                backgroundColor: theme.palette.border,
              }}
            />
          ) : null}
          {bottomStub ? (
            <View
              testID={`reply-spine-bottom-${post.id}`}
              style={{
                position: 'absolute',
                left: SPINE_X - SPINE_WIDTH / 2,
                top: SPINE_JOINT,
                bottom: 0,
                width: SPINE_WIDTH,
                backgroundColor: theme.palette.border,
              }}
            />
          ) : null}
        </View>
      ) : null}
      <PostCard
        post={post}
        sessionId={sessionId}
        testID={`reply-${post.id}`}
        hideReplyContext={hideReplyContext}
      />
    </View>
  )
}

// One compact ancestor row (X-style context above the focused post):
// avatar + name + smaller body only (PostCard `context`: no action bar,
// no reaction counts), spine-connected down to the focused post with the
// SAME avatar-column spine idiom as the reply chains (same SPINE_X /
// JOINT / WIDTH, same under-card overlay) — no new visual language.
// `hideReplyContext` is adjacency-driven like the reply rows: the parent
// is the row directly above, so its caption would repeat the spine.
function AncestorRowView({
  post,
  sessionId,
  topStub,
  bottomStub,
  hideReplyContext,
}: {
  post: Post
  sessionId: string
  /** A shown ancestor sits directly above (this row's parent). */
  topStub: boolean
  /** A shown post row (next ancestor, or the focused post) sits below. */
  bottomStub: boolean
  /** The parent post is the row directly above: hide its caption. */
  hideReplyContext: boolean
}) {
  const theme = useTheme()
  return (
    <View testID={`ancestor-row-${post.id}`}>
      {topStub || bottomStub ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {topStub ? (
            <View
              testID={`ancestor-spine-top-${post.id}`}
              style={{
                position: 'absolute',
                left: SPINE_X - SPINE_WIDTH / 2,
                top: 0,
                height: SPINE_JOINT,
                width: SPINE_WIDTH,
                backgroundColor: theme.palette.border,
              }}
            />
          ) : null}
          {bottomStub ? (
            <View
              testID={`ancestor-spine-bottom-${post.id}`}
              style={{
                position: 'absolute',
                left: SPINE_X - SPINE_WIDTH / 2,
                top: SPINE_JOINT,
                bottom: 0,
                width: SPINE_WIDTH,
                backgroundColor: theme.palette.border,
              }}
            />
          ) : null}
        </View>
      ) : null}
      <PostCard
        post={post}
        sessionId={sessionId}
        testID={`ancestor-${post.id}`}
        context
        hideReplyContext={hideReplyContext}
      />
    </View>
  )
}

// The one muted chain link per direct reply: Caption-sized text, never a
// Button pill. Only the terminal chain node renders it, gated on skipped
// siblings or known children, so it always reveals real rows — never an
// inert control.
function ShowMoreLink({rootId, onPress}: {rootId: string; onPress: () => void}) {
  return (
    <View style={[atoms.px_md, atoms.py_sm]}>
      <Pressable
        testID={`show-more-replies-${rootId}`}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={i18n._(msg`Show more replies`)}>
        <Caption color="muted">{i18n._(msg`Show more replies…`)}</Caption>
      </Pressable>
    </View>
  )
}

function ChainLoading({parentId}: {parentId: string}) {
  return (
    <View style={[atoms.centered, atoms.py_sm]}>
      <Loader testID={`replies-loading-${parentId}`} />
    </View>
  )
}

function ChainError({parentId, onRetry}: {parentId: string; onRetry: () => void}) {
  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
      <Caption color="faint">{i18n._(msg`Could not load replies.`)}</Caption>
      <Pressable
        testID={`replies-retry-${parentId}`}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={i18n._(msg`Retry loading replies`)}>
        <Caption color="muted">{i18n._(msg`Retry`)}</Caption>
      </Pressable>
    </View>
  )
}

// One lineal chain node (B at level 1, C at level 2): its row plus the
// continuation below. The read site sorts oldest-first at every fork —
// Misskey `notes/replies` answers newest-first, Mastodon `context`
// descendants oldest-first, so server order is never trusted (the query
// itself is untouched) — and the lineal child is always the oldest, so
// forks follow chronology. Siblings skipped at this level ride
// `youngerAbove` down and render — oldest-first, depth-first — inside
// the reveal, after this node's whole subtree.
function ChainSpine({
  sessionId,
  backend,
  rootId,
  post,
  level,
  depth,
  skippedBefore,
  youngerAbove,
  youngerAboveDepth,
  revealed,
  onExpand,
}: {
  sessionId: string
  backend: Backend
  /** The direct reply this chain hangs under: owns the one link. */
  rootId: string
  /** This lineal node's post. */
  post: Post
  /** 1 for B (child of the direct reply), 2 for C. */
  level: number
  /** Tree depth of this node (cycle backstop accounting). */
  depth: number
  /** A sibling was skipped above this node (its subtree is hidden). */
  skippedBefore: boolean
  /** Skipped younger siblings from levels above, rendered in the reveal. */
  youngerAbove: Post[]
  youngerAboveDepth: number
  revealed: boolean
  onExpand: () => void
}) {
  const shown = appearNoteOf(post)
  const replies = useThreadRepliesQuery(sessionId, shown.id, {backend})
  const items = useMemo(
    () => chronological(replies.data?.pages.flatMap(page => page.items) ?? []),
    [replies.data],
  )
  const oldest = items.length > 0 ? items[0] : null
  // Terminal = the lineal descent stops here: C's level, or a leaf above
  // it. Only the terminal node may own the chain's one link.
  const terminal = level >= 2 || oldest === null
  const loaded = !replies.isPending && !replies.isError
  return (
    <>
      <ReplyRowView
        post={post}
        sessionId={sessionId}
        topStub
        bottomStub={level < 2 ? oldest !== null : revealed && items.length > 0}
        hideReplyContext
      />
      {replies.isPending ? <ChainLoading parentId={shown.id} /> : null}
      {replies.isError ? (
        <ChainError parentId={shown.id} onRetry={() => void replies.refetch()} />
      ) : null}
      {loaded && level < 2 && oldest !== null ? (
        <ChainSpine
          sessionId={sessionId}
          backend={backend}
          rootId={rootId}
          post={oldest}
          level={level + 1}
          depth={depth + 1}
          skippedBefore={skippedBefore || items.length > 1}
          youngerAbove={items.slice(1)}
          youngerAboveDepth={depth + 1}
          revealed={revealed}
          onExpand={onExpand}
        />
      ) : null}
      {loaded && terminal && !revealed && (skippedBefore || items.length > 0) ? (
        <ShowMoreLink rootId={rootId} onPress={onExpand} />
      ) : null}
      {loaded && revealed ? (
        <>
          {terminal
            ? items.map((child, i) => (
                <FullSubtree
                  key={child.id}
                  sessionId={sessionId}
                  backend={backend}
                  post={child}
                  depth={depth + 1}
                  isFirst={i === 0}
                />
              ))
            : null}
          {youngerAbove.map(sib => (
            <FullSubtree
              key={sib.id}
              sessionId={sessionId}
              backend={backend}
              post={sib}
              depth={youngerAboveDepth}
              isFirst={false}
            />
          ))}
        </>
      ) : null}
    </>
  )
}

// One direct reply of the focused post: row A, then the lineal descent
// (B, C) — 3 rows — then the one "Show more replies…" link iff more
// exists in this subtree. Tapping the link reveals the ENTIRE remaining
// subtree in one tap (D onward plus every skipped younger sibling
// subtree, depth-first, oldest-first) with no further links: real
// threads are shallow, and the silent 64-depth cycle backstop below is
// the only bound.
function RootReply({
  sessionId,
  backend,
  child,
}: {
  sessionId: string
  backend: Backend
  child: Post
}) {
  const [revealed, setRevealed] = useState(false)
  const shown = appearNoteOf(child)
  const replies = useThreadRepliesQuery(sessionId, shown.id, {backend})
  const items = useMemo(
    () => chronological(replies.data?.pages.flatMap(page => page.items) ?? []),
    [replies.data],
  )
  const oldest = items.length > 0 ? items[0] : null
  return (
    <>
      <ReplyRowView
        post={child}
        sessionId={sessionId}
        topStub={false}
        bottomStub={oldest !== null}
        hideReplyContext={false}
      />
      {replies.isPending ? <ChainLoading parentId={shown.id} /> : null}
      {replies.isError ? (
        <ChainError parentId={shown.id} onRetry={() => void replies.refetch()} />
      ) : null}
      {!replies.isPending && !replies.isError && oldest !== null ? (
        <ChainSpine
          sessionId={sessionId}
          backend={backend}
          rootId={shown.id}
          post={oldest}
          level={1}
          depth={1}
          skippedBefore={items.length > 1}
          youngerAbove={items.slice(1)}
          youngerAboveDepth={1}
          revealed={revealed}
          onExpand={() => setRevealed(true)}
        />
      ) : null}
    </>
  )
}

// Full reveal row: the post plus ALL of its children, oldest-first, each
// recursing the same way — one tap reveals the whole subtree, no further
// links. The cycle backstop stops silently (renders nothing, never a
// dead-end caption).
function FullSubtree({
  sessionId,
  backend,
  post,
  depth,
  isFirst,
}: {
  sessionId: string
  backend: Backend
  post: Post
  depth: number
  /** First shown child of its parent: sits directly below it. */
  isFirst: boolean
}) {
  const shown = appearNoteOf(post)
  const replies = useThreadRepliesQuery(sessionId, shown.id, {backend})
  const items = useMemo(
    () => chronological(replies.data?.pages.flatMap(page => page.items) ?? []),
    [replies.data],
  )
  // Cycle backstop (a replies to b replies to a, federated or
  // malicious): silently stop, never recurse and never a dead-end
  // caption.
  if (isChainCapped(depth)) return null
  const loaded = !replies.isPending && !replies.isError
  return (
    <>
      <ReplyRowView
        post={post}
        sessionId={sessionId}
        topStub={isFirst}
        bottomStub={loaded && items.length > 0}
        hideReplyContext={isFirst}
      />
      {replies.isPending ? <ChainLoading parentId={shown.id} /> : null}
      {replies.isError ? (
        <ChainError parentId={shown.id} onRetry={() => void replies.refetch()} />
      ) : null}
      {loaded
        ? items.map((child, i) => (
            <FullSubtree
              key={child.id}
              sessionId={sessionId}
              backend={backend}
              post={child}
              depth={depth + 1}
              isFirst={i === 0}
            />
          ))
        : null}
    </>
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
  // Deleting the focused post blanks its card (shadow isDeleted): leave
  // the detail for the previous screen instead (v1 `navigate("/")`, F20).
  // A deep-linked Note has no back history, so the shared shell fallback
  // takes the feed instead of logging an unhandled action (rn-ui L3).
  const shadow = usePostShadowState(sessionId ?? '', focused?.id ?? '')
  useEffect(() => {
    if (shadow?.isDeleted) goBackOrFeed()
  }, [shadow?.isDeleted])
  // Detail tabs (v1 `Note` parity, F19): replies live below the
  // composer entry; boosts and reactions list the actors.
  const [tab, setTab] = useState<'replies' | 'reposts' | 'reactions'>('replies')
  // Root replies ride the outer FlatList's rows (F24): a single
  // VirtualizedList whose header is the ancestors + focused post + entry +
  // tabs, never PostCards inside a ScrollView. Each row is one direct
  // reply plus its flat lineal chain (oldest-child descent: A, B, C, then
  // the one show-more link); tapping the link reveals the whole
  // remaining subtree in one tap. Disabled until the focused post
  // resolves, and prefetched across tabs off the same session-scoped
  // query key.
  const rootParentId = focused?.id ?? ''
  const rootReplies = useThreadRepliesQuery(sessionId, rootParentId, {
    ...(backend ? {backend} : {}),
  })
  // Oldest-first at the read site (the query order is family-dependent);
  // the query itself is untouched.
  const rootItems = useMemo(
    () => chronological(rootReplies.data?.pages.flatMap(page => page.items) ?? []),
    [rootReplies.data],
  )

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
      <Pagehead title={i18n._(msg`Note`)} />
      {!session || !backend || !sessionId ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Sign in to see this thread.`)}</Body>
          <Caption color="faint">{i18n._(msg`Threads never show sample data when signed out.`)}</Caption>
          <SignInButton />
        </View>
      ) : thread.isPending ? (
        <SkeletonList variant="post" testID="thread-loading" />
      ) : thread.isError || !focused ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          {thread.error instanceof ApiError && thread.error.status === 429 ? (
            <>
              <Body testID="thread-rate-limited">{i18n._(msg`Rate limited by the server.`)}</Body>
              <Caption color="faint">
                {i18n._(msg`The server is throttling requests right now. Wait a moment, then try again.`)}
              </Caption>
            </>
          ) : (
            <>
              <Body>{i18n._(msg`Could not load this thread.`)}</Body>
              <Caption color="faint">{i18n._(msg`It may be deleted, private, or on an unreachable server.`)}</Caption>
            </>
          )}
          <Button
            label={i18n._(msg`Retry`)}
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
          renderItem={({item}) => <RootReply sessionId={sessionId} backend={backend} child={item} />}
          ListHeaderComponent={
            <>
              {thread.data.ancestors.map((a, i) => {
                // Adjacency suppression: hide the caption only when the
                // replied-to post is the row directly above (the spine
                // already says it). The first ancestor keeps its caption
                // when its parent is outside the shown chain.
                const prev = i > 0 ? thread.data.ancestors[i - 1] : null
                const hide =
                  prev !== null &&
                  appearNoteOf(a).replyToId === appearNoteOf(prev).id
                return (
                  <AncestorRowView
                    key={a.id}
                    post={a}
                    sessionId={sessionId}
                    topStub={i > 0}
                    bottomStub
                    hideReplyContext={hide}
                  />
                )
              })}
              {thread.data.incomplete ? (
                <View style={[atoms.px_md, atoms.py_sm]}>
                  <Caption color="faint">{i18n._(msg`Earlier reply context unavailable.`)}</Caption>
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
                {thread.data.ancestors.length > 0 ? (
                  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <View
                      testID={`focused-spine-top-${focused.id}`}
                      style={{
                        position: 'absolute',
                        left: SPINE_X - SPINE_WIDTH / 2,
                        top: 0,
                        height: SPINE_JOINT,
                        width: SPINE_WIDTH,
                        backgroundColor: theme.palette.border,
                      }}
                    />
                  </View>
                ) : null}
                <PostCard
                  post={focused}
                  sessionId={sessionId}
                  foldBody={false}
                  hideReplyContext={
                    thread.data.ancestors.length > 0 &&
                    !thread.data.incomplete &&
                    appearNoteOf(focused).replyToId ===
                      appearNoteOf(
                        thread.data.ancestors[thread.data.ancestors.length - 1],
                      ).id
                  }
                />
              </View>
              <InClipsRow backend={backend} postId={focused.id} />
              <InlineReply session={session} backend={backend} focused={focused} threadId={id} />
              <Tabs
                tabs={
                  [
                    {key: 'replies', label: i18n._(msg`Replies`)},
                    {key: 'reposts', label: i18n._(msg`Reposts`)},
                    {key: 'reactions', label: i18n._(msg`Reactions`)},
                  ] as {key: typeof tab; label: string}[]
                }
                active={tab}
                onChange={setTab}
                testID="note-tabs"
                testIDPrefix="note-tab"
                accessibilityLabel={i18n._(msg`Post details`)}
              />
              {tab === 'replies' ? (
                <View testID={`replies-${focused.id}`}>
                  {rootReplies.isPending ? (
                    <View style={[atoms.centered, atoms.py_sm]}>
                      <Loader testID={`replies-loading-${focused.id}`} />
                    </View>
                  ) : rootReplies.isError ? (
                    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
                      <Caption color="faint">{i18n._(msg`Could not load replies.`)}</Caption>
                      <Pressable
                        testID={`replies-retry-${focused.id}`}
                        onPress={() => void rootReplies.refetch()}
                        accessibilityRole="button"
                        accessibilityLabel={i18n._(msg`Retry loading replies`)}>
                        <Caption color="muted">{i18n._(msg`Retry`)}</Caption>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={
            tab === 'replies' && !rootReplies.isPending && !rootReplies.isError ? (
              <View style={[atoms.centered, atoms.p_md]}>
                <Body>{i18n._(msg`Nothing here yet.`)}</Body>
                <Caption color="faint">{i18n._(msg`Be the first to reply.`)}</Caption>
              </View>
            ) : null
          }
          ListFooterComponent={
            tab === 'replies' ? (
              rootReplies.hasNextPage ? (
                <View style={[atoms.px_md, atoms.py_sm]}>
                  {rootReplies.isFetchingNextPage ? (
                    <Caption color="faint">{i18n._(msg`Loading…`)}</Caption>
                  ) : (
                    <Pressable
                      testID={`more-replies-${focused.id}`}
                      onPress={() => void rootReplies.fetchNextPage()}
                      accessibilityRole="button"
                      accessibilityLabel={i18n._(msg`Load more replies`)}>
                      <Caption color="muted">{i18n._(msg`Load more replies`)}</Caption>
                    </Pressable>
                  )}
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
