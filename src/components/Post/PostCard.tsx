// Post row (slice 3.3): avatar, name, handle, time, CW toggle,
// RichText body, still-image grid, quote embed, renote header, reply
// context, counts, read-only reaction chips.
//
// Capability gating: write actions (reply, boost, react, menu) render
// disabled WITH their reason — hidden only when the capability is
// `unsupported`. Never wired, never inert, never faked.

import {useContext, useMemo, useState, useSyncExternalStore} from 'react'
import {Image, Linking, Share, StyleSheet, View} from 'react-native'

import {QueryClientContext} from '@tanstack/react-query'

import {
  appearNoteOf,
  backendForSession,
  type Translation,
  displayNameOf,
  handleOf,
  isPureRenote,
  type Capabilities,
  type EmojiStyle,
  type Post,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {RichText} from '#/components/RichText'
import {canCopy, copyText} from '#/lib/clipboard'
import {showToast} from '#/lib/toast'
import {usePostActions, type PostActions} from '#/state/cache'
import {useOptionalSessionStore} from '#/state/session/SessionProvider'

import {ActionBar, toastError} from './ActionBar'
import {postBodyNodes, postEmojis} from './body'
import {usePostCardHandlers, type PostCardHandlers} from './handlers'
import {buildPostMenu, type PostMenuSection} from './menuModel'
import {PostMediaGrid} from './PostMediaGrid'
import {PostQuote} from './PostQuote'
import {ReactionChips} from './ReactionChips'
import {formatRelativeTime} from './time'

const AVATAR = 40

const styles = StyleSheet.create({
  card: {flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10},
  avatar: {width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2},
  avatarFallback: {alignItems: 'center', justifyContent: 'center'},
  main: {flex: 1, gap: 2, minWidth: 0},
  header: {flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap'},
  headerName: {flexShrink: 1},
  context: {marginBottom: 2},
  counts: {flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap'},
  actions: {flexDirection: 'row', gap: 16, marginTop: 6},
  cwBox: {borderRadius: 8, padding: 8, marginTop: 4},
})

function Avatar({post}: {post: Post}) {
  const theme = useTheme()
  const [failed, setFailed] = useState(false)
  if (post.author.avatarUrl === null || failed) {
    return (
      <View
        testID={`avatar-fallback-${post.author.id}`}
        accessibilityRole="image"
        accessibilityLabel={displayNameOf(post.author)}
        style={[styles.avatar, styles.avatarFallback, {backgroundColor: theme.palette.bgSoft}]}>
        <Body>{displayNameOf(post.author).slice(0, 1).toUpperCase()}</Body>
      </View>
    )
  }
  return (
    <Image
      source={{uri: post.author.avatarUrl}}
      style={styles.avatar}
      accessibilityRole="image"
      accessibilityLabel={displayNameOf(post.author)}
      onError={() => setFailed(true)}
      testID={`avatar-${post.author.id}`}
    />
  )
}

export type PostCardProps = {
  post: Post
  /** Owning session id — accepted for the Phase-4 action wiring. */
  sessionId: string
  capabilities?: Capabilities | null
  emojiStyle?: EmojiStyle
  onMentionPress?: (href: string | null) => void
  onHashtagPress?: (tag: string) => void
  onLinkPress?: (href: string) => void
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
          showToast('Copied')
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
          showToast('Thread muted')
        } catch (e) {
          toastError(e)
        }
      },
      togglePin: async () => {
        if (!backend) return
        try {
          if (shown.pinned) await backend.unpinPost(effective.id)
          else await backend.pinPost(effective.id)
          showToast(shown.pinned ? 'Unpinned' : 'Pinned')
        } catch (e) {
          toastError(e)
        }
      },
      onEdit: handlers.onEdit,
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
  testID,
  live,
}: PostCardProps & {live?: LiveBits}) {
  const theme = useTheme()
  const [cwOpen, setCwOpen] = useState(false)

  // A pure repost shows the ORIGINAL with a boost header; a quote is
  // its own post (appearNoteOf encodes exactly this).
  const base = useMemo(() => appearNoteOf(post), [post])
  const effective = live ? live.actions.shadowed.post : base
  const isBoost = base !== post
  const nodes = useMemo(() => postBodyNodes(effective), [effective])
  const emojis = useMemo(() => postEmojis(effective), [effective])
  const cw = effective.cw
  const bodyHidden = cw !== null && !cwOpen

  const replyTarget = post.replyToId !== null ? (post.reply ?? null) : null

  return (
    <View style={styles.card} testID={testID ?? `post-${post.id}`}>
      <Avatar post={effective} />
      <View style={styles.main}>
        {isBoost && (
          <Caption color="muted" style={styles.context} testID={`boost-header-${post.id}`}>
            {displayNameOf(post.author)} boosted
          </Caption>
        )}
        {replyTarget !== null && (
          <Caption color="muted" style={styles.context} testID={`reply-context-${post.id}`}>
            Replying to @{replyTarget.author.acct}
          </Caption>
        )}
        <View style={styles.header}>
          <Body numberOfLines={1} style={styles.headerName}>
            {displayNameOf(effective.author)}
          </Body>
          <Caption color="muted" numberOfLines={1}>
            {handleOf(effective.author)} · {formatRelativeTime(effective.createdAt)}
          </Caption>
        </View>
        {cw !== null && (
          <View style={[styles.cwBox, {backgroundColor: theme.palette.bgSoft}]} testID={`cw-${post.id}`}>
            <Caption color="muted">CW: {cw}</Caption>
            <Pressable
              testID={`cw-toggle-${post.id}`}
              onPress={() => setCwOpen(v => !v)}
              accessibilityRole="button"
              accessibilityLabel={cwOpen ? 'Hide content' : 'Show content'}>
              <Caption>{cwOpen ? 'Hide' : 'Show'}</Caption>
            </Pressable>
          </View>
        )}
        {!bodyHidden && (
          <RichText
            nodes={nodes}
            emojis={emojis}
            emojiStyle={emojiStyle}
            onMentionPress={onMentionPress}
            onHashtagPress={onHashtagPress}
            onLinkPress={onLinkPress}
            testID={`post-body-${post.id}`}
          />
        )}
        {!bodyHidden && <PostMediaGrid media={effective.media} testID={`post-media-${post.id}`} />}
        {!bodyHidden && (effective.quote !== null || effective.quoteUnavailable) && (
          <PostQuote
            quote={effective.quote}
            unavailable={effective.quoteUnavailable}
            emojiStyle={emojiStyle}
            testID={`post-quote-${post.id}`}
          />
        )}
        <View style={styles.counts} testID={`post-counts-${post.id}`}>
          <Caption color="muted">
            {effective.counts.replies} replies · {effective.counts.boosts} boosts
            {effective.counts.quotes > 0 ? ` · ${effective.counts.quotes} quotes` : ''}
          </Caption>
          {effective.favourite !== null && (
            <Caption color="muted">
              {effective.favourite.count} likes{effective.favourite.mine ? ' · liked' : ''}
            </Caption>
          )}
        </View>
        {live?.translation && (
          <View style={[styles.cwBox, {backgroundColor: theme.palette.bgSoft}]} testID={`translation-${post.id}`}>
            <Caption color="muted">
              Translated{live.translation.sourceLang ? ` from ${live.translation.sourceLang}` : ''}
            </Caption>
            <Body>{live.translation.text}</Body>
            <Pressable
              testID={`translation-hide-${post.id}`}
              onPress={live.hideTranslation}
              accessibilityRole="button"
              accessibilityLabel="Hide translation">
              <Caption>Hide</Caption>
            </Pressable>
          </View>
        )}
        <ReactionChips
          reactions={effective.reactions}
          capabilities={capabilities}
          pendingKeys={live?.actions.shadowed.pendingEmojiKeys}
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
          />
        ) : (
          <View style={styles.actions}>
            <Pressable
              testID={`action-reply-${post.id}`}
              disabled
              accessibilityRole="button"
              accessibilityState={{disabled: true}}
              accessibilityLabel="Reply. Sign in to reply.">
              <Caption color="faint">Reply</Caption>
            </Pressable>
            <Pressable
              testID={`action-boost-${post.id}`}
              disabled
              accessibilityRole="button"
              accessibilityState={{disabled: true}}
              accessibilityLabel="Boost. Sign in to boost.">
              <Caption color="faint">Boost</Caption>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  )
}
