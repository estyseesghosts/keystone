// Post row (slice 3.3): avatar, name, handle, time, CW toggle,
// RichText body, still-image grid, quote embed, renote header, reply
// context, counts, read-only reaction chips.
//
// Capability gating: write actions (reply, boost, react, menu) render
// disabled WITH their reason — hidden only when the capability is
// `unsupported`. Never wired, never inert, never faked.

import {useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react'
import {Image, Linking, Platform, Share, StyleSheet, View} from 'react-native'

import {QueryClientContext} from '@tanstack/react-query'

import {msg, t} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import {
  appearNoteOf,
  backendForSession,
  type Translation,
  displayNameOf,
  foldTree,
  handleOf,
  isPureRenote,
  parseAcct,
  safeHttpUrl,
  getQuoteTarget,
  statusLabelFor,
  resolveRemotePostUrl,
  type Account,
  type Capabilities,
  type EmojiStyle,
  type Media,
  type Post,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {DisplayName} from '#/components/DisplayName'
import {RichText} from '#/components/RichText'
import {canCopy, copyText} from '#/lib/clipboard'
import {showToast} from '#/lib/toast'
import {navigationRef} from '#/navigationRef'
import {usePostActions, type PostActions} from '#/state/cache'
import {useOptionalSessionStore} from '#/state/session/SessionProvider'
import {useLikeEmoji} from '#/state/emojiPrefs'

import {ActionBar, StaticActionBar, toastError} from './ActionBar'
import {badgesFor} from './badges'
import {postBodyNodes, postEmojis} from './body'
import {usePostCardHandlers, type PostCardHandlers} from './handlers'
import {LinkCard} from './LinkCard'
import {buildPostMenu, type PostMenuSection} from './menuModel'
import {Lightbox} from '#/components/Lightbox'
import {PostMediaGrid} from './PostMediaGrid'
import {PostPoll} from './PostPoll'
import {PostQuote} from './PostQuote'
import {UserHoverCard} from '#/components/Profile/UserHoverCard'
import {formatCount, useLocale} from '#/locale/i18n'
import {ReactionChips} from './ReactionChips'
import {formatRelativeTime} from './time'

const AVATAR = 40

const styles = StyleSheet.create({
  card: {flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12},
  avatar: {width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, borderWidth: 1},
  avatarFallback: {alignItems: 'center', justifyContent: 'center'},
  main: {flex: 1, gap: 2, minWidth: 0},
  header: {flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap'},
  headerAuthor: {flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1, minWidth: 0},
  headerName: {flexShrink: 1, maxWidth: 220, fontWeight: '700'},
  context: {marginBottom: 2},
  badges: {flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 2},
  actions: {flexDirection: 'row', gap: 16, marginTop: 6},
  cwBox: {borderRadius: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, marginVertical: 8},
})

// Profile / thread navigation (Keystone v1 `NoteCard` parity: the avatar
// and the name link to `/users/:id`, the body and the time link to
// `/notes/:id`). The root ref is guarded: presentational trees render with
// no container mounted, where navigation is a silent no-op.
function openAuthorProfile(authorId: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', {screen: 'User', params: {id: authorId}} as never)
}

/** Mention tap → profile screen (F9): the label carries the handle
 * (`@user`, `@user@host`); the server URL is only the fallback. */
function openMentionProfile(acct: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', {screen: 'User', params: {acct}} as never)
}

function openPostDetail(postId: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Note', {id: postId})
}

function openTagPosts(tag: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Tag', {tag})
}

/** Collapsed-boost banner (v1 `TimelineFeed` parity, F17): one reposter
 * reads "X boosted", several read "X and N others boosted". Pure. */
export function boostLabel(post: Post, renoters?: Account[]): string {
  const names = (renoters ?? []).map(displayNameOf)
  if (names.length <= 1) return t`${displayNameOf(post.author)} boosted`
  const rest = names.length - 1
  return t`${names[0]} and ${rest} other${rest === 1 ? '' : 's'} boosted`
}

// Desktop hover preview (P7): web-only wrapper around an author press.
// After ~400ms of hover the profile card floats below the anchor; native
// renders the child alone (no hover exists there). The card floats in an
// absolutely-positioned web layer, never in layout.
function HoverAuthor({
  account,
  sessionId,
  onOpenProfile,
  children,
  testID,
}: {
  account: Account
  sessionId: string
  onOpenProfile: () => void
  children: React.ReactNode
  testID?: string
}) {
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  if (Platform.OS !== 'web') return <>{children}</>
  // `onHoverIn`/`onHoverOut` exist on the web host view but are absent
  // from this RN version's `ViewProps` types — spread them in (spreads
  // skip excess-prop checks) so native trees never see the props.
  const hoverHandlers: {onHoverIn?: () => void; onHoverOut?: () => void} =
    Platform.OS === 'web'
      ? {
          onHoverIn: () => {
            if (timer.current !== null) clearTimeout(timer.current)
            timer.current = setTimeout(() => setShow(true), 400)
          },
          onHoverOut: () => {
            if (timer.current !== null) clearTimeout(timer.current)
            setShow(false)
          },
        }
      : {}
  return (
    <View {...hoverHandlers}>
      {children}
      {show ? (
        <View style={hoverStyles.card}>
          <UserHoverCard
            account={account}
            sessionId={sessionId}
            onOpenProfile={onOpenProfile}
            testID={testID}
          />
        </View>
      ) : null}
    </View>
  )
}

const hoverStyles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: '100%',
    left: 0,
    zIndex: 50,
  },
})

function Avatar({post, sessionId}: {post: Post; sessionId: string}) {
  const theme = useTheme()
  const [failed, setFailed] = useState(false)
  // Server strings are never trusted as image sources: anything but
  // http(s) renders the initial fallback (F4).
  const avatarUri = safeHttpUrl(post.author.avatarUrl)
  const inner =
    avatarUri === null || failed ? (
      <View
        testID={`avatar-fallback-${post.author.id}`}
        accessibilityRole="image"
        accessibilityLabel={displayNameOf(post.author)}
        style={[styles.avatar, styles.avatarFallback, {backgroundColor: theme.palette.bgSoft, borderColor: theme.palette.border}]}>
        <Body>{displayNameOf(post.author).slice(0, 1).toUpperCase()}</Body>
      </View>
    ) : (
      <Image
        source={{uri: avatarUri}}
        style={[styles.avatar, {borderColor: theme.palette.border}]}
        accessibilityRole="image"
        accessibilityLabel={displayNameOf(post.author)}
        onError={() => setFailed(true)}
        testID={`avatar-${post.author.id}`}
      />
    )
  return (
    <HoverAuthor
      account={post.author}
      sessionId={sessionId}
      onOpenProfile={() => openAuthorProfile(post.author.id)}
      testID={`author-hover-${post.author.id}`}>
      <Pressable
        testID={`avatar-press-${post.author.id}`}
        onPress={() => openAuthorProfile(post.author.id)}
        accessibilityRole="link"
        accessibilityLabel={t`Open profile of ${displayNameOf(post.author)}`}>
        {inner}
      </Pressable>
    </HoverAuthor>
  )
}

export type PostCardProps = {
  post: Post
  /** Owning session id — accepted for the Phase-4 action wiring. */
  sessionId: string
  capabilities?: Capabilities | null
  emojiStyle?: EmojiStyle
  onMentionPress?: (href: string | null, label: string) => void
  onHashtagPress?: (tag: string) => void
  onLinkPress?: (href: string) => void
  /** Aggregated reposters for a collapsed boost group (F17): the banner
   * reads "X and N others boosted". Omit for single boosts and outside
   * feeds — the header falls back to the wrapper author alone. */
  renoters?: Account[]
  /** Fold long bodies to the timeline budget with a Show more/less
   * toggle (F13). Feeds fold; the detail screen passes false. */
  foldBody?: boolean
  testID?: string
  /** Screen-supplied composer/picker callbacks (override the context). */
  handlers?: PostCardHandlers
}

type LiveBits = {
  actions: PostActions
  family: 'misskey' | 'mastodon'
  menu: PostMenuSection[]
  handlers: PostCardHandlers
  translation: Translation | null
  hideTranslation: () => void
  votePoll: (postId: string, choices: number[]) => Promise<void>
}

/** Wires the write path when session + query providers exist; otherwise
 * renders the read-only card (presentational trees, tests). */
export function PostCard(props: PostCardProps) {
  const store = useOptionalSessionStore()
  const qc = useContext(QueryClientContext)
  if (store && qc) return <LivePostCard {...props} />
  return <PostCardView {...props} />
}

function LivePostCard(props: PostCardProps) {
  const {post, sessionId} = props
  const {i18n} = useLingui()
  const store = useOptionalSessionStore()!
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const session = snapshot.sessions.find(s => s.id === sessionId) ?? null
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  const handlers = usePostCardHandlers(props.handlers)
  const effective = useMemo(() => appearNoteOf(post), [post])
  const actions = usePostActions(sessionId, effective)
  const [translation, setTranslation] = useState<Translation | null>(null)
  const shown = actions.shadowed.post
  const isOwn = session != null && effective.author.id === session.accountId

  if (actions.shadowed.isDeleted) return null

  const menu = buildPostMenu({
    family: session?.family ?? 'misskey',
    capabilities: backend?.capabilities ?? null,
    post: shown,
    origin: session?.origin ?? '',
    isOwn,
    copyAvailable: canCopy(),
    bookmark: actions.bookmark,
    del: actions.delete,
    handlers: {
      copy: async text => {
        try {
          await copyText(text)
          showToast(i18n._(msg`Copied`))
        } catch (e) {
          toastError(e)
        }
      },
      share: async (url, text) => {
        try {
          await Share.share({message: text ? `${text}\n${url}` : url, url})
        } catch (e) {
          toastError(e)
        }
      },
      open: url => void Linking.openURL(url).catch(toastError),
      translate: async () => {
        if (!backend) return
        try {
          setTranslation(await backend.translate(effective.id, handlers.targetLang ?? 'en'))
        } catch (e) {
          toastError(e)
        }
      },
      muteThread: async () => {
        if (!backend) return
        try {
          await backend.muteThread(effective.id)
          showToast(i18n._(msg`Thread muted`))
        } catch (e) {
          toastError(e)
        }
      },
      togglePin: async () => {
        if (!backend) return
        try {
          if (shown.pinned) await backend.unpinPost(effective.id)
          else await backend.pinPost(effective.id)
          showToast(shown.pinned ? i18n._(msg`Unpinned`) : i18n._(msg`Pinned`))
        } catch (e) {
          toastError(e)
        }
      },
      onEdit: handlers.onEdit,
      onClip: handlers.onClip,
      user: handlers.user ?? handlers.userFor?.(effective, sessionId),
    },
  })

  return (
    <PostCardView
      {...props}
      capabilities={props.capabilities ?? backend?.capabilities ?? null}
      live={{
        actions,
        family: session?.family ?? 'misskey',
        menu,
        handlers,
        translation,
        hideTranslation: () => setTranslation(null),
        votePoll: async (postId, choices) => {
          if (!backend) throw new Error(i18n._(msg`Sign in to vote.`))
          await backend.votePoll(postId, choices)
        },
      }}
    />
  )
}

function PostCardView({
  post,
  capabilities,
  emojiStyle = 'twemoji',
  onMentionPress,
  onHashtagPress,
  onLinkPress,
  renoters,
  foldBody = true,
  testID,
  live,
  sessionId,
}: PostCardProps & {live?: LiveBits}) {
  const theme = useTheme()
  const {i18n} = useLingui()
  const locale = useLocale()
  const [cwOpen, setCwOpen] = useState(false)
  // Per-session configured like key (F18): chips hide it, the like
  // button sets it. Device-local store, server default underneath.
  const likeEmoji = useLikeEmoji(sessionId)
  // Lightbox target: the exact media array shown plus the tapped index.
  // Main-grid taps open the post's array; quote-card taps open the
  // quote's slice — never a mixed or reindexed array.
  const [lightbox, setLightbox] = useState<{items: Media[]; index: number} | null>(null)
  // Tapping a link inside the body fires both the link and the body's own
  // press (native press bubbling): stamp link taps so the body press can
  // stand down when one just landed.
  const linkGuard = useRef(0)
  const markLink = () => {
    linkGuard.current = Date.now()
  }

  // A pure repost shows the ORIGINAL with a boost header; a quote is
  // its own post (appearNoteOf encodes exactly this).
  const base = useMemo(() => appearNoteOf(post), [post])
  const effective = live ? live.actions.shadowed.post : base
  const isBoost = base !== post
  const fullNodes = useMemo(() => postBodyNodes(effective), [effective])
  // Timeline fold (F13): long bodies fold to the budget with an
  // in-place Show more/less toggle; the body tap still opens detail.
  const [expanded, setExpanded] = useState(false)
  const {nodes, folded} = useMemo(
    () => (foldBody && !expanded ? foldTree(fullNodes) : {nodes: fullNodes, folded: false}),
    [fullNodes, foldBody, expanded],
  )
  const emojis = useMemo(() => postEmojis(effective), [effective])
  const badges = useMemo(() => badgesFor(effective), [effective])
  // Quote-authorization display label for the wrapper's relationship
  // (pending/rejected/…); approved or missing never labels.
  const quoteStatus = useMemo(() => {
    const target = getQuoteTarget(effective)
    return target?.authorizationStatus ? statusLabelFor(target.authorizationStatus) : null
  }, [effective])
  const cw = effective.cw
  const bodyHidden = cw !== null && !cwOpen

  // Warm the remote-page cache for federated posts (MK17): by the
  // time the menu opens, "Copy remote link" carries the human page
  // URL instead of the raw AP id. Best-effort, never blocking.
  useEffect(() => {
    if (effective.uri) void resolveRemotePostUrl(effective.uri)
  }, [effective.uri])

  const replyTarget = post.replyToId !== null ? (post.reply ?? null) : null

  // Link presses keep working when the card supplies no handler (the
  // RichText defaults: external URLs open out, bare tags open the tag
  // route) — but every one of them stamps the guard first so the body
  // press below does not double-navigate.
  const handleLinkPress = (href: string) => {
    markLink()
    if (onLinkPress) onLinkPress(href)
    else void Linking.openURL(href).catch(() => {})
  }
  const handleMentionPress = (href: string | null, label: string) => {
    markLink()
    if (onMentionPress) onMentionPress(href, label)
    else {
      const ref = parseAcct(label)
      if (ref) openMentionProfile(ref.host ? `${ref.username}@${ref.host}` : ref.username)
      else if (href) void Linking.openURL(href).catch(() => {})
    }
  }
  const handleHashtagPress = (tag: string) => {
    markLink()
    if (onHashtagPress) onHashtagPress(tag)
    else openTagPosts(tag)
  }
  const openPost = () => {
    if (Date.now() - linkGuard.current < 400) return
    openPostDetail(effective.id)
  }
  const openQuoted = (quoted: {id: string}) => {
    if (Date.now() - linkGuard.current < 400) return
    openPostDetail(quoted.id)
  }

  return (
    <View style={styles.card} testID={testID ?? `post-${post.id}`}>
      <Avatar post={effective} sessionId={sessionId} />
      <View style={styles.main}>
        {isBoost && (
          <Caption color="muted" style={styles.context} testID={`boost-header-${post.id}`}>
            {boostLabel(post, renoters)}
          </Caption>
        )}
        {badges.length > 0 && (
          <View style={styles.badges} testID={`post-badges-${post.id}`}>
            {badges.map(b => (
              <Caption key={b.key} color="muted" testID={`post-badge-${b.key}-${post.id}`}>
                {b.label}
              </Caption>
            ))}
          </View>
        )}
        {replyTarget !== null && (
          <Caption color="muted" style={styles.context} testID={`reply-context-${post.id}`}>
            {i18n._(msg`Replying to @${replyTarget.author.acct}`)}
          </Caption>
        )}
        <View style={styles.header}>
          <HoverAuthor
            account={effective.author}
            sessionId={sessionId}
            onOpenProfile={() => openAuthorProfile(effective.author.id)}
            testID={`author-hover-name-${effective.author.id}`}>
            <Pressable
              testID={`author-press-${effective.author.id}`}
              onPress={() => openAuthorProfile(effective.author.id)}
              accessibilityRole="link"
              accessibilityLabel={i18n._(msg`Open profile of ${displayNameOf(effective.author)}`)}
              style={styles.headerAuthor}>
              <DisplayName
                account={effective.author}
                size={15}
                textStyle={styles.headerName}
                testID={`author-name-${effective.author.id}`}
              />
              <Caption color="muted" numberOfLines={1}>
                {handleOf(effective.author)}
              </Caption>
            </Pressable>
          </HoverAuthor>
          <Pressable
            testID={`post-time-${effective.id}`}
            onPress={() => openPostDetail(effective.id)}
            accessibilityRole="link"
            accessibilityLabel={i18n._(msg`Open post by ${displayNameOf(effective.author)}`)}>
            <Caption color="muted" numberOfLines={1}>
              {`· ${formatRelativeTime(effective.createdAt, undefined, locale)}`}
            </Caption>
          </Pressable>
        </View>
        {cw !== null && (
          <View style={[styles.cwBox, {backgroundColor: theme.palette.bg, borderColor: theme.palette.borderStrong}]} testID={`cw-${post.id}`}>
            <Caption color="muted">CW: {cw}</Caption>
            <Pressable
              testID={`cw-toggle-${post.id}`}
              onPress={() => setCwOpen(v => !v)}
              accessibilityRole="button"
              accessibilityLabel={cwOpen ? i18n._(msg`Hide content`) : i18n._(msg`Show content`)}>
              <Caption>{cwOpen ? i18n._(msg`Hide`) : i18n._(msg`Show`)}</Caption>
            </Pressable>
          </View>
        )}
        {!bodyHidden && (
          <Pressable
            testID={`post-open-${effective.id}`}
            onPress={openPost}
            accessibilityRole="link"
            accessibilityLabel={i18n._(msg`Open post by ${displayNameOf(effective.author)}`)}>
            <RichText
              nodes={nodes}
              emojis={emojis}
              emojiStyle={emojiStyle}
              onMentionPress={handleMentionPress}
              onHashtagPress={handleHashtagPress}
              onLinkPress={handleLinkPress}
              testID={`post-body-${post.id}`}
            />
            {folded && !expanded ? (
              <Pressable
                testID={`post-expand-${post.id}`}
                onPress={() => {
                  markLink()
                  setExpanded(true)
                }}
                accessibilityRole="button"
                accessibilityLabel={i18n._(msg`Show more of this post`)}>
                <Caption color="muted">{i18n._(msg`Show more`)}</Caption>
              </Pressable>
            ) : null}
            {expanded && foldBody ? (
              <Pressable
                testID={`post-collapse-${post.id}`}
                onPress={() => {
                  markLink()
                  setExpanded(false)
                }}
                accessibilityRole="button"
                accessibilityLabel={i18n._(msg`Show less of this post`)}>
                <Caption color="muted">{i18n._(msg`Show less`)}</Caption>
              </Pressable>
            ) : null}
          </Pressable>
        )}
        {!bodyHidden && <PostMediaGrid media={effective.media} onOpen={index => setLightbox({items: effective.media, index})} testID={`post-media-${post.id}`} />}
        {!bodyHidden && (effective.quote !== null || effective.quoteUnavailable) && (
          <PostQuote
            quote={effective.quote}
            unavailable={effective.quoteUnavailable}
            status={quoteStatus}
            emojiStyle={emojiStyle}
            onPress={openQuoted}
            onOpenMedia={(items, index) => setLightbox({items, index})}
            onMentionPress={handleMentionPress}
            onHashtagPress={handleHashtagPress}
            onLinkPress={handleLinkPress}
            testID={`post-quote-${post.id}`}
          />
        )}
        {lightbox !== null && (
          <Lightbox
            media={lightbox.items}
            index={lightbox.index}
            onIndexChange={index => setLightbox({items: lightbox.items, index})}
            onClose={() => setLightbox(null)}
            testID={`post-lightbox-${post.id}`}
          />
        )}
        {!bodyHidden && effective.poll !== null && (
          <PostPoll
            poll={effective.poll}
            onVote={live?.votePoll ? choices => live.votePoll(effective.id, choices) : undefined}
            testID={`post-poll-${post.id}`}
          />
        )}
        {!bodyHidden && effective.card !== null && (
          <LinkCard card={effective.card} testID={`post-card-${post.id}`} />
        )}
        {live?.translation && (
          <View style={[styles.cwBox, {backgroundColor: theme.palette.bgSoft}]} testID={`translation-${post.id}`}>
            <Caption color="muted">
              {live.translation.sourceLang
                ? i18n._(msg`Translated from ${live.translation.sourceLang}`)
                : i18n._(msg`Translated`)}
            </Caption>
            <Body>{live.translation.text}</Body>
            <Pressable
              testID={`translation-hide-${post.id}`}
              onPress={live.hideTranslation}
              accessibilityRole="button"
              accessibilityLabel={i18n._(msg`Hide translation`)}>
              <Caption>{i18n._(msg`Hide`)}</Caption>
            </Pressable>
          </View>
        )}
        <ReactionChips
          reactions={effective.reactions}
          capabilities={capabilities}
          pendingKeys={live?.actions.shadowed.pendingEmojiKeys}
          likeEmoji={likeEmoji}
          onToggle={
            live && live.actions.reaction.gate.enabled
              ? key =>
                  void live.actions.reaction
                    .set(live.actions.reaction.value === key ? null : key)
                    .catch(toastError)
              : undefined
          }
          testID={`post-reactions-${post.id}`}
        />
        {live ? (
          <ActionBar
            post={effective}
            actions={live.actions}
            family={live.family}
            capabilities={capabilities ?? null}
            handlers={live.handlers}
            menu={live.menu}
            sessionId={sessionId}
            likeEmoji={likeEmoji}
          />
        ) : (
          <StaticActionBar post={effective} />
        )}
      </View>
    </View>
  )
}
