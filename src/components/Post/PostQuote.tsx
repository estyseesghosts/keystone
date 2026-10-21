// Compact quote card (slices 3.3 + quote-posts doc).
//
// One level only: the quoted post renders identity + body + its own
// still images, never its own quote (no recursive embed explosion).
// Unavailable targets render an honest fallback, never a blank card.
// The card is pressable (opens the quoted post); inner links, mentions
// and tags route through the same handlers as the body.
import {StyleSheet, View} from 'react-native'

import type {ContentNode, EmojiStyle, Post} from '@keystone/fedi'

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
  emojiStyle = 'twemoji',
  onPress,
  onMentionPress,
  onHashtagPress,
  onLinkPress,
  testID,
}: {
  quote: Post | null
  unavailable: boolean
  emojiStyle?: EmojiStyle
  onPress?: (post: Post) => void
  onMentionPress?: (href: string | null) => void
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
        <PostMediaGrid media={quote.media.filter(m => m.kind === 'image').slice(0, 4)} />
      </View>
    </Pressable>
  )
}
