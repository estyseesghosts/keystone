// Still-image grid (slice 3.3). Video is slice 3.8: `gifv`, `video`,
// and `audio` kinds render a placeholder box WITH the reason — never a
// fake player, never an auto-fetch. Unknown/file kinds get the same
// honest placeholder.

import {useState} from 'react'
import {Image, StyleSheet, View} from 'react-native'

import type {Media} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

const styles = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8},
  cell1: {width: '100%', aspectRatio: 16 / 9},
  cellN: {width: '48%', aspectRatio: 1},
  image: {width: '100%', height: '100%', borderRadius: 10},
  placeholder: {
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 6,
  },
})

function Placeholder({label, reason, testID}: {label: string; reason: string; testID?: string}) {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      accessibilityLabel={`${label}. ${reason}`}
      style={[styles.placeholder, {borderColor: theme.palette.edge, backgroundColor: theme.palette.bgSoft}]}>
      <Caption color="muted">{label}</Caption>
      <Caption color="faint">{reason}</Caption>
    </View>
  )
}

function Still({item, cell}: {item: Media; cell: object}) {
  const [failed, setFailed] = useState(false)
  if (item.url === null || failed) {
    return <Placeholder label="Image unavailable" reason="The server sent no image URL." testID={`media-missing-${item.id}`} />
  }
  return (
    <View style={cell} testID={`media-${item.id}`}>
      <Image
        source={{uri: item.previewUrl ?? item.url}}
        style={styles.image}
        accessibilityRole="image"
        accessibilityLabel={item.description ?? item.name}
        onError={() => setFailed(true)}
      />
    </View>
  )
}

export function PostMediaGrid({media, testID}: {media: Media[]; testID?: string}) {
  const [revealed, setRevealed] = useState(false)
  if (media.length === 0) return null
  const sensitive = media.some(m => m.isSensitive)
  if (sensitive && !revealed) {
    return (
      <View style={styles.grid} testID={testID}>
        <Pressable
          testID="media-sensitive-show"
          onPress={() => setRevealed(true)}
          accessibilityRole="button"
          accessibilityLabel="Show sensitive media. The author marked this media sensitive.">
          <Caption color="muted">Sensitive media hidden — tap to show</Caption>
        </Pressable>
      </View>
    )
  }
  const cell = media.length === 1 ? styles.cell1 : styles.cellN
  return (
    <View style={styles.grid} testID={testID}>
      {media.map(item => {
        if (item.kind === 'image') return <Still key={item.id} item={item} cell={cell} />
        const label =
          item.kind === 'gifv' || item.kind === 'video'
            ? 'Video'
            : item.kind === 'audio'
              ? 'Audio'
              : 'Attachment'
        return (
          <View key={item.id} style={[cell, {minHeight: 80}]}>
            <Placeholder
              label={label}
              reason="Playback lands in slice 3.8 — no player is faked here."
              testID={`media-placeholder-${item.id}`}
            />
          </View>
        )
      })}
    </View>
  )
}
