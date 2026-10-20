import {useState} from 'react'
import {Image} from 'expo-image'
import {useVideoPlayer, VideoView} from 'expo-video'
import {StyleSheet, View} from 'react-native'
import type {Media} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Caption} from '#/components/Typography'
import {Button} from '#/components/Button'
import {Pressable} from '#/components/Pressable'

export type MediaGridProps = {
  media: Media[]
  /** Post-level sensitive flag (CW or server `isSensitive`). */
  sensitive?: boolean
  /** Called with the tapped tile index; the owner opens `<Lightbox>`. */
  onOpen?: (index: number) => void
  testID?: string
}

function altFor(item: Media, index: number): string {
  const label = item.description?.trim()
  if (label) return label
  const kindWord =
    item.kind === 'video' || item.kind === 'gifv'
      ? 'Video'
      : item.kind === 'audio'
        ? 'Audio'
        : item.kind === 'file'
          ? 'File attachment'
          : 'Image'
  return `${kindWord} attachment ${index + 1}${item.name ? `: ${item.name}` : ''}`
}

function VideoTile({item, index}: {item: Media; index: number}) {
  const player = useVideoPlayer(item.url ?? '', player => {
    player.loop = item.kind === 'gifv'
  })
  if (!item.url) {
    return <PendingTile index={index} />
  }
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="cover"
      accessibilityLabel={altFor(item, index)}
      style={StyleSheet.absoluteFill}
    />
  )
}

function PendingTile({index}: {index: number}) {
  const theme = useTheme()
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Attachment ${index + 1} is still processing`}
      style={[
        StyleSheet.absoluteFill,
        {backgroundColor: theme.palette.bgSoft, alignItems: 'center', justifyContent: 'center'},
      ]}>
      <Caption>Processing…</Caption>
    </View>
  )
}

export function MediaTile({
  item,
  index,
  onOpen,
}: {
  item: Media
  index: number
  onOpen?: (index: number) => void
}) {
  const theme = useTheme()
  const label = altFor(item, index)
  const inner =
    item.kind === 'image' ? (
      item.url ? (
        <Image
          source={{uri: item.previewUrl ?? item.url}}
          alt={label}
          accessibilityLabel={label}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <PendingTile index={index} />
      )
    ) : item.kind === 'video' || item.kind === 'gifv' ? (
      <VideoTile item={item} index={index} />
    ) : (
      <View
        accessibilityRole="text"
        accessibilityLabel={label}
        style={[StyleSheet.absoluteFill, {padding: space.md, justifyContent: 'center'}]}>
        <Caption numberOfLines={2}>{item.name || label}</Caption>
      </View>
    )
  if (!onOpen) {
    return (
      <View
        testID={`media-tile-${index}`}
        style={[styles.tile, {borderColor: theme.palette.border}]}>
        {inner}
      </View>
    )
  }
  return (
    <Pressable
      testID={`media-tile-${index}`}
      onPress={() => onOpen(index)}
      accessibilityRole="button"
      accessibilityLabel={`Open media: ${label}`}
      style={[styles.tile, {borderColor: theme.palette.border}]}>
      {inner}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  tile: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: 'transparent',
    aspectRatio: 16 / 9,
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 120,
  },
  single: {flexBasis: '100%', aspectRatio: 16 / 9},
  veil: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.md,
  },
})

/**
 * Grid of a post's attachments. Stills via expo-image, video/gifv via
 * expo-video; every tile carries alt text (description or a generated
 * label — never silent). Sensitive posts render a reveal veil first.
 * Tapping a tile calls `onOpen(index)`; the 3.3 Post worker owns opening
 * `<Lightbox>` with that index.
 */
export function MediaGrid({media, sensitive, onOpen, testID}: MediaGridProps) {
  const theme = useTheme()
  const [revealed, setRevealed] = useState(false)
  if (media.length === 0) return null
  const hidden = (sensitive || media.some(m => m.isSensitive)) && !revealed
  return (
    <View testID={testID} style={styles.grid}>
      {media.map((item, i) =>
        hidden ? (
          <View
            key={item.id}
            testID={`media-tile-${i}`}
            accessibilityRole="image"
            accessibilityLabel="Sensitive media hidden"
            style={[styles.tile, media.length === 1 ? styles.single : null]}>
            <View
              style={[styles.veil, {backgroundColor: theme.palette.bgSoft}]}
              testID={i === 0 ? 'media-sensitive-veil' : undefined}>
              {i === 0 ? (
                <>
                  <Button
                    label="Show sensitive media"
                    variant="secondary"
                    onPress={() => setRevealed(true)}
                    testID="media-reveal"
                  />
                  <Caption>Sensitive content hidden</Caption>
                </>
              ) : null}
            </View>
          </View>
        ) : (
          <View
            key={item.id}
            style={[styles.tile, media.length === 1 ? styles.single : null]}>
            <MediaTile item={item} index={i} onOpen={onOpen} />
          </View>
        ),
      )}
    </View>
  )
}

/** Stable alt-text helper shared with `<Lightbox>`. */
export function mediaAlt(item: Media, index: number): string {
  return altFor(item, index)
}
