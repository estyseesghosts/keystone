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

import {postBodyNodes, postEmojis, postTagBubble} from './body'
import {PostMediaGrid} from './PostMediaGrid'
import {TagBubble} from './TagBubble'

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 10, padding: 8, marginTop: 8, gap: 4},
  head: {flexDirection: 'row', alignItems: 'center', gap: 6},
  headText: {flex: 1, minWidth: 0},
})

export function PostQuote({
  quote,
  unavailable,
  status,
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
  const nodes: ContentNode[] = postBodyNodes(quote)
  // WS-B (F10): tag-block bubble in the quote head — MFM quotes bubble
  // the pruned block tags (v1 `QuoteHead` parity); HTML quotes follow the
  // card rule (every tag when a block was pruned). No bubble without
  // blocks; the body stays pruned either way.
  const quoteTags = postTagBubble(quote)
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
        <View style={styles.head}>
          <Caption color="muted" style={styles.headText} numberOfLines={1}>
            <DisplayName
              account={collapsed ? {...quote.author, displayName: handleOf(quote.author)} : quote.author}
              size={14}
            />
            {collapsed ? null : ` @${quote.author.acct}`}
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
