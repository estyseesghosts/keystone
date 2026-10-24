// Compact quote card (slices 3.3 + quote-posts doc, X cards per
// docs/quotes): the quoted post renders identity + body + its media,
// never its own nested card — one flat inline level instead (avatar,
// name, time, text, single thumbnail), and anything deeper stays a
// link. Unavailable targets render an honest fallback, never a blank
// card. The card is pressable (opens the quoted post); inner links,
// mentions and tags route through the same handlers as the body.

import {Image, StyleSheet, View} from 'react-native'

import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import type {ContentNode, EmojiStyle, Media, Post} from '@keystone/fedi'
import {handleOf, isPureRenote, safeHttpUrl} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {DisplayName, shouldCollapseName} from '#/components/DisplayName'
import {Pressable} from '#/components/Pressable'
import {RichText} from '#/components/RichText'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'
import {useLocale} from '#/locale/i18n'

import {postBodyNodes, postEmojis, postTagBubble} from './body'
import {PostMediaGrid} from './PostMediaGrid'
import {TagBubble} from './TagBubble'
import {formatRelativeTime} from './time'

const AVATAR_OUTER = 24
const AVATAR_NESTED = 20
const NESTED_THUMB_H = 96
const COMPACT_THUMB_H = 96

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    marginTop: 8,
    gap: 4,
    overflow: 'hidden',
  },
  head: {flexDirection: 'row', alignItems: 'center', gap: 6},
  headText: {flex: 1, minWidth: 0},
  avatar: {alignItems: 'center', justifyContent: 'center'},
  nested: {gap: 4, paddingLeft: 8, marginTop: 4},
  nestedHead: {flexDirection: 'row', alignItems: 'center', gap: 6},
  nestedRow: {flexDirection: 'row', gap: 8},
  nestedText: {flex: 1, minWidth: 0},
  nestedThumb: {borderRadius: 6, overflow: 'hidden'},
  compactRow: {flexDirection: 'row', gap: 8},
  compactText: {flex: 1, minWidth: 0},
  compactThumb: {borderRadius: 6, overflow: 'hidden'},
})

function QuoteAvatar({account, size, testID}: {account: Post['author']; size: number; testID?: string}) {
  const theme = useTheme()
  if (account.avatarUrl) {
    return (
      <Image
        source={{uri: account.avatarUrl}}
        style={{width: size, height: size, borderRadius: size / 2}}
        accessibilityRole="image"
        accessibilityLabel={`${account.displayName} profile picture`}
        testID={testID}
      />
    )
  }
  return (
    <View
      style={[
        styles.avatar,
        {width: size, height: size, borderRadius: size / 2, backgroundColor: theme.palette.raise},
      ]}
      testID={testID}>
      <Body>{account.displayName.slice(0, 1).toUpperCase()}</Body>
    </View>
  )
}

function thumbUrl(item: Media): string | null {
  if (item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'gifv') return null
  return safeHttpUrl(item.previewUrl) ?? safeHttpUrl(item.url)
}

/** One flat inline level for a quote-of-a-quote (docs/quotes §6): never
 * a card-in-a-card — a left rule, compact header, text, and at most one
 * thumbnail. Anything deeper stays unrendered. */
function NestedQuote({
  quote,
  onMentionPress,
  onHashtagPress,
  onLinkPress,
  testID,
  sessionId,
}: {
  quote: Post
  onMentionPress?: (href: string | null, label: string) => void
  onHashtagPress?: (tag: string) => void
  onLinkPress?: (href: string) => void
  testID?: string
  sessionId?: string | null
}) {
  const theme = useTheme()
  const locale = useLocale()
  const nodes: ContentNode[] = postBodyNodes(quote, {coveredQuoteUris: []})
  const thumbSource = quote.media[0] ? thumbUrl(quote.media[0]) : null
  const collapsed = shouldCollapseName(quote.author)
  return (
    <View
      testID={testID}
      style={[styles.nested, {borderLeftWidth: 2, borderLeftColor: theme.palette.border}]}>
      <View style={styles.nestedHead}>
        <QuoteAvatar
          account={quote.author}
          size={AVATAR_NESTED}
          testID={testID ? `${testID}-avatar` : undefined}
        />
        <Caption color="muted" numberOfLines={1}>
          {collapsed ? quote.author.displayName : `${quote.author.displayName} @${quote.author.acct}`} ·{' '}
          {formatRelativeTime(quote.createdAt, Date.now(), locale)}
        </Caption>
      </View>
      <View style={styles.nestedRow}>
        {thumbSource ? (
          <Image
            source={{uri: thumbSource}}
            style={[styles.nestedThumb, {height: NESTED_THUMB_H, aspectRatio: 4 / 3}]}
            accessibilityRole="image"
            accessibilityLabel={quote.media[0].description ?? quote.media[0].name ?? 'image'}
            testID={testID ? `${testID}-thumb` : undefined}
          />
        ) : null}
        <View style={styles.nestedText}>
          <RichText
            nodes={nodes}
            emojis={postEmojis(quote)}
            sessionId={sessionId}
            authorHost={quote.author.host ?? null}
            size={14}
            numberOfLines={4}
            onMentionPress={onMentionPress}
            onHashtagPress={onHashtagPress}
            onLinkPress={onLinkPress}
          />
        </View>
      </View>
    </View>
  )
}

export function PostQuote({
  quote,
  unavailable,
  status,
  concealed,
  onReveal,
  emojiStyle = 'twemoji',
  onPress,
  onOpenMedia,
  onMentionPress,
  onHashtagPress,
  onLinkPress,
  testID,
  sessionId = null,
}: {
  quote: Post | null
  unavailable: boolean
  /** Quote-authorization display label for the wrapper's relationship
   * (pending/rejected/…); null hides it. Approved/missing never label. */
  status?: string | null
  /** Tap-to-reveal gate (device "only authorized quotes" policy): the
   * card stays hidden behind a reveal row until the viewer opts in.
   * The caller owns the revealed state; the body marker stays visible
   * while concealed (strip-only-when-rendered). */
  concealed?: boolean
  onReveal?: () => void
  emojiStyle?: EmojiStyle
  onPress?: (post: Post) => void
  onOpenMedia?: (media: Media[], index: number) => void
  onMentionPress?: (href: string | null, label: string) => void
  onHashtagPress?: (tag: string) => void
  onLinkPress?: (href: string) => void
  testID?: string
  /** Owning session for the WS-C remote-emoji fallback (E1): explicit
   * wins (per-column quotes), otherwise the active session, else
   * packed-only. PostCard does not thread this yet (WS-A file) — the
   * fallback covers quotes until it does. No layout change. */
  sessionId?: string | null
}) {
  const theme = useTheme()
  const {i18n} = useLingui()
  const locale = useLocale()
  const activeId = useOptionalActiveSession()?.id ?? null
  const sid = sessionId ?? activeId
  if (concealed === true) {
    return (
      <Pressable
        testID={testID}
        onPress={() => onReveal?.()}
        accessibilityRole="button"
        accessibilityLabel={i18n._(msg`Show hidden quote`)}>
        <View
          style={[styles.card, {borderColor: theme.palette.edge, backgroundColor: theme.palette.bg}]}
          testID={testID ? `${testID}-concealed` : undefined}>
          {status ? <Caption color="muted">{status}</Caption> : null}
          <Caption color="muted">{i18n._(msg`Quote hidden — tap to reveal`)}</Caption>
        </View>
      </Pressable>
    )
  }
  if (unavailable || quote === null) {
    return (
      <View
        testID={testID}
        accessibilityLabel={i18n._(msg`Quoted post unavailable. The target could not be shown.`)}
        style={[styles.card, {borderColor: theme.palette.edge}]}>
        <Caption color="muted">{i18n._(msg`Quoted post unavailable`)}</Caption>
      </View>
    )
  }
  // One level: a quoted post never renders its own nested quote card, so
  // its markers stay visible (strip-only-when-rendered) — an empty
  // coverage list keeps every marker.
  const nodes: ContentNode[] = postBodyNodes(quote, {coveredQuoteUris: []})
  // WS-B (F10): tag-block bubble in the quote head (v1 `QuoteHead`
  // parity); HTML quotes follow the card rule (every tag when a block
  // was pruned). No bubble without blocks; the body stays pruned either
  // way.
  const quoteTags = postTagBubble(quote)
  // One level, first four attachments of any kind: the card stays
  // compact, and the viewer opens this exact slice at the tapped index.
  const slice = quote.media.slice(0, 4)
  // Name==handle collapse (v1): the handle renders AS the display name —
  // one line, no second `@acct` suffix.
  const collapsed = shouldCollapseName(quote.author)
  // The flat inline level (docs/quotes §6): the quote's own target, or
  // the packed renote of a pure-renote wrapper. A set renote id with
  // neither means the inner target is unavailable.
  const inner: Post | null =
    quote.quote ?? (isPureRenote(quote) && quote.renote ? quote.renote : null)
  const innerMissing = quote.renoteId != null && inner == null
  // Compact video row (docs/quotes): a quoted video/gifv renders as a
  // thumbnail beside the text, not a full-width player. Photos keep the
  // full-bleed card media below.
  const firstKind = slice[0]?.kind
  const compactVideo = firstKind === 'video' || firstKind === 'gifv'
  const compactThumb = compactVideo && slice[0] ? thumbUrl(slice[0]) : null
  return (
    <Pressable
      testID={testID}
      onPress={() => onPress?.(quote)}
      accessibilityRole="link"
      accessibilityLabel={i18n._(msg`Open quoted post by ${quote.author.displayName}`)}>
      <View
        style={[styles.card, {borderColor: theme.palette.edge, backgroundColor: theme.palette.bg}]}
        testID={testID ? `${testID}-card` : undefined}>
        <View style={styles.head}>
          <QuoteAvatar
            account={quote.author}
            size={AVATAR_OUTER}
            testID={testID ? `${testID}-avatar` : undefined}
          />
          <Caption color="muted" style={styles.headText} numberOfLines={1}>
            <DisplayName
              account={collapsed ? {...quote.author, displayName: handleOf(quote.author)} : quote.author}
              sessionId={sid}
              size={14}
            />
            {collapsed ? null : ` @${quote.author.acct}`} ·{' '}
            {formatRelativeTime(quote.createdAt, Date.now(), locale)}
          </Caption>
          {/* WS-B (F10): tag-block bubble at the head end (v1 parity). */}
          {quoteTags.hasBlocks ? (
            <TagBubble
              tags={quoteTags.tags}
              onHashtagPress={onHashtagPress}
              testID={testID ? `${testID}-tags` : undefined}
            />
          ) : null}
        </View>
        {status ? (
          <Caption color="muted" testID={testID ? `${testID}-status` : undefined}>
            {status}
          </Caption>
        ) : null}
        {compactVideo && compactThumb ? (
          <View style={styles.compactRow} testID={testID ? `${testID}-compact` : undefined}>
            <Image
              source={{uri: compactThumb}}
              style={[styles.compactThumb, {height: COMPACT_THUMB_H, aspectRatio: 4 / 3}]}
              accessibilityRole="image"
              accessibilityLabel={slice[0].description ?? slice[0].name ?? 'video'}
              testID={testID ? `${testID}-compact-thumb` : undefined}
            />
            <View style={styles.compactText}>
              <RichText
                nodes={nodes}
                emojis={postEmojis(quote)}
                sessionId={sid}
                authorHost={quote.author.host ?? null}
                emojiStyle={emojiStyle}
                size={14}
                numberOfLines={4}
                onMentionPress={onMentionPress}
                onHashtagPress={onHashtagPress}
                onLinkPress={onLinkPress}
              />
            </View>
          </View>
        ) : (
          <RichText
            nodes={nodes}
            emojis={postEmojis(quote)}
            sessionId={sid}
            authorHost={quote.author.host ?? null}
            emojiStyle={emojiStyle}
            size={14}
            numberOfLines={4}
            onMentionPress={onMentionPress}
            onHashtagPress={onHashtagPress}
            onLinkPress={onLinkPress}
          />
        )}
        {inner ? (
          <NestedQuote
            quote={inner}
            onMentionPress={onMentionPress}
            onHashtagPress={onHashtagPress}
            onLinkPress={onLinkPress}
            sessionId={sid}
            testID={testID ? `${testID}-nested` : undefined}
          />
        ) : innerMissing ? (
          <Caption color="faint" testID={testID ? `${testID}-nested-missing` : undefined}>
            {i18n._(msg`Quoted post unavailable`)}
          </Caption>
        ) : null}
        {!compactVideo ? (
          <PostMediaGrid
            media={slice}
            bleed
            onOpen={onOpenMedia ? index => onOpenMedia(slice, index) : undefined}
          />
        ) : null}
      </View>
    </Pressable>
  )
}
