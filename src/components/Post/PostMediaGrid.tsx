// Post media (Keystone v1 layout + behavior): a lone attachment renders
// fit-width (full column width, max height 320, radius 6, hairline
// border); two or more render as a horizontal snap strip of 220px-tall
// items. Sensitive media stays behind an explicit reveal.
//
// Kind branches (v1 `NoteBody` parity): image/gifv stills, video with
// native controls, gifv as a muted autoplay loop (RN has no reliable
// animated-img; the loop matches v1's `<img gifv>` behavior), audio
// with a play/pause toggle, and files as an openable name/size card.
// Every tile opens the Lightbox at its index; unsafe URLs never fetch
// and never open (F4).
import {useEffect, useState} from 'react'
import type {ComponentProps} from 'react'
import {Image, Linking, ScrollView, StyleSheet, View} from 'react-native'
import {useVideoPlayer, VideoView} from 'expo-video'

import {safeHttpUrl, type Media} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {showToast} from '#/lib/toast'

// SDK 57 web types: `VideoView` wants the web player class while
// `useVideoPlayer` returns the native type. The runtime instance is
// correct per platform, so this cast is type-only.
type ViewPlayer = ComponentProps<typeof VideoView>['player']

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
  video: {width: '100%', height: '100%'},
  audioBox: {borderRadius: 6, borderWidth: 1, padding: 4, justifyContent: 'center', minHeight: 80},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12},
  fileMeta: {flex: 1, gap: 2},
  placeholder: {
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 6,
  },
})

export function formatBytes(size: number | null): string | null {
  if (size === null || !Number.isFinite(size) || size < 0) return null
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function metaAspect(item: Media): number | null {
  const meta = item.meta
  if (!meta || typeof meta !== 'object') return null
  const w = (meta as Record<string, unknown>).width
  const h = (meta as Record<string, unknown>).height
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) return w / h
  return null
}

export function tileAspect(item: Media, single: boolean): number {
  const ar = metaAspect(item) ?? (single ? SINGLE_AR : STRIP_AR)
  return ar
}

function TileFrame({
  item,
  single,
  index,
  aspect,
  onOpen,
  testID,
  children,
  label,
}: {
  item: Media
  single: boolean
  index: number
  aspect: number
  onOpen?: (index: number) => void
  testID?: string
  children: React.ReactNode
  label: string
}) {
  const theme = useTheme()
  return (
    <Pressable
      testID={testID ?? `media-${item.id}`}
      onPress={onOpen ? () => onOpen(index) : undefined}
      accessibilityRole={onOpen ? 'button' : 'image'}
      accessibilityLabel={onOpen ? `Open media: ${label}` : label}
      disabled={!onOpen}>
      <View
        style={[
          single ? styles.single : styles.stripItem,
          {aspectRatio: aspect, borderColor: theme.palette.border},
        ]}>
        {children}
      </View>
    </Pressable>
  )
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

function mediaLabel(item: Media): string {
  return item.description ?? item.name ?? item.kind
}

function Still({item, single, index, onOpen}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void}) {
  const [failed, setFailed] = useState(false)
  const [measured, setMeasured] = useState<number | null>(null)
  // Server strings are never trusted as image sources (F4): anything
  // but http(s) renders the missing-image placeholder, never a fetch.
  const full = safeHttpUrl(item.url)
  const preview = safeHttpUrl(item.previewUrl) ?? full
  if (full === null || preview === null || failed) {
    return <Placeholder label="Image unavailable" reason="The server sent no image URL." testID={`media-missing-${item.id}`} />
  }
  const ar = measured ?? tileAspect(item, single)
  return (
    <TileFrame item={item} single={single} index={index} aspect={ar} onOpen={onOpen} label={mediaLabel(item)}>
      <Image
        source={{uri: preview}}
        style={styles.image}
        accessibilityRole="image"
        accessibilityLabel={mediaLabel(item)}
        onError={() => setFailed(true)}
        onLoad={e => {
          const src = (e.nativeEvent as unknown as {source?: {width?: number; height?: number}}).source
          if (src && src.width && src.height) setMeasured(src.width / src.height)
        }}
      />
    </TileFrame>
  )
}

/** gifv as a muted autoplay loop (v1 shows gifv as an `<img>`; RN has no
 * reliable animated-img, and the Lightbox already loops gifv — the loop
 * matches the behavior). Tapping opens the Lightbox. */
function GifvTile({item, single, index, onOpen}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void}) {
  const url = safeHttpUrl(item.url)
  if (url === null) {
    return <Placeholder label="Video unavailable" reason="The server sent no video URL." testID={`media-missing-${item.id}`} />
  }
  return <LoopTile item={item} single={single} index={index} onOpen={onOpen} url={url} />
}

function LoopTile({item, single, index, onOpen, url}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void; url: string}) {
  const player = useVideoPlayer(url, p => {
    p.loop = true
    p.muted = true
    p.play()
  })
  return (
    <TileFrame item={item} single={single} index={index} aspect={tileAspect(item, single)} onOpen={onOpen} testID={`media-gifv-${item.id}`} label={mediaLabel(item)}>
      <VideoView player={player as unknown as ViewPlayer} contentFit="cover" style={styles.video} testID={`media-gifv-player-${item.id}`} />
    </TileFrame>
  )
}

function VideoTile({item, single, index, onOpen}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void}) {
  const url = safeHttpUrl(item.url)
  if (url === null) {
    return <Placeholder label="Video unavailable" reason="The server sent no video URL." testID={`media-missing-${item.id}`} />
  }
  return <PlayerTile item={item} single={single} index={index} onOpen={onOpen} url={url} />
}

function PlayerTile({item, single, index, onOpen, url}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void; url: string}) {
  const player = useVideoPlayer(url, p => {
    p.loop = false
  })
  return (
    <TileFrame item={item} single={single} index={index} aspect={tileAspect(item, single)} onOpen={onOpen} testID={`media-video-${item.id}`} label={mediaLabel(item)}>
      <VideoView
        player={player as unknown as ViewPlayer}
        nativeControls
        contentFit="contain"
        style={styles.video}
        testID={`media-video-player-${item.id}`}
      />
    </TileFrame>
  )
}

function AudioTile({item, index, onOpen}: {item: Media; index: number; onOpen?: (index: number) => void}) {
  const url = safeHttpUrl(item.url)
  if (url === null) {
    return <Placeholder label="Audio unavailable" reason="The server sent no audio URL." testID={`media-missing-${item.id}`} />
  }
  return <AudioPlayer item={item} index={index} onOpen={onOpen} url={url} />
}

function AudioPlayer({item, index, onOpen, url}: {item: Media; index: number; onOpen?: (index: number) => void; url: string}) {
  const theme = useTheme()
  const player = useVideoPlayer(url)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const sub = player.addListener('playingChange', ({isPlaying}) => setPlaying(isPlaying))
    return () => sub.remove()
  }, [player])
  return (
    <View
      style={[styles.audioBox, {borderColor: theme.palette.border}]}
      testID={`media-audio-${item.id}`}>
      <View style={styles.row}>
        <Pressable
          testID={`media-audio-toggle-${item.id}`}
          onPress={() => (playing ? player.pause() : player.play())}
          accessibilityRole="button"
          accessibilityLabel={playing ? `Pause ${mediaLabel(item)}` : `Play ${mediaLabel(item)}`}
          accessibilityState={{selected: playing}}>
          <Caption color="muted">{playing ? '⏸ Pause' : '▶ Play'}</Caption>
        </Pressable>
        <View style={styles.fileMeta}>
          <Caption numberOfLines={1}>{mediaLabel(item)}</Caption>
          {onOpen && (
            <Pressable testID={`media-audio-open-${item.id}`} onPress={() => onOpen(index)} accessibilityRole="link" accessibilityLabel={`Open media: ${mediaLabel(item)}`}>
              <Caption color="faint">Open in viewer</Caption>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}

function FileTile({item}: {item: Media}) {
  const theme = useTheme()
  const url = safeHttpUrl(item.url)
  const size = formatBytes(item.size)
  return (
    <View
      style={[styles.audioBox, {borderColor: theme.palette.border}]}
      testID={`media-file-${item.id}`}>
      <View style={styles.row}>
        <View style={styles.fileMeta}>
          <Caption numberOfLines={2}>{item.name || item.kind}</Caption>
          {size && <Caption color="faint">{size}</Caption>}
        </View>
        {url ? (
          <Pressable
            testID={`media-file-open-${item.id}`}
            onPress={() => void Linking.openURL(url).catch(e => showToast(`Could not open: ${String(e)}`))}
            accessibilityRole="link"
            accessibilityLabel={`Open attachment ${item.name || item.kind}`}>
            <Caption color="muted">Open</Caption>
          </Pressable>
        ) : (
          <Caption color="faint">Unavailable</Caption>
        )}
      </View>
    </View>
  )
}

export function PostMediaGrid({media, onOpen, testID}: {media: Media[]; onOpen?: (index: number) => void; testID?: string}) {
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
  const renderItem = (item: Media, i: number) => {
    const single = media.length === 1
    switch (item.kind) {
      case 'image':
        return <Still key={item.id} item={item} single={single} index={i} onOpen={onOpen} />
      case 'gifv':
        return <GifvTile key={item.id} item={item} single={single} index={i} onOpen={onOpen} />
      case 'video':
        return <VideoTile key={item.id} item={item} single={single} index={i} onOpen={onOpen} />
      case 'audio':
        return <AudioTile key={item.id} item={item} index={i} onOpen={onOpen} />
      default:
        return <FileTile key={item.id} item={item} />
    }
  }
  if (media.length === 1) {
    return (
      <View style={styles.wrap} testID={testID}>
        {renderItem(media[0], 0)}
      </View>
    )
  }
  return (
    <View style={styles.wrap} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}>
        {media.map((item, i) => renderItem(item, i))}
      </ScrollView>
    </View>
  )
}
