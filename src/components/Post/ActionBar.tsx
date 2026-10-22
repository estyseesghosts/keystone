// Post action bar (Keystone v1 look): inline muted icon + count actions —
// reply, repost (+quote), like, emoji-react, and the ⋯ menu pinned right.
// Presentational over `usePostActions` results; every control is gated and
// either works or is disabled/hidden with its reason. Signed-out trees get
// static count spans (no dead buttons).

import {StyleSheet, View} from 'react-native'
import {useRef, useState} from 'react'

import type {Capabilities, Post, ReactionSummary, ServerFamily} from '@keystone/fedi'
import {HEART_REACTION} from '@keystone/fedi'

import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
import {Menu, type MenuItem} from '#/components/Menu'
import {AnchoredPopup} from '#/components/Popup'
import {EmojiPicker} from '#/components/EmojiPicker'
import {HeartIcon, MoreIcon, ReplyIcon, RepostIcon, SmileIcon} from '#/components/icons'
import {Pressable} from '#/components/Pressable'
import {UnicodeEmoji} from '#/components/EmojiImage'
import {formatCount, i18n as lingui, useLocale} from '#/locale/i18n'
import {formatFediError, isKnownErrorCode} from '#/lib/localeErrors'
import {Image, Pressable as RNPressable, type View as ViewType} from 'react-native'
import {likeKind, type PostActions} from '#/state/cache'
import {showToast} from '#/lib/toast'

import type {PostCardHandlers} from './handlers'
import {PostMenu} from './PostMenu'
import type {PostMenuSection} from './menuModel'

const ICON = 16

const styles = StyleSheet.create({
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 5},
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  actionDisabled: {opacity: 0.5},
  spacer: {marginLeft: 'auto'},
})

const plainMessage = (e: unknown) =>
  e instanceof Error && e.message ? e.message : 'Something went wrong.'
export const toastError = (e: unknown): void => {
  // Known backend codes render localized (P5); everything else keeps the
  // server/client English message. Singleton call — safe outside providers.
  if (typeof e === 'object' && e !== null) {
    const code = (e as {code?: unknown}).code
    if (typeof code === 'string' && isKnownErrorCode(code)) {
      showToast(formatFediError(lingui, e as {code: string; params?: Record<string, unknown>}))
      return
    }
  }
  showToast(plainMessage(e))
}

function ActionContent({
  icon,
  text,
  active,
}: {
  icon: React.ReactNode
  text: string
  active?: boolean
}) {
  const theme = useTheme()
  const fg = active ? theme.palette.bg : theme.palette.muted
  return (
    <View
      style={[styles.action, active && {backgroundColor: theme.palette.text}]}>
      {icon}
      <Caption style={{color: fg}}>{text}</Caption>
    </View>
  )
}

function ActionButton({
  testID,
  label,
  icon,
  text,
  active,
  disabled,
  reason,
  onPress,
}: {
  testID: string
  label: string
  icon: React.ReactNode
  text: string
  active?: boolean
  disabled?: boolean
  reason?: string
  onPress?: () => void
}) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{disabled, selected: active}}
      accessibilityLabel={disabled && reason ? `${label}. ${reason}` : label}
      // Compact visual, 44dp effective target (P10): the row art stays
      // small but the tap area reaches the minimum.
      hitSlop={{top: 10, bottom: 10, left: 8, right: 8}}
      style={disabled && styles.actionDisabled}>
      <ActionContent icon={icon} text={text} active={active} />
    </Pressable>
  )
}

function artFor(key: string, reactions: ReactionSummary | null): string | null {
  if (!reactions) return null
  return reactions.entries.find(e => e.key === key)?.url ?? null
}

function LikeGlyph({glyphKey, url, mine, likeEmoji}: {glyphKey: string | null; url: string | null; mine: boolean; likeEmoji: string}) {
  const theme = useTheme()
  if (glyphKey && glyphKey !== likeEmoji) {
    if (url) {
      return (
        <Image
          source={{uri: url}}
          style={{width: ICON, height: ICON, resizeMode: 'contain'}}
          accessibilityIgnoresInvertColors
        />
      )
    }
    // On an active (mine) button the background is `text`, so a system-font
    // fallback must draw in `bg` — the unthemed default is invisible in
    // dark mode.
    return <UnicodeEmoji sequence={glyphKey} size={ICON} textStyle={{color: mine ? theme.palette.bg : theme.palette.text}} />
  }
  return <HeartIcon size={ICON} color={mine ? theme.palette.bg : theme.palette.muted} filled={mine} />
}

export function ActionBar({
  post,
  actions,
  family,
  capabilities,
  handlers,
  menu,
  sessionId,
  likeEmoji = HEART_REACTION,
}: {
  /** The shown (appeared) post — shadow-merged for display. */
  post: Post
  actions: PostActions
  family: ServerFamily
  capabilities: Capabilities | null
  handlers: PostCardHandlers
  menu: PostMenuSection[]
  /** Owning session (emoji picker + reaction writes bind to it). */
  sessionId: string
  /** Configured like key (F18): the button sets this, never a hardcoded heart. */
  likeEmoji?: string
}) {
  const theme = useTheme()
  const {i18n} = useLingui()
  const locale = useLocale()
  const id = post.id
  const kind = likeKind(family, capabilities)
  const muted = theme.palette.muted
  const [pickOpen, setPickOpen] = useState(false)
  const pickAnchor = useRef<ViewType | null>(null)

  const pick = (key: string, url: string | null) => {
    setPickOpen(false)
    void actions.reaction.setWithArt(key, url).catch(toastError)
  }

  const boosted = actions.renote.value
  const boostItems: MenuItem[] = [
    {
      key: 'boost',
      label: boosted ? i18n._(msg`Undo boost`) : i18n._(msg`Boost`),
      disabled: !actions.renote.gate.enabled,
      reason: actions.renote.gate.enabled ? undefined : actions.renote.gate.reason,
      onSelect: () => void actions.renote.set(!boosted).catch(toastError),
    },
  ]
  const canQuote = capabilities?.quote_posting === 'supported'
  boostItems.push(
    canQuote && handlers.onQuote
      ? {key: 'quote', label: i18n._(msg`Quote`), onSelect: () => handlers.onQuote!(post)}
      : {
          key: 'quote',
          label: i18n._(msg`Quote`),
          disabled: true,
          reason: canQuote ? i18n._(msg`No composer is connected to this view.`) : i18n._(msg`This server does not support quote posts.`),
          onSelect: () => {},
        },
  )

  let like: React.ReactNode = null
  if (kind === 'favourite') {
    const on = actions.favourite.value
    const gate = actions.favourite.gate
    const count = formatCount(locale, post.favourite?.count ?? 0)
    like = (
      <ActionButton
        testID={`action-like-${id}`}
        label={on ? i18n._(msg`Unlike, ${count} likes`) : i18n._(msg`Like, ${count} likes`)}
        icon={<HeartIcon size={ICON} color={on ? theme.palette.bg : muted} filled={on} />}
        text={String(count)}
        active={on}
        disabled={!gate.enabled}
        reason={gate.enabled ? undefined : gate.reason}
        onPress={() => void actions.favourite.set(!on).catch(toastError)}
      />
    )
  } else if (kind === 'reaction') {
    const mine = actions.reaction.value
    const gate = actions.reaction.gate
    const total = formatCount(locale, post.reactions?.total ?? 0)
    like = (
      <ActionButton
        testID={`action-react-${id}`}
        label={
          mine
            ? i18n._(msg`Liked with ${mine} — remove reaction`)
            : i18n._(msg`Like, ${total} reactions`)
        }
        icon={<LikeGlyph glyphKey={mine} url={mine ? artFor(mine, post.reactions) : null} mine={!!mine} likeEmoji={likeEmoji} />}
        text={String(total)}
        active={!!mine}
        disabled={!gate.enabled}
        reason={gate.enabled ? undefined : gate.reason}
        onPress={() => {
          if (mine) void actions.reaction.set(null).catch(toastError)
          else void actions.reaction.set(likeEmoji).catch(toastError)
        }}
      />
    )
  }

  const smileGate = actions.reaction.gate
  const showSmile = smileGate.enabled

  return (
    <View style={styles.row} testID={`post-actions-${id}`}>
      <ActionButton
        testID={`action-reply-${id}`}
        label={i18n._(msg`Reply, ${formatCount(locale, post.counts.replies)} replies`)}
        icon={<ReplyIcon size={ICON} color={muted} />}
        text={formatCount(locale, post.counts.replies)}
        disabled={!handlers.onReply}
        reason={handlers.onReply ? undefined : i18n._(msg`No composer is connected to this view.`)}
        onPress={() => handlers.onReply?.(post)}
      />
      <Menu
        testID={`action-boost-${id}`}
        label={boosted ? i18n._(msg`Repost options, already reposted`) : i18n._(msg`Repost options`)}
        items={boostItems}
        trigger={
          <ActionContent
            icon={<RepostIcon size={ICON} color={boosted ? theme.palette.bg : muted} />}
            text={formatCount(locale, post.counts.boosts)}
            active={boosted}
          />
        }
      />
      {like}
      {showSmile ? (
        <>
          <RNPressable
            ref={pickAnchor}
            testID={`action-smile-${id}`}
            onPress={() => setPickOpen(v => !v)}
            accessibilityRole="button"
            accessibilityLabel={i18n._(msg`React with emoji`)}
            hitSlop={12}>
            <ActionContent icon={<SmileIcon size={ICON} color={muted} />} text="" />
          </RNPressable>
          {pickOpen ? (
            <AnchoredPopup
              anchor={pickAnchor}
              onClose={() => setPickOpen(false)}
              testID={`action-picker-${id}`}
              minWidth={320}>
              <EmojiPicker sessionId={sessionId} onPick={e => pick(e.key, e.url ?? null)} />
            </AnchoredPopup>
          ) : null}
        </>
      ) : null}
      <View style={styles.spacer}>
        <PostMenu
          postId={id}
          sessionId={sessionId}
          sections={menu}
          trigger={
            <ActionContent icon={<MoreIcon size={ICON} color={muted} />} text="" />
          }
        />
      </View>
    </View>
  )
}

/**
 * Signed-out action row: static icon + count spans, never buttons.
 * (Keystone v1: signed-out actions render without handlers; the like slot
 * follows the post shape — favourite when present, else reactions.)
 */
export function StaticActionBar({post}: {post: Post}) {
  const locale = useLocale()
  const likeCount = post.favourite !== null ? (post.favourite?.count ?? 0) : (post.reactions?.total ?? 0)
  const muted = useTheme().palette.muted
  return (
    <View style={styles.row} testID={`post-actions-${post.id}`}>
      <ActionContent
        icon={<ReplyIcon size={ICON} color={muted} />}
        text={formatCount(locale, post.counts.replies)}
      />
      <ActionContent
        icon={<RepostIcon size={ICON} color={muted} />}
        text={formatCount(locale, post.counts.boosts)}
      />
      <ActionContent
        icon={<HeartIcon size={ICON} color={muted} />}
        text={formatCount(locale, likeCount)}
      />
    </View>
  )
}
