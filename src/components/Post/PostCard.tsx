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
  contentFromHtml,
  contentFromTranslatedText,
  collectBareLinkHrefs,
  displayNameOf,
  findTextualQuoteMarker,
  foldTree,
  handleOf,
  isPureRenote,
  registerSeenNote,
  safeHttpUrl,
  getQuoteTarget,
  statusLabelFor,
  structuredUrisOf,
  resolveRemotePostUrl,
  type Account,
  type Backend,
  type Capabilities,
  type EmojiStyle,
  type Media,
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
import {useDataSaver, useOnlyAuthorizedQuotes} from '#/state/appearance'

import {ActionBar, StaticActionBar, toastError} from './ActionBar'
import {badgesFor} from './badges'
import {postBodyNodes, postEmojis, postTagBubble} from './body'
import {usePostCardHandlers, type PostCardHandlers} from './handlers'
import {LinkCard, UnfurledLinkCard, firstBareUrl} from './LinkCard'
import {buildPostMenu, type PostMenuSection} from './menuModel'
import {decideTranslation, viewerPrimaryOf} from './translationPolicy'
import {Lightbox} from '#/components/Lightbox'
import {PostMediaGrid} from './PostMediaGrid'
import {PostPoll} from './PostPoll'
import {PostQuote} from './PostQuote'
import {TagBubble} from './TagBubble'
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
  testID?: string
  /** Screen-supplied composer/picker callbacks (override the context). */
  handlers?: PostCardHandlers
  /** Textual/URI quote fallback resolver (WS-A full-mile quotes): the
   * live card injects the session backend's `resolveQuoteUri`
   * (Misskey `ap/show`, Mastodon `/api/v2/search` + strict match);
   * tests inject fakes. Omit for no resolution — packed structured
   * quotes still render, failed lookups keep their text. */
  resolveQuoteUri?: (uri: string) => Promise<Post | null>
  /** Device quote-display policy override (default: the appearance
   * store's `onlyAuthorizedQuotes`). When true, unauthorized quote
   * cards hide behind a tap-to-reveal row; when false (default) every
   * quote renders. */
  onlyAuthorizedQuotes?: boolean
  /** Link-preview auto-load override (default: auto-load). The live
   * card reads the device Data Saver pref; tests inject explicitly. */
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
}

type LiveBits = {
  actions: PostActions
  family: 'misskey' | 'mastodon'
  menu: PostMenuSection[]
  handlers: PostCardHandlers
  translation: Translation | null
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

  if (actions.shadowed.isDeleted) return null

  const menu = buildPostMenu({
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
      open: url => void Linking.openURL(url).catch(toastError),
      translate: async () => {
        if (!backend) return
        try {
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
  })

  return (
    <PostCardView
      {...props}
      capabilities={props.capabilities ?? backend?.capabilities ?? null}
      backend={props.backend ?? backend}
      translationSource={translationSource ?? props.translationSource ?? null}
      resolveQuoteUri={props.resolveQuoteUri ?? resolveQuoteUri}
      linkPreviewAuto={props.linkPreviewAuto ?? !dataSaver}
      softMuted={props.softMuted ?? softMuted}
      onEditedPress={
        props.onEditedPress ??
        (backend?.editHistory ? () => openEditHistory(effective.id) : undefined)
      }
      live={{
        actions,
        family: session?.family ?? 'misskey',
        menu,
        handlers,
        translation,
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
  backend,
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
  translationSource,
  resolveQuoteUri,
  onlyAuthorizedQuotes,
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
  // --- Quote cards: structured + textual/URI fallback (WS-A) --------
  // The normalized target (packed renote/quote, Pinetree ext, or the
  // MFM textual fallback). Authorization status is display metadata
  // only — never a render filter by itself (the device opt-in below is
  // the only gate, and it defaults to showing everything).
  const quoteTarget = useMemo(() => getQuoteTarget(effective), [effective])
  // Server-HTML posts carry no MFM for `getQuoteTarget`: their textual
  // marker (an `RE:` line or a bare quote-URL anchor) is read off the
  // AST. Never consulted when a structured relationship exists — it wins.
  const htmlQuoteMarkerUri = useMemo(() => {
    if (quoteTarget?.source === 'structured' || !effective.content.html) return null
    return findTextualQuoteMarker(contentFromHtml(effective.content.html))?.uri ?? null
  }, [quoteTarget, effective])
  // The URI needing a lookup: a structured URI-only target with no
  // packed note and no local id, or a textual marker. Never fetched
  // when the server flagged the target unavailable (never chase
  // protected URIs) or when no resolver is wired (presentational).
  const pendingQuoteUri = useMemo(() => {
    if (resolveQuoteUri === undefined) return null
    if (effective.quote !== null) return null
    const target = quoteTarget
    if (target && target.uri && !target.targetUnavailable) {
      if (target.source === 'structured' && target.noteId) return null
      return target.uri
    }
    if (!target && htmlQuoteMarkerUri) return htmlQuoteMarkerUri
    return null
  }, [resolveQuoteUri, effective.quote, quoteTarget, htmlQuoteMarkerUri])
  // Lookup state: one resolution per URI. A finished miss never retries
  // implicitly (the backend owns its TTL); the fallback keeps the
  // original text or the honest unavailable state below.
  const [resolvedQuote, setResolvedQuote] = useState<Post | null>(null)
  const [quoteLookupFailed, setQuoteLookupFailed] = useState(false)
  const resolveRef = useRef(resolveQuoteUri)
  resolveRef.current = resolveQuoteUri
  useEffect(() => {
    setResolvedQuote(null)
    setQuoteLookupFailed(false)
    const uri = pendingQuoteUri
    const fetch = resolveRef.current
    if (uri === null || fetch === undefined) return
    let cancelled = false
    void fetch(uri).then(
      found => {
        if (cancelled) return
        setResolvedQuote(found)
        setQuoteLookupFailed(found === null)
      },
      () => {
        if (!cancelled) setQuoteLookupFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [pendingQuoteUri])
  // Notes rendered here become reuse candidates for Misskey textual
  // fallbacks (the backend's `ap/show` consults the seen set first).
  useEffect(() => {
    registerSeenNote(effective)
    if (effective.renote) registerSeenNote(effective.renote)
    if (effective.quote) registerSeenNote(effective.quote)
  }, [effective])
  // The card's target: the packed quote, or a URI that resolved to a
  // post. Anything else falls through to the resolving indicator or the
  // unavailable fallback below.
  const visibleQuote = effective.quote ?? (pendingQuoteUri !== null ? resolvedQuote : null)
  const resolvingQuote = pendingQuoteUri !== null && resolvedQuote === null && !quoteLookupFailed
  // Stable fallback for a structured relationship with no viewable
  // target (v1 parity): a renote id with no packed note (the server
  // knows it locally — no fetch), or a URI lookup that finished with
  // no post. Textual fallbacks never reach here — a failed lookup
  // keeps the original `RE:` text.
  const structuredQuoteUnavailable =
    quoteTarget?.source === 'structured' &&
    effective.quote === null &&
    (pendingQuoteUri !== null
      ? resolvedQuote === null && quoteLookupFailed
      : quoteTarget.noteId != null)
  // Quote-authorization display label for the wrapper's relationship
  // (pending/rejected/…); approved or missing never labels.
  const quoteStatus = useMemo(
    () =>
      quoteTarget?.authorizationStatus
        ? statusLabelFor(quoteTarget.authorizationStatus)
        : null,
    [quoteTarget],
  )
  // Device opt-in gate (default OFF — show everything): an
  // unauthorized card hides behind a tap-to-reveal row until the viewer
  // opts in. The body marker stays visible while concealed.
  const storeOnlyAuthorized = useOnlyAuthorizedQuotes()
  const onlyAuthorized = onlyAuthorizedQuotes ?? storeOnlyAuthorized
  const quoteUnauthorized = quoteStatus !== null
  const [quoteRevealed, setQuoteRevealed] = useState(false)
  useEffect(() => {
    setQuoteRevealed(false)
  }, [effective.id])
  const quoteConcealed =
    onlyAuthorized &&
    quoteUnauthorized &&
    (visibleQuote !== null || structuredQuoteUnavailable || effective.quoteUnavailable) &&
    !quoteRevealed
  // Body markers strip only when their card (or its honest unavailable
  // fallback) renders — otherwise the `RE:` text stays visible.
  const coveredQuoteUris = useMemo(() => {
    const out: string[] = []
    if (quoteConcealed) return out
    if (visibleQuote === null && !structuredQuoteUnavailable && !effective.quoteUnavailable) {
      return out
    }
    const push = (uri: string | null | undefined) => {
      if (uri && !out.includes(uri)) out.push(uri)
    }
    for (const uri of structuredUrisOf(effective)) push(uri)
    push(quoteTarget?.uri)
    if (visibleQuote !== null) {
      push(visibleQuote.uri)
      push(visibleQuote.url)
    }
    if (htmlQuoteMarkerUri !== null && visibleQuote !== null) push(htmlQuoteMarkerUri)
    return out
  }, [
    quoteConcealed,
    visibleQuote,
    structuredQuoteUnavailable,
    effective,
    quoteTarget,
    htmlQuoteMarkerUri,
  ])
  const fullNodes = useMemo(
    () => postBodyNodes(effective, {coveredQuoteUris}),
    [effective, coveredQuoteUris],
  )
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

  // Auto-translate (v1): on mount, when the capability is supported and
  // the post has text, fetch once and render the translation INSTEAD of
  // the body with a `Translated from XX` header above it. Unsupported
  // capability, empty text, or fetch failure = original body, no header,
  // silently. The `Post` model carries no post-language metadata, so
  // there is nothing honest to match-skip against — the viewer's
  // `targetLang` is the only gate besides capability and non-empty text.
  // The manual menu row writes `live.translation`, which wins over this.
  const [autoTranslation, setAutoTranslation] = useState<Translation | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  // Post ids already requested: one request per post, no refetch loops
  // (CW toggles and rerenders never re-fire). Reset when the post turns
  // over. Unmount cancels the in-flight update, never the request.
  const requestedFor = useRef<string | null>(null)
  useEffect(() => {
    setAutoTranslation(null)
    setShowOriginal(false)
    requestedFor.current = null
  }, [effective.id])
  const srcSupported = translationSource?.supported ?? false
  const srcLang = translationSource?.targetLang ?? 'en'
  const srcFetch = translationSource?.fetch
  useEffect(() => {
    if (!srcSupported || srcFetch === undefined) return
    if (bodyHidden) return
    if (effective.content.plain.trim() === '') return
    if (requestedFor.current === effective.id) return
    requestedFor.current = effective.id
    let cancelled = false
    void srcFetch(effective.id, srcLang).then(
      tr => {
        if (!cancelled) setAutoTranslation(tr)
      },
      () => {
        // Failure is silent by design: the original body stays, no
        // header, no toast. Keep the mark so a failure never retries
        // itself into a loop.
      },
    )
    return () => {
      cancelled = true
    }
  }, [effective.id, effective.content.plain, srcSupported, srcLang, srcFetch, bodyHidden])
  const rawTranslation = live?.translation ?? autoTranslation
  // v1 display policy: a same-text "translation" (the server echoes the
  // original for same-language posts) never renders — no header, no swap.
  // The check runs on the merged value so manual + auto share one rule.
  const decided = rawTranslation
    ? decideTranslation(effective.content.plain, rawTranslation, srcLang)
    : null
  const shownTranslation =
    rawTranslation && decided?.show === true
      ? {sourceLang: decided.label, text: rawTranslation.text}
      : null
  // The translated body replaces the original; the header above it
  // toggles back and forth. Hidden with the CW gate so a closed warning
  // never leaks the translated text early.
  const showingTranslation = !bodyHidden && shownTranslation !== null && !showOriginal
  // Translated bodies parse back into nodes (mentions/links stay live,
  // newlines survive) — the ONLY difference from the original is the
  // text content, never the chrome around it.
  const translatedNodes = useMemo(
    () => (shownTranslation ? contentFromTranslatedText(shownTranslation.text) : null),
    [shownTranslation?.text],
  )

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
    else defaultMentionPress(href, label)
  }
  const handleHashtagPress = (tag: string) => {
    markLink()
    if (onHashtagPress) onHashtagPress(tag)
    else defaultHashtagPress(tag)
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
            {badges.map(b =>
              b.key === 'edited' && onEditedPress ? (
                <Pressable
                  key={b.key}
                  testID={`post-badge-${b.key}-${post.id}`}
                  accessibilityRole="link"
                  accessibilityLabel={i18n._(msg`View edit history`)}
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
              {shouldCollapseName(effective.author) ? null : (
                <Caption color="muted" numberOfLines={1}>
                  {handleOf(effective.author)}
                </Caption>
              )}
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
          {/* WS-B (F10): tag-block bubble at the header end (v1 parity). */}
          {tagBubble.hasBlocks ? (
            <TagBubble
              tags={tagBubble.tags}
              onHashtagPress={handleHashtagPress}
              testID={`post-tags-${effective.id}`}
            />
          ) : null}
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
        {!bodyHidden && shownTranslation !== null && (
          <Pressable
            testID={`translation-toggle-${post.id}`}
            onPress={() => setShowOriginal(v => !v)}
            accessibilityRole="button"
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
          )
        )}
        {!bodyHidden && <PostMediaGrid media={effective.media} onOpen={index => setLightbox({items: effective.media, index})} testID={`post-media-${post.id}`} />}
        {!bodyHidden && resolvingQuote && (
          <Caption color="muted" testID={`post-quote-resolving-${post.id}`}>
            {i18n._(msg`Resolving quote…`)}
          </Caption>
        )}
        {!bodyHidden &&
          quoteConcealed &&
          (visibleQuote !== null || structuredQuoteUnavailable || effective.quoteUnavailable) && (
            <PostQuote
              quote={null}
              unavailable={false}
              status={quoteStatus}
              concealed
              onReveal={() => setQuoteRevealed(true)}
              emojiStyle={emojiStyle}
              onMentionPress={handleMentionPress}
              onHashtagPress={handleHashtagPress}
              onLinkPress={handleLinkPress}
              testID={`post-quote-${post.id}`}
            />
          )}
        {!bodyHidden && !quoteConcealed && visibleQuote !== null && (
          <PostQuote
            quote={visibleQuote}
            unavailable={false}
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
        {!bodyHidden &&
          !quoteConcealed &&
          visibleQuote === null &&
          (effective.quoteUnavailable || structuredQuoteUnavailable) && (
            <PostQuote
              quote={null}
              unavailable
              status={quoteStatus}
              emojiStyle={emojiStyle}
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
        {!bodyHidden && effective.card === null && unfurlUrl !== null && (
          <UnfurledLinkCard url={unfurlUrl} auto={linkPreviewAuto} testID={`post-unfurl-${post.id}`} />
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
