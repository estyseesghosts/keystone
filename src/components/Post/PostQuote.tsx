// Compact quote card (slices 3.3 + quote-posts doc).
//
// One level only: the quoted post renders identity + body + its own
// still images, never its own quote (no recursive embed explosion).
// Unavailable targets render an honest fallback, never a blank card.

import {StyleSheet, View} from 'react-native'

import type {ContentNode, EmojiStyle, Post} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
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
  testID,
}: {
  quote: Post | null
  unavailable: boolean
  emojiStyle?: EmojiStyle
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
    <View style={[styles.card, {borderColor: theme.palette.edge}]} testID={testID}>
      <Caption color="muted" numberOfLines={1}>
        {quote.author.displayName} @{quote.author.acct}
      </Caption>
      <RichText nodes={nodes} emojis={postEmojis(quote)} emojiStyle={emojiStyle} size={14} numberOfLines={4} />
      <PostMediaGrid media={quote.media.filter(m => m.kind === 'image').slice(0, 4)} />
    </View>
  )
}
