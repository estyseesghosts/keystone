// Post media (Keystone v1 layout): a lone attachment renders fit-width
// (full column width, max height 320, radius 6, hairline border); two or
// more render as a horizontal snap strip of 220px-tall items. Sensitive
// media stays behind an explicit reveal. Video/audio/file kinds render an
// honest placeholder — never a fake player, never an auto-fetch.

import {useState} from 'react'
import {Image, ScrollView, StyleSheet, View} from 'react-native'

import type {Media} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

const SINGLE_AR = 16 / 10
const STRIP_AR = 4 / 3
const STRIP_H = 220
const MAX_H = 320

const styles = StyleSheet.create({
  wrap: {marginTop: 8},
  single: {width: '100%', maxHeight: MAX_H, borderRadius: 6, borderWidth: 1, overflow: 'hidden'},
  image: {width: '100%', height: '100%'},
  strip: {flexDirection: 'row', gap: 8},
  stripItem: {height: STRIP_H, borderRadius: 6, borderWidth: 1, overflow: 'hidden'},
  placeholder: {
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 6,
  },
})

function metaAspect(item: Media): number | null {
  const meta = item.meta
  if (!meta || typeof meta !== 'object') return null
  const w = (meta as Record<string, unknown>).width
  const h = (meta as Record<string, unknown>).height
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) return w / h
  return null
}

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

function Still({
  item,
  single,
  testID,
}: {
  item: Media
  single: boolean
  testID?: string
}) {
  const theme = useTheme()
  const [failed, setFailed] = useState(false)
  const [measured, setMeasured] = useState<number | null>(null)
  if (item.url === null || failed) {
    return <Placeholder label="Image unavailable" reason="The server sent no image URL." testID={`media-missing-${item.id}`} />
  }
  const ar = measured ?? metaAspect(item) ?? (single ? SINGLE_AR : STRIP_AR)
  return (
    <View
      style={[
        single ? styles.single : styles.stripItem,
        {aspectRatio: ar, borderColor: theme.palette.border},
      ]}
      testID={testID ?? `media-${item.id}`}>
      <Image
        source={{uri: item.previewUrl ?? item.url}}
        style={styles.image}
        accessibilityRole="image"
        accessibilityLabel={item.description ?? item.name}
        onError={() => setFailed(true)}
        onLoad={e => {
          const src = (e.nativeEvent as unknown as {source?: {width?: number; height?: number}}).source
          if (src && src.width && src.height) setMeasured(src.width / src.height)
        }}
      />
    </View>
  )
}

function Other({item, single}: {item: Media; single: boolean}) {
  const theme = useTheme()
  const label =
    item.kind === 'gifv' || item.kind === 'video'
      ? 'Video'
      : item.kind === 'audio'
        ? 'Audio'
        : 'Attachment'
  return (
    <View
      style={[
        single
          ? [styles.single, {minHeight: 80}]
          : [styles.stripItem, {width: STRIP_H * STRIP_AR}],
        {borderColor: theme.palette.border},
      ]}>
      <Placeholder
        label={label}
        reason="No player is embedded here."
        testID={`media-placeholder-${item.id}`}
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
      <View style={styles.wrap} testID={testID}>
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
  if (media.length === 1) {
    const item = media[0]
    return (
      <View style={styles.wrap} testID={testID}>
        {item.kind === 'image' ? (
          <Still item={item} single />
        ) : (
          <Other item={item} single />
        )}
      </View>
    )
  }
  return (
    <View style={styles.wrap} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}>
        {media.map(item =>
          item.kind === 'image' ? (
            <Still key={item.id} item={item} single={false} />
          ) : (
            <Other key={item.id} item={item} single={false} />
          ),
        )}
      </ScrollView>
    </View>
  )
}
