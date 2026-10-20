import {Image} from 'expo-image'
import {useVideoPlayer, VideoView} from 'expo-video'
import {Modal, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native'
import type {Media} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {space} from '#/alf/tokens'
import {Caption} from '#/components/Typography'
import {Button} from '#/components/Button'
import {mediaAlt} from '#/components/MediaGrid'

export type LightboxProps = {
  media: Media[]
  index: number
  onIndexChange?: (index: number) => void
  onClose: () => void
  testID?: string
}

function LightboxFrame({item, index, width}: {item: Media; index: number; width: number}) {
  const alt = mediaAlt(item, index)
  if ((item.kind === 'video' || item.kind === 'gifv') && item.url) {
    return <LightboxVideo item={item} index={index} width={width} />
  }
  if (item.kind === 'image' && item.url) {
    return (
      <Image
        source={{uri: item.url}}
        alt={alt}
        accessibilityLabel={alt}
        contentFit="contain"
        style={{width, height: '100%'}}
      />
    )
  }
  return (
    <View style={{width, padding: space.xl, justifyContent: 'center'}}>
      <Caption>{alt}</Caption>
    </View>
  )
}

function LightboxVideo({item, index, width}: {item: Media; index: number; width: number}) {
  const player = useVideoPlayer(item.url ?? '', player => {
    player.loop = item.kind === 'gifv'
    player.play()
  })
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      accessibilityLabel={mediaAlt(item, index)}
      style={{width, height: '100%'}}
    />
  )
}

const styles = StyleSheet.create({
  backdrop: {...StyleSheet.absoluteFill, backgroundColor: '#000'},
  pager: {flex: 1},
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.md,
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
})

/**
 * Fullscreen media viewer. Shape follows Bluesky's `components/Lightbox`
 * (fullscreen modal + horizontal pager + alt caption + close chrome) with
 * our own code (ADR-0001). Stills via expo-image, motion via expo-video;
 * every frame carries its alt text as both `alt` and the visible caption.
 */
export function Lightbox({media, index, onIndexChange, onClose, testID}: LightboxProps) {
  const {width} = useWindowDimensions()
  if (media.length === 0) return null
  const safe = Math.min(Math.max(index, 0), media.length - 1)
  const current = media[safe]
  const alt = mediaAlt(current, safe)
  return (
    <Modal
      testID={testID}
      visible
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={[styles.backdrop, atoms.flex1]}>
        <ScrollView
          testID={testID ? `${testID}-pager` : undefined}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.pager}
          onMomentumScrollEnd={e => {
            const next = Math.round(e.nativeEvent.contentOffset.x / width)
            if (next !== safe) onIndexChange?.(next)
          }}>
          {media.map((item, i) => (
            <LightboxFrame key={item.id} item={item} index={i} width={width} />
          ))}
        </ScrollView>
        <View style={styles.chrome}>
          <Caption style={{color: '#fff'}}>
            {safe + 1} / {media.length}
          </Caption>
          <Button label="Close" variant="secondary" onPress={onClose} testID="lightbox-close" />
        </View>
        <View style={styles.caption} testID="lightbox-caption">
          <Caption style={{color: '#fff'}}>{alt}</Caption>
        </View>
      </View>
    </Modal>
  )
}
