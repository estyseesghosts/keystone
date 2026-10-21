// Server link-card preview (v1 `LinkCard` parity, F12).
//
// Renders the server-vetted card (`post.card`, Mastodon-family): title,
// description, and image over the linked URL. Tapping opens the page.
// An unsafe card URL renders nothing — a preview without a safe link
// is never shown. Client-side unfurl (Misskey-family, no server card)
// is not attempted here: one fetch per feed post is a cost, not a fix.
import {useState} from 'react'
import {Image, Linking, StyleSheet, View} from 'react-native'

import {safeHttpUrl, type LinkCard as LinkCardModel} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {showToast} from '#/lib/toast'

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 10, marginTop: 8, overflow: 'hidden', gap: 0},
  image: {width: '100%', aspectRatio: 16 / 9},
  body: {padding: 10, gap: 2},
})

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function LinkCard({card, testID}: {card: LinkCardModel; testID?: string}) {
  const theme = useTheme()
  const [imageFailed, setImageFailed] = useState(false)
  const url = safeHttpUrl(card.url)
  if (url === null) return null
  const imageUrl = safeHttpUrl(card.image)
  return (
    <Pressable
      testID={testID}
      onPress={() => void Linking.openURL(url).catch(e => showToast(`Could not open: ${String(e)}`))}
      accessibilityRole="link"
      accessibilityLabel={`Open link: ${card.title || url}`}>
      <View style={[styles.card, {borderColor: theme.palette.edge}]}>
        {imageUrl !== null && !imageFailed ? (
          <Image
            source={{uri: imageUrl}}
            style={styles.image}
            accessibilityRole="image"
            accessibilityLabel={card.title || url}
            onError={() => setImageFailed(true)}
          />
        ) : null}
        <View style={styles.body}>
          {card.title ? <Body numberOfLines={2}>{card.title}</Body> : null}
          {card.description ? (
            <Caption color="muted" numberOfLines={2}>
              {card.description}
            </Caption>
          ) : null}
          <Caption color="faint" numberOfLines={1}>
            {hostOf(url)}
          </Caption>
        </View>
      </View>
    </Pressable>
  )
}
