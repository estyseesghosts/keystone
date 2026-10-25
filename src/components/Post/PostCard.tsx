// Post row (slice 3.3): avatar, name, handle, time, CW toggle,
// RichText body, still-image grid, quote embed, renote header, reply
// context, counts, read-only reaction chips.
//
// Capability gating: write actions (reply, boost, react, menu) render
// disabled WITH their reason — hidden only when the capability is
// `unsupported`. Never wired, never inert, never faked.

import {memo, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore} from 'react'
import {Image, Linking, Platform, Share, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native'

import {QueryClientContext} from '@tanstack/react-query'

import {msg, t} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import {
  appearNoteOf,
  backendForSession,
  type Translation,
  collectBareLinkHrefs,
  displayNameOf,
  foldTree,
  handleOf,
  isPureRenote,
  safeHttpUrl,
  resolveRemotePostUrl,
  type Account,
  type Backend,
  type Capabilities,
  type EmojiStyle,
  type Media,
  type Poll,
  type Post,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {DisplayName, shouldCollapseName} from '#/components/DisplayName'
import {RichText, defaultHashtagPress, defaultMentionPress} from '#/components/RichText'
import {canCopy, copyText} from '#/lib/clipboard'
import {deleteAndRedraft} from '#/lib/redraft'
import {showToast} from '#/lib/toast'
import {navigationRef} from '#/navigationRef'
import {patchPostInCaches, usePostActions, type PostActions} from '#/state/cache'
import {isSoftMutedPost, useSoftMutedIds} from '#/state/queries/graph'
import {useOptionalSessionStore} from '#/state/session/SessionProvider'
import {useLikeEmoji} from '#/state/emojiPrefs'
import {useDataSaver} from '#/state/appearance'
import {
  effectivePreviewMode,
  needsTranslateNotice,
  shouldAutoUnfurl,
  useLinkPreviewMode,
  type LinkPreviewMode,
} from '#/state/privacyShield'

import {ActionBar, StaticActionBar, toastError} from './ActionBar'
import {RecommendationReasonDialog} from '#/components/Recommendations/RecommendationReasonDialog'
import {badgesFor} from './badges'
import {postBodyNodes, postEmojis, postTagBubble} from './body'
import {usePostCardHandlers, type PostCardHandlers} from './handlers'
import {LinkCard, UnfurledLinkCard, firstBareUrl} from './LinkCard'
import {buildPostMenu, type PostMenuSection} from './menuModel'
import {viewerPrimaryOf} from './translationPolicy'
import {Lightbox} from '#/components/Lightbox'
import {PostMediaGrid} from './PostMediaGrid'
import {PostPoll} from './PostPoll'
import {PostQuote} from './PostQuote'
import {quoteCardProps, useQuoteTarget} from './useQuoteTarget'
import {useAutoTranslation} from './useAutoTranslation'
import {TagBubble} from './TagBubble'
import {HoverPreview} from '#/components/Profile/HoverPreview'
import {formatCount, useLocale} from '#/locale/i18n'
import {ReactionChips} from './ReactionChips'
import {formatRelativeTime} from './time'

const AVATAR = 40

const styles = StyleSheet.create({
  card: {gap: 8, paddingHorizontal: 16, paddingVertical: 12},
  avatar: {width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, borderWidth: 1},
  avatarFallback: {alignItems: 'center', justifyContent: 'center'},
  // Context rows (boost / badges / reply) sit full-width above the
  // avatar row, so the avatar always lines up with the name block —
  // never floating above it on replies and reposts.
  contextBlock: {gap: 2},
  cardRow: {flexDirection: 'row', gap: 12},
  // The avatar hover anchor sits in the card row: without an explicit
  // cross-axis opt-out the row stretches it to full post height, turning
  // the whole left column into a hover/press strip. `flex-start` keeps
  // the anchor box exactly the 40×40 avatar (already top-aligned, so no
  // pixels move — only the interactive hit area shrinks).
  avatarHover: {alignSelf: 'flex-start'},
  main: {flex: 1, gap: 2, minWidth: 0},
  header: {minWidth: 0},
  headerCol: {gap: 1},
  nameRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap'},
  // Display name over handle, always (collapsed single-line case is
  // handled by omitting the handle, not by this style).
  headerNamePress: {flexShrink: 1, minWidth: 0},
  // Hover anchors hug the presses they wrap (the zone is exactly this
  // box): the name anchor shrinks like the name, the handle anchor
  // self-starts like the handle — never full-width.
  headerNameHover: {flexShrink: 1, minWidth: 0},
  headerHandleHover: {alignSelf: 'flex-start', flexShrink: 1, minWidth: 0, maxWidth: '100%'},
  headerHandlePress: {alignSelf: 'flex-start', flexShrink: 1, minWidth: 0, maxWidth: '100%'},
  headerName: {flexShrink: 1, maxWidth: 220, fontWeight: '700'},
  // Time text top-aligns with the name line: name runs 15/20, captions
  // 12/16, so a 2px offset lines the cap heights up.
  headerTime: {paddingTop: 2, flexShrink: 0},
  context: {},
  badges: {flexDirection: 'row', gap: 8, flexWrap: 'wrap'},
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

// Post-detail navigation (Keystone v1 `NoteCard` parity): the body and
// the time link to `/notes/:id`. Guarded: presentational trees stay
// silent.
function openPostDetail(postId: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Note', {id: postId})
}

// Edit-history navigation, reached from the Edited badge (clickstone §1.7).
// Only wired where the backend exposes `editHistory`; a family without the
// endpoint keeps the badge non-interactive (never a dead link).
function openEditHistory(postId: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('NoteHistory', {id: postId})
}

// The composer for a redrafted post: its seed is already in the handoff
// (the caller deleted the post first, so the route cannot re-fetch it).
function openRedraftComposer(postId: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Compose', {redraftId: postId})
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
// absolutely-positioned web layer, never in layout. Placement flips
// above/below (and left/right) based on viewport room.
function HoverAuthor({
  account,
  sessionId,
  backend,
  onOpenProfile,
  children,
  testID,
  style,
}: {
  account: Account
  sessionId: string
  backend?: Backend | null
  onOpenProfile: () => void
  children: React.ReactNode
  testID?: string
  /** Anchor layout: the hover zone is exactly this box. */
  style?: StyleProp<ViewStyle>
}) {
  if (Platform.OS !== 'web') return <>{children}</>
  return (
    <HoverPreview
      account={account}
      sessionId={sessionId}
      backend={backend}
      onOpenProfile={onOpenProfile}
      testID={testID}
      style={style}>
      {children}
    </HoverPreview>
  )
}

function Avatar({post, sessionId, backend}: {post: Post; sessionId: string; backend?: Backend | null}) {
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
      backend={backend}
      onOpenProfile={() => openAuthorProfile(post.author.id)}
      testID={`author-hover-${post.author.id}`}
      style={styles.avatarHover}>
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
  /** Auto-translate source (v1): when `supported`, the card fetches the
   * translation on mount and renders it instead of the body. The live
   * card derives this from the session backend; tests and previews
   * inject a fake. Omit to render the original body only. */
  translationSource?: TranslationSource | null
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
  /** Compact thread-context row (Note ancestors, X-style context above
   * the focused post): smaller body text, no action bar, no reaction
   * counts — avatar + name + body stay. Feed default is false, so
   * existing callers render exactly as before. */
  context?: boolean
  /** Hide the "Replying to @…" caption even when reply data exists.
   * The thread view sets this when the replied-to post is the row
   * rendered directly above (the spine already says it). Feeds never
   * set it — their default (false) keeps the caption. */
  hideReplyContext?: boolean
  testID?: string
  /** Screen-supplied composer/picker callbacks (override the context). */
  handlers?: PostCardHandlers
  /** Textual/URI quote fallback resolver (WS-A full-mile quotes): the
   * live card injects the session backend's `resolveQuoteUri`
   * (Misskey `ap/show`, Mastodon `/api/v2/search` + strict match);
   * tests inject fakes. Omit for no resolution — packed structured
   * quotes still render, failed lookups keep their text. */
  resolveQuoteUri?: (uri: string) => Promise<Post | null>
  /** Session-scoped seen re-seeding for the quote cache (R2.4/D3.6): the
   * live card injects the session backend's `seedSeenQuote` (Misskey
   * only — backends without a seen set omit it); tests inject fakes or
   * omit. Omit for no seeding — lookups still resolve, just with a fetch.
   * Never crosses sessions: each backend seeds only its own cache. */
  seedSeenQuote?: (note: Post) => void
  /** Device quote-display policy override (default: the appearance
   * store's `onlyAuthorizedQuotes`). When true, unauthorized quote
   * cards hide behind a tap-to-reveal row; when false (default) every
   * quote renders. */
  onlyAuthorizedQuotes?: boolean
  /** Link-preview policy override (repair X2.5, D5): `tap` shows a
   * tap-to-unfurl trigger and never fetches on its own; `auto-public`
   * auto-loads public posts only (never direct/followers/specified);
   * `off` shows no unfurl card at all. Omit to follow the device pref
   * (the live card injects it); when neither is set the legacy
   * `linkPreviewAuto` flag below decides (`true` = auto-public). */
  linkPreviewMode?: LinkPreviewMode
  /** Link-preview auto-load override (default: auto-load). The live
   * card reads the device Data Saver pref; tests inject explicitly.
   * Only consulted when `linkPreviewMode` is omitted. */
  linkPreviewAuto?: boolean
  /** Soft-mute badge override (soft-mute slice): true renders the
   * "Soft-muted" badge. The live card derives it from the session's
   * soft-mute set and the rendered author; tests and previews inject it
   * explicitly. Omit (or false) to leave the badge off — never guessed. */
  softMuted?: boolean
  /** Backend for mention → account resolution (avatar + display name
   * in chips). The live card injects the session backend; tests and
   * previews omit it — chips fall back to the handle label, never a
   * spinner. */
  backend?: Backend | null
  /** Open this post's edit history (clickstone §1.7). Omitted where the
   * backend has no history endpoint (the Misskey family): the Edited badge
   * then renders as plain text, never as a dead link. */
  onEditedPress?: () => void
}

/** Auto-translate fetch seam (v1): one `backend.translate(id, lang)`
 * call per post, driven by `PostCardView`. The fetch itself is the only
 * wire call — never invented here, only injected. */
export type TranslationSource = {
  /** `capabilities.translation === 'supported'`. False (or a missing
   * source) means the original body, silently. */
  supported: boolean
  /** Viewer language (BCP47 primary subtag); the server derives the source. */
  targetLang: string
  fetch: (id: string, targetLang: string) => Promise<Translation>
  /** Known post source language (Mastodon wire `language`), when the
   * injector knows it. Omitted/unknown never skips: an unknown language
   * fetches rather than hiding a translation the viewer needs. */
  sourceLang?: string | null
}

type LiveBits = {
  actions: PostActions
  family: 'misskey' | 'mastodon'
  menu: PostMenuSection[]
  handlers: PostCardHandlers
  translation: Translation | null
  votePoll: (postId: string, choices: number[], poll?: Poll | null) => Promise<void>
}

/** Wires the write path when session + query providers exist; otherwise
 * renders the read-only card (presentational trees, tests). */
export function PostCard(props: PostCardProps) {
  const store = useOptionalSessionStore()
  const qc = useContext(QueryClientContext)
  if (store && qc) return <LivePostCard {...props} />
  return <PostCardView {...props} />
}

// Manual-translate notice (repair X2.5): translating a private post
// sends its text to the user's own server (which may call an external
// translator), so the first such translate shows a one-line notice.
// Per-launch flag: the notice teaches, it does not nag.
let translateNoticeShown = false

function LivePostCard(props: PostCardProps) {
  const {post, sessionId} = props
  const {i18n} = useLingui()
  const queryClient = useContext(QueryClientContext)
  const store = useOptionalSessionStore()!
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const session = snapshot.sessions.find(s => s.id === sessionId) ?? null
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  const handlers = usePostCardHandlers(props.handlers)
  const effective = useMemo(() => appearNoteOf(post), [post])
  // Soft-mute badge (soft-mute slice): the feeds DROP soft-muted rows
  // (shared FeedView filter); every other surface still renders them, so
  // the card marks them honestly. The predicate is the feed's own,
  // applied to the rendered note (a pure repost's original author).
  const softMutedIds = useSoftMutedIds(sessionId)
  const softMuted = useMemo(
    () => isSoftMutedPost(effective, softMutedIds),
    [effective, softMutedIds],
  )
  const actions = usePostActions(sessionId, effective)
  const dataSaver = useDataSaver()
  // Link-preview policy (repair X2.5, D5): the device pref, with Data
  // Saver layered on top (saver on degrades `auto-public` to `tap`).
  // An explicit `linkPreviewMode` prop (tests, previews) wins.
  const prefPreviewMode = useLinkPreviewMode()
  const previewMode = props.linkPreviewMode ?? effectivePreviewMode(prefPreviewMode, dataSaver)
  const [translation, setTranslation] = useState<Translation | null>(null)
  const shown = actions.shadowed.post
  const isOwn = session != null && effective.author.id === session.accountId
  // Auto-translate source for the view: capability-gated, viewer language
  // from the post handlers (the same `targetLang ?? 'en'` the manual
  // menu row sends). Memoized so the view's fetch effect fires once per
  // post instead of once per render.
  const translationSource = useMemo<TranslationSource | null>(() => {
    if (!backend) return null
    // Viewer language, not a hardcoded 'en': the server derives the source
    // from this (v1 sends the primary subtag; servers accept full tags).
    const targetLang = handlers.targetLang ?? viewerPrimaryOf(i18n.locale)
    return {
      supported: backend.capabilities?.translation === 'supported',
      targetLang,
      fetch: (id, lang) => backend.translate(id, lang),
    }
  }, [backend, handlers.targetLang, i18n.locale])

  // Quote fallback resolver for the view (WS-A): the session backend's
  // own `resolveQuoteUri` — Misskey `ap/show`, Mastodon `/api/v2/search`.
  // Memoized so the view's lookup effect fires once per URI, not once
  // per render.
  const resolveQuoteUri = useMemo(
    () => (backend ? (uri: string) => backend.resolveQuoteUri(uri) : undefined),
    [backend],
  )

  // Seen re-seeding for the view (R2.4/D3.6): the session backend's own
  // `seedSeenQuote`, threaded alongside `resolveQuoteUri` (never through
  // the `Backend` interface directly in the view). Absent where the
  // backend has no seen set (Mastodon family) — the view then skips
  // seeding. Memoized so the view's seeding effect fires per post, not
  // per render.
  const seedSeenQuote = useMemo(
    () => (backend?.seedSeenQuote ? (note: Post) => backend.seedSeenQuote!(note) : undefined),
    [backend],
  )

  // Poll votes ride the owning session's backend (capability-gated in the
  // view). The loaded model poll travels alongside the post id so the
  // Mastodon path votes its poll id with no refetch (ADR 0010); a null
  // poll here means "no poll" on both families. Stable so the memoized
  // `live` object below holds its identity.
  const votePoll = useCallback(
    async (postId: string, choices: number[], poll?: Poll | null) => {
      if (!backend) throw new Error(i18n._(msg`Sign in to vote.`))
      await backend.votePoll(postId, choices, poll)
    },
    [backend, i18n],
  )

  // Recommendation rows (fork): the breakdown rides the OUTER wrapper
  // note, while the API takes the appeared (unwrapped) id. Hooks stay
  // above the deleted early-return: it flips mid-life and must not change
  // the hook count.
  const recBreakdown = post.ext?.recommendation ?? null
  const [recReasonOpen, setRecReasonOpen] = useState(false)

  // Post menu model: rebuilt only when its inputs change (never per
  // scroll frame), so the memoized view below keeps a stable `menu`.
  // The recommendation closures live here for the same reason.
  const menu = useMemo(
    () =>
      buildPostMenu({
        family: session?.family ?? 'misskey',
        flavor: session?.flavor ?? null,
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
          open: url => {
            // Lazy remote resolution: the mount-time warm is gone (no
            // request per rendered row), so tapping "View on remote
            // instance" resolves the AP id first and opens the human
            // page. Raw-id fallback preserved when it never resolves.
            if (effective.uri && url === effective.uri) {
              const uri = effective.uri
              void resolveRemotePostUrl(uri).then(
                resolved => void Linking.openURL(resolved ?? uri).catch(toastError),
                toastError,
              )
              return
            }
            void Linking.openURL(url).catch(toastError)
          },
          openBridgedPost: p => openPostDetail(p.id),
          openBridgedProfile: accountId => openAuthorProfile(accountId),
          // Manual translate: always sent on demand, never gated on
          // translatability or source language — the user explicitly
          // asked (the render discard below still drops a same-language
          // result). Server-side and unscoped, like every translate call.
          // Repair X2.5: the first manual translate of a private post
          // (direct/followers/specified) shows a one-line notice — its
          // text goes to the user's own server.
          translate: async () => {
            if (!backend) return
            try {
              if (needsTranslateNotice(effective.visibility.kind, translateNoticeShown)) {
                translateNoticeShown = true
                showToast(
                  i18n._(msg`Translation is handled by your server — this text will be sent to it.`),
                )
              }
              setTranslation(
                await backend.translate(effective.id, handlers.targetLang ?? viewerPrimaryOf(i18n.locale)),
              )
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
          onRedraft:
            handlers.onRedraft ??
            (backend
              ? async post => {
                  try {
                    await deleteAndRedraft(backend, post, {
                      // Same cache removal a plain delete does: the deleted post
                      // must not stay tappable in a feed behind the composer.
                      onDeleted: p => {
                        if (queryClient) patchPostInCaches(queryClient, sessionId, p.id, () => null)
                      },
                    })
                    openRedraftComposer(post.id)
                  } catch (e) {
                    // A refused delete leaves the post alone: no composer opens.
                    toastError(e)
                  }
                }
              : undefined),
          onClip: handlers.onClip,
          user: handlers.user ?? handlers.userFor?.(effective, sessionId),
        },
        ...(recBreakdown != null && backend?.recommendations
          ? {
              recommendation: {
                onWhy: () => setRecReasonOpen(true),
                onNotInterested: async () => {
                  try {
                    await backend.recommendations!.notInterested(effective.id)
                    showToast(i18n._(msg`We'll show you fewer posts like this.`))
                  } catch (e) {
                    toastError(e)
                    return
                  }
                  if (queryClient) {
                    patchPostInCaches(queryClient, sessionId, post.id, () => null)
                    if (effective.id !== post.id) {
                      patchPostInCaches(queryClient, sessionId, effective.id, () => null)
                    }
                  }
                },
              },
            }
          : {}),
      }),
    [
      session?.family,
      session?.flavor,
      session?.origin,
      backend,
      shown,
      isOwn,
      actions.bookmark,
      actions.delete,
      handlers.onEdit,
      handlers.onRedraft,
      handlers.onClip,
      handlers.user,
      handlers.userFor,
      handlers.targetLang,
      effective,
      sessionId,
      queryClient,
      post,
      i18n,
      recBreakdown,
    ],
  )

  // The view contract: one stable object per input state, so
  // `memo(PostCardView)` below skips re-renders when nothing it reads
  // changed (scroll frames, sibling toasts, stream ticks elsewhere).
  const live = useMemo<LiveBits>(
    () => ({
      actions,
      family: session?.family ?? 'misskey',
      menu,
      handlers,
      translation,
      votePoll,
    }),
    [actions, session?.family, menu, handlers, translation, votePoll],
  )

  if (actions.shadowed.isDeleted) return null

  return (
    <>
    <PostCardView
      {...props}
      capabilities={props.capabilities ?? backend?.capabilities ?? null}
      backend={props.backend ?? backend}
      translationSource={translationSource ?? props.translationSource ?? null}
      resolveQuoteUri={props.resolveQuoteUri ?? resolveQuoteUri}
      seedSeenQuote={props.seedSeenQuote ?? seedSeenQuote}
      linkPreviewMode={previewMode}
      linkPreviewAuto={props.linkPreviewAuto ?? !dataSaver}
      softMuted={props.softMuted ?? softMuted}
      onEditedPress={
        props.onEditedPress ??
        (backend?.editHistory ? () => openEditHistory(effective.id) : undefined)
      }
      live={live}
    />
    <RecommendationReasonDialog
      breakdown={recBreakdown}
      open={recReasonOpen}
      onClose={() => setRecReasonOpen(false)}
    />
    </>
  )
}

// The row body: memoized so a feed scroll that leaves this post's inputs
// untouched skips the whole subtree (menu, RichText, quote, chips). All
// tap handlers below are `useCallback`-stable for the same reason —
// otherwise `memo` (and RichText's `ctx` memo) would never hold.
const PostCardView = memo(function PostCardView({
  post,
  backend,
  capabilities,
  emojiStyle = 'twemoji',
  onMentionPress,
  onHashtagPress,
  onLinkPress,
  renoters,
  foldBody = true,
  context = false,
  hideReplyContext = false,
  testID,
  live,
  sessionId,
  translationSource,
  resolveQuoteUri,
  seedSeenQuote,
  onlyAuthorizedQuotes,
  linkPreviewMode,
  linkPreviewAuto = true,
  softMuted,
  onEditedPress,
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
  // Quote resolution lives in `useQuoteTarget` (D3.6 decomposition):
  // structured + textual/URI fallback, the async lookup, the conceal
  // gate, and the covered-URI set below. Session-id threading stays at
  // the `PostQuote` call site (R2.4).
  const {
    visibleQuote,
    resolvingQuote,
    structuredQuoteUnavailable,
    quoteStatus,
    quoteConcealed,
    setQuoteRevealed,
    coveredQuoteUris,
  } = useQuoteTarget(effective, resolveQuoteUri, onlyAuthorizedQuotes, seedSeenQuote)
  const fullNodes = useMemo(
    () => postBodyNodes(effective, {coveredQuoteUris}),
    [effective, coveredQuoteUris],
  )
  // Link-preview policy (repair X2.5, D5): the explicit mode wins;
  // otherwise the legacy `linkPreviewAuto` flag maps onto the policy
  // (`true` = auto-public, `false` = tap). Auto only ever fires for
  // public posts — direct/followers/specified stay tap-to-unfurl (or
  // hidden under `off`) regardless of pref.
  const previewPolicy = linkPreviewMode ?? (linkPreviewAuto ? 'auto-public' : 'tap')
  const unfurlAuto = shouldAutoUnfurl(previewPolicy, effective.visibility.kind)
  // E9 honest client unfurl: a bare URL with no server card gets the
  // tap-to-unfurl trigger (never an automatic fetch). Server card wins
  // when present — one card per post, never two.
  const unfurlUrl = useMemo(
    () => (effective.card !== null ? null : firstBareUrl(fullNodes, coveredQuoteUris)),
    [effective.card, fullNodes, coveredQuoteUris],
  )
  // Link chips prefer the embed's page title; a lone bare link with its
  // own embed card drops the chip (the card carries the action). The
  // count runs over the full unfolded nodes so folding never flips the
  // rule mid-scroll.
  const linkTitles = useMemo(() => {
    const card = effective.card
    if (!card) return undefined
    const url = safeHttpUrl(card.url)
    if (!url || !card.title) return undefined
    return {[url]: card.title}
  }, [effective.card])
  const hideLoneLinkChipFor = useMemo(() => {
    const bare = collectBareLinkHrefs(fullNodes)
    if (bare.length !== 1) return null
    const only = bare[0]
    if (effective.card !== null) {
      return safeHttpUrl(effective.card.url) === only ? only : null
    }
    return firstBareUrl(fullNodes, coveredQuoteUris) === only ? only : null
  }, [fullNodes, effective.card, coveredQuoteUris])
  // Timeline fold (F13): long bodies fold to the budget with an
  // in-place Show more/less toggle; the body tap still opens detail.
  const [expanded, setExpanded] = useState(false)
  const {nodes, folded} = useMemo(
    () => (foldBody && !expanded ? foldTree(fullNodes) : {nodes: fullNodes, folded: false}),
    [fullNodes, foldBody, expanded],
  )
  const emojis = useMemo(() => postEmojis(effective), [effective])
  const badges = useMemo(() => badgesFor(effective, {softMuted}), [effective, softMuted])
  // WS-B (F10): tag-block bubble — pruned block tags surface here, the
  // body stays pruned (v1 `NoteCard` parity). No bubble without blocks.
  const tagBubble = useMemo(() => postTagBubble(effective), [effective])
  const cw = effective.cw
  const bodyHidden = cw !== null && !cwOpen

  // Auto-translation lives in `useAutoTranslation` (D3.6
  // decomposition): fetch-once, skips, breaker, display policy, and the
  // translated nodes. The manual menu row (`live.translation`) wins.
  const {
    shownTranslation,
    showingTranslation,
    translatedNodes,
    showOriginal,
    setShowOriginal,
  } = useAutoTranslation({
    effective,
    fullNodes,
    translationSource,
    sessionId,
    bodyHidden,
    liveTranslation: live?.translation ?? null,
  })

  const replyTarget =
    !hideReplyContext && post.replyToId !== null ? (post.reply ?? null) : null

  // Link presses keep working when the card supplies no handler (the
  // RichText defaults: external URLs open out, bare tags open the tag
  // route) — but every one of them stamps the guard first so the body
  // press below does not double-navigate. Stable identities: they feed
  // RichText's `ctx` memo, so a fresh closure per render would invalidate
  // it. Link failures toast (LinkCard parity), never swallow.
  const handleLinkPress = useCallback(
    (href: string) => {
      markLink()
      if (onLinkPress) onLinkPress(href)
      else void Linking.openURL(href).catch(toastError)
    },
    [onLinkPress],
  )
  const handleMentionPress = useCallback(
    (href: string | null, label: string) => {
      markLink()
      if (onMentionPress) onMentionPress(href, label)
      else defaultMentionPress(href, label)
    },
    [onMentionPress],
  )
  const handleHashtagPress = useCallback(
    (tag: string) => {
      markLink()
      if (onHashtagPress) onHashtagPress(tag)
      else defaultHashtagPress(tag)
    },
    [onHashtagPress],
  )
  const openPost = useCallback(() => {
    if (Date.now() - linkGuard.current < 400) return
    openPostDetail(effective.id)
  }, [effective.id])
  const openQuoted = useCallback((quoted: {id: string}) => {
    if (Date.now() - linkGuard.current < 400) return
    openPostDetail(quoted.id)
  }, [])
  const handleReveal = useCallback(() => setQuoteRevealed(true), [])
  const handleOpenMedia = useCallback(
    (items: Media[], index: number) => setLightbox({items, index}),
    [],
  )

  // One quote card: `quoteCardProps` picks the concealed / visible /
  // unavailable winner with the same guards the three former call sites
  // used, so which quote wins cannot change. Session-id threading stays
  // here at the call site (R2.4). Memoized on the same stable handlers
  // so the quote card's props hold between data changes.
  const quoteProps = useMemo(
    () =>
      quoteCardProps({
        postId: post.id,
        sessionId,
        emojiStyle,
        visibleQuote,
        structuredQuoteUnavailable,
        quoteUnavailable: effective.quoteUnavailable,
        quoteConcealed,
        quoteStatus,
        onReveal: handleReveal,
        onPress: openQuoted,
        onOpenMedia: handleOpenMedia,
        onMentionPress: handleMentionPress,
        onHashtagPress: handleHashtagPress,
        onLinkPress: handleLinkPress,
      }),
    [
      post.id,
      sessionId,
      emojiStyle,
      visibleQuote,
      structuredQuoteUnavailable,
      effective.quoteUnavailable,
      quoteConcealed,
      quoteStatus,
      handleReveal,
      openQuoted,
      handleOpenMedia,
      handleMentionPress,
      handleHashtagPress,
      handleLinkPress,
    ],
  )

  return (
    <View style={styles.card} testID={testID ?? `post-${post.id}`}>
      {(isBoost || badges.length > 0 || replyTarget !== null) && (
        <View style={styles.contextBlock}>
          {isBoost && (
            <Caption color="muted" style={styles.context} testID={`boost-header-${post.id}`}>
              {boostLabel(post, renoters)}
            </Caption>
          )}
          {badges.length > 0 && (
            <View style={styles.badges} testID={`post-badges-${post.id}`}>
              {badges.map(b =>
                b.key === 'edited' && onEditedPress ? (
                  <Pressable
                    key={b.key}
                    testID={`post-badge-${b.key}-${post.id}`}
                    accessibilityRole="link"
                    accessibilityLabel={i18n._(msg`View edit history`)}
                    hitSlop={16}
                    onPress={onEditedPress}>
                    <Caption color="muted">{b.label}</Caption>
                  </Pressable>
                ) : (
                  <Caption key={b.key} color="muted" testID={`post-badge-${b.key}-${post.id}`}>
                    {b.label}
                  </Caption>
                ),
              )}
            </View>
          )}
          {replyTarget !== null && (
            <Caption color="muted" style={styles.context} testID={`reply-context-${post.id}`}>
              {i18n._(msg`Replying to @${replyTarget.author.acct}`)}
            </Caption>
          )}
        </View>
      )}
      <View style={styles.cardRow}>
        <Avatar post={effective} sessionId={sessionId} backend={backend} />
        <View style={styles.main}>
          <View style={styles.header}>
            {/* Hover zones hug the interactive content only: the name
              and the handle each arm the card, the time and the tag
              bubble never do — a wide zone here covered hashtags with
              profile cards. */}
            <View style={styles.headerCol}>
              <View style={styles.nameRow}>
                <HoverAuthor
                  account={effective.author}
                  sessionId={sessionId}
                  backend={backend}
                  onOpenProfile={() => openAuthorProfile(effective.author.id)}
                  testID={`author-hover-name-${effective.author.id}`}
                  style={styles.headerNameHover}>
                  <Pressable
                  testID={`author-press-${effective.author.id}`}
                  onPress={() => openAuthorProfile(effective.author.id)}
                  accessibilityRole="link"
                  accessibilityLabel={i18n._(msg`Open profile of ${displayNameOf(effective.author)}`)}
                  style={styles.headerNamePress}>
                  <DisplayName
                    account={
                      shouldCollapseName(effective.author)
                        ? {...effective.author, displayName: handleOf(effective.author)}
                        : effective.author
                    }
                    sessionId={sessionId}
                    size={15}
                    textStyle={styles.headerName}
                    testID={`author-name-${effective.author.id}`}
                  />
                </Pressable>
                </HoverAuthor>
                <Pressable
                  testID={`post-time-${effective.id}`}
                  onPress={() => openPostDetail(effective.id)}
                  accessibilityRole="link"
                  accessibilityLabel={i18n._(msg`Open post by ${displayNameOf(effective.author)}`)}
                  style={styles.headerTime}>
                  <Caption color="muted" numberOfLines={1}>
                    {`· ${formatRelativeTime(effective.createdAt, undefined, locale)}`}
                  </Caption>
                </Pressable>
                {/* WS-B (F10): tag-block bubble at the header end (v1 parity). */}
                {tagBubble.hasBlocks ? (
                  <TagBubble
                    tags={tagBubble.tags}
                    onHashtagPress={handleHashtagPress}
                    testID={`post-tags-${effective.id}`}
                  />
                ) : null}
              </View>
              {shouldCollapseName(effective.author) ? null : (
                <HoverAuthor
                  account={effective.author}
                  sessionId={sessionId}
                  backend={backend}
                  onOpenProfile={() => openAuthorProfile(effective.author.id)}
                  testID={`author-hover-handle-${effective.author.id}`}
                  style={styles.headerHandleHover}>
                  <Pressable
                    testID={`author-handle-${effective.author.id}`}
                    onPress={() => openAuthorProfile(effective.author.id)}
                    accessibilityRole="link"
                    accessibilityLabel={i18n._(msg`Open profile of ${displayNameOf(effective.author)}`)}
                    style={styles.headerHandlePress}>
                    <Caption color="muted" numberOfLines={1}>
                      {handleOf(effective.author)}
                    </Caption>
                  </Pressable>
                </HoverAuthor>
              )}
            </View>
        </View>
        {cw !== null && (
          <View style={[styles.cwBox, {backgroundColor: theme.palette.bg, borderColor: theme.palette.borderStrong}]} testID={`cw-${post.id}`}>
            <Caption color="muted">CW: {cw}</Caption>
            <Pressable
              testID={`cw-toggle-${post.id}`}
              onPress={() => setCwOpen(v => !v)}
              accessibilityRole="button"
              hitSlop={16}
              accessibilityLabel={cwOpen ? i18n._(msg`Hide content`) : i18n._(msg`Show content`)}>
              <Caption>{cwOpen ? i18n._(msg`Hide`) : i18n._(msg`Show`)}</Caption>
            </Pressable>
          </View>
        )}
        {!bodyHidden && shownTranslation !== null && (
          <Pressable
            testID={`translation-toggle-${post.id}`}
            onPress={() => setShowOriginal(v => !v)}
            accessibilityRole="button"
            hitSlop={16}
            accessibilityLabel={
              showOriginal ? i18n._(msg`Show translation`) : i18n._(msg`Show original`)
            }>
            <Caption color="muted">
              {showOriginal
                ? i18n._(msg`Showing original · Show translation?`)
                : shownTranslation.sourceLang
                  ? i18n._(msg`Translated from ${shownTranslation.sourceLang} · Show original?`)
                  : i18n._(msg`Translated · Show original?`)}
            </Caption>
          </Pressable>
        )}
        {showingTranslation ? (
          <Pressable
            testID={`post-open-${effective.id}`}
            onPress={openPost}
            accessibilityRole="link"
            accessibilityLabel={i18n._(msg`Open post by ${displayNameOf(effective.author)}`)}>
            <RichText
              nodes={translatedNodes ?? []}
              emojis={emojis}
              sessionId={sessionId}
              authorHost={effective.author.host}
              emojiStyle={emojiStyle}
              size={context ? 13 : 15}
              backend={backend}
              linkTitles={linkTitles}
              hideLoneLinkChipFor={hideLoneLinkChipFor}
              onMentionPress={handleMentionPress}
              onHashtagPress={handleHashtagPress}
              onLinkPress={handleLinkPress}
              testID={`post-translation-${post.id}`}
            />
          </Pressable>
        ) : (
          !bodyHidden && (
          <Pressable
            testID={`post-open-${effective.id}`}
            onPress={openPost}
            accessibilityRole="link"
            accessibilityLabel={i18n._(msg`Open post by ${displayNameOf(effective.author)}`)}>
            <RichText
              nodes={nodes}
              emojis={emojis}
              sessionId={sessionId}
              authorHost={effective.author.host}
              emojiStyle={emojiStyle}
              size={context ? 13 : 15}
              backend={backend}
              linkTitles={linkTitles}
              hideLoneLinkChipFor={hideLoneLinkChipFor}
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
                hitSlop={16}
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
                hitSlop={16}
                accessibilityLabel={i18n._(msg`Show less of this post`)}>
                <Caption color="muted">{i18n._(msg`Show less`)}</Caption>
              </Pressable>
            ) : null}
          </Pressable>
          )
        )}
        {!bodyHidden && <PostMediaGrid media={effective.media} onOpen={index => setLightbox({items: effective.media, index})} testID={`post-media-${post.id}`} />}
        {!bodyHidden && resolvingQuote && (
          <Caption color="muted" testID={`post-quote-resolving-${post.id}`}>
            {i18n._(msg`Resolving quote…`)}
          </Caption>
        )}
        {!bodyHidden && quoteProps !== null && <PostQuote {...quoteProps} />}
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
            onVote={live?.votePoll ? choices => live.votePoll(effective.id, choices, effective.poll) : undefined}
            testID={`post-poll-${post.id}`}
          />
        )}
        {!bodyHidden && effective.card !== null && (
          <LinkCard card={effective.card} testID={`post-card-${post.id}`} />
        )}
        {!bodyHidden && effective.card === null && unfurlUrl !== null && previewPolicy !== 'off' && (
          <UnfurledLinkCard url={unfurlUrl} auto={unfurlAuto} testID={`post-unfurl-${post.id}`} />
        )}
        {!context && (
          <ReactionChips
            reactions={effective.reactions}
            capabilities={capabilities}
            sessionId={sessionId}
            authorHost={effective.author.host}
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
        )}
        {context ? null : live ? (
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
    </View>
  )
})
