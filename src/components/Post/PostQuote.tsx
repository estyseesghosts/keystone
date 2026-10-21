// Compact quote card (slices 3.3 + quote-posts doc).
//
// One level only: the quoted post renders identity + body + its own
// still images, never its own quote (no recursive embed explosion).
// Unavailable targets render an honest fallback, never a blank card.
// The card is pressable (opens the quoted post); inner links, mentions
// and tags route through the same handlers as the body.
import {StyleSheet, View} from 'react-native'

import type {ContentNode, EmojiStyle, Media, Post} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
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
  if (unavailable || quote === null) {
    return (
      <View
        testID={testID}
        accessibilityLabel="Quoted post unavailable. The target could not be shown."
        style={[styles.card, {borderColor: theme.palette.edge}]}>
        <Caption color="muted">Quoted post unavailable</Caption>
      </View>
    )
  }
  const nodes: ContentNode[] = postBodyNodes(quote)
  // One level, first four attachments of any kind: the card stays
  // compact, and the viewer opens this exact slice at the tapped index.
  const slice = quote.media.slice(0, 4)
  return (
    <Pressable
      testID={testID}
      onPress={() => onPress?.(quote)}
      accessibilityRole="link"
      accessibilityLabel={`Open quoted post by ${quote.author.displayName}`}>
      <View style={[styles.card, {borderColor: theme.palette.edge}]}>
        <Caption color="muted" numberOfLines={1}>
          {quote.author.displayName} @{quote.author.acct}
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
