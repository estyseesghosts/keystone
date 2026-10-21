// Compact quote card (slices 3.3 + quote-posts doc).
//
// One level only: the quoted post renders identity + body + its own
// still images, never its own quote (no recursive embed explosion).
// Unavailable targets render an honest fallback, never a blank card.
// The card is pressable (opens the quoted post); inner links, mentions
// and tags route through the same handlers as the body.
import {StyleSheet, View} from 'react-native'

import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import type {ContentNode, EmojiStyle, Media, Post} from '@keystone/fedi'
import {handleOf} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
import {DisplayName, shouldCollapseName} from '#/components/DisplayName'
import {Pressable} from '#/components/Pressable'
import {RichText} from '#/components/RichText'

import {postBodyNodes, postEmojis} from './body'
import {PostMediaGrid} from './PostMediaGrid'

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 10, padding: 8, marginTop: 8, gap: 4},
})

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
}) {
  const theme = useTheme()
  const {i18n} = useLingui()
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
  // One level: a quoted post never renders its own nested quote card,
  // so its markers stay visible (strip-only-when-rendered) — an empty
  // coverage list keeps every marker.
  const nodes: ContentNode[] = postBodyNodes(quote, {coveredQuoteUris: []})
  // One level, first four attachments of any kind: the card stays
  // compact, and the viewer opens this exact slice at the tapped index.
  const slice = quote.media.slice(0, 4)
  // Name==handle collapse (v1): the handle renders AS the display name —
  // one line, no second `@acct` suffix.
  const collapsed = shouldCollapseName(quote.author)
  return (
    <Pressable
      testID={testID}
      onPress={() => onPress?.(quote)}
      accessibilityRole="link"
      accessibilityLabel={i18n._(msg`Open quoted post by ${quote.author.displayName}`)}>
      <View
        style={[styles.card, {borderColor: theme.palette.edge, backgroundColor: theme.palette.bg}]}
        testID={testID ? `${testID}-card` : undefined}>
        <Caption color="muted" numberOfLines={1}>
          <DisplayName
            account={collapsed ? {...quote.author, displayName: handleOf(quote.author)} : quote.author}
            size={14}
          />
          {collapsed ? null : ` @${quote.author.acct}`}
        </Caption>
        {status ? (
          <Caption color="muted" testID={testID ? `${testID}-status` : undefined}>
            {status}
          </Caption>
        ) : null}
        <RichText
          nodes={nodes}
          emojis={postEmojis(quote)}
          emojiStyle={emojiStyle}
          size={14}
          numberOfLines={4}
          onMentionPress={onMentionPress}
          onHashtagPress={onHashtagPress}
          onLinkPress={onLinkPress}
        />
        <PostMediaGrid media={slice} onOpen={onOpenMedia ? index => onOpenMedia(slice, index) : undefined} />
      </View>
    </Pressable>
  )
}
