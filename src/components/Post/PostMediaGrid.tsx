// Post media (X-style natural sizing per docs/image-sizing.md): a lone
// attachment renders fit-width at its natural aspect ratio, clamped to
// the 2:1-landscape … 3:4-portrait display range and capped at 480px
// tall. In-range images show in full; the height cap scales down
// (letterboxes); ONLY outside shapes crop, to the clamped box. Two or
// more render as a horizontal snap strip of 220px-tall cover-crop items
// (unchanged). Sensitive media stays behind an explicit reveal.
//
// Kind branches (v1 `NoteBody` parity): image/gifv stills, video with
// native controls, gifv as a muted autoplay loop (RN has no reliable
// animated-img; the loop matches v1's `<img gifv>` behavior), audio
// with a play/pause toggle, and files as an openable name/size card.
// Every tile opens the Lightbox at its index; unsafe URLs never fetch
// and never open (F4).
import {useEffect, useState, useSyncExternalStore} from 'react'
import type {ComponentProps} from 'react'
import {Linking, ScrollView, StyleSheet, View} from 'react-native'
import {Path, Svg} from 'react-native-svg'
import {useVideoPlayer, VideoView} from 'expo-video'
import type {ImageLoadEventData} from 'expo-image'

import {msg} from '@lingui/macro'
import {useI18n} from '#/locale/i18n'

import {safeHttpUrl, type Media} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {overlayChrome} from '#/alf/themes'
import {Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {formatBytes} from '#/locale/format'
import {AppImage} from '#/components/Image'
import {mediaAlt} from '#/lib/mediaAlt'
import {Pressable} from '#/components/Pressable'
import {showToast} from '#/lib/toast'
import {useReducedMotionSetting} from '#/lib/motion'
import {appearanceStore} from '#/state/appearance'
import {releasePlayer, requestPlayerPlay, useAppActive, useIsPlayerActive} from '#/state/activePlayer'

// SDK 57 web types: `VideoView` wants the web player class while
// `useVideoPlayer` returns the native type. The runtime instance is
// correct per platform, so this cast is type-only.
type ViewPlayer = ComponentProps<typeof VideoView>['player']

const SINGLE_AR = 16 / 10
const STRIP_AR = 4 / 3
const STRIP_H = 220

/** Display ratio range (docs/image-sizing.md): full-width natural aspect
 * for everything between 2:1 landscape and 3:4 portrait. */
export const MAX_DISPLAY_AR = 2 / 1
export const MIN_DISPLAY_AR = 3 / 4

/** Absolute height bound for single post media: the ratio clamp alone
 * lets wide-column portraits run ~900px tall, so height is capped here.
 * The cap scales down (letterboxes), never crops. */
export const MAX_DISPLAY_H = 480

/** Clamp a natural aspect ratio into the display range. Non-finite and
 * non-positive inputs read as the neutral landscape default. Pure. */
export function displayAspect(ar: number): number {
  if (!Number.isFinite(ar) || ar <= 0) return SINGLE_AR
  return Math.min(MAX_DISPLAY_AR, Math.max(MIN_DISPLAY_AR, ar))
}

/** True when the natural ratio falls outside the display range — the
 * ONLY case that crops (to the clamped box). Everything else, including
 * height-capped portraits, scales to fit. Pure. */
export function isOutOfRange(natural: number): boolean {
  if (!Number.isFinite(natural) || natural <= 0) return false
  return natural < MIN_DISPLAY_AR || natural > MAX_DISPLAY_AR
}

const styles = StyleSheet.create({
  wrap: {marginTop: 8},
  /** Edge-to-edge wrap inside a quote card (cancels the card's padding;
   * the media reaches the card border, corners clipped by its overflow). */
  bleedWrap: {marginHorizontal: -8, marginBottom: -8},
  // Singles size per-frame below (hug the displayed image, left-justified
  // like post content); this holds only the shared chrome.
  single: {maxHeight: MAX_DISPLAY_H, borderRadius: 6, borderWidth: 1, overflow: 'hidden'},
  image: {width: '100%', height: '100%'},
  strip: {flexDirection: 'row', gap: 8},
  stripItem: {height: STRIP_H, borderRadius: 6, borderWidth: 1, overflow: 'hidden'},
  /** Edge-to-edge frame inside a quote card: the card's own border
   * delineates, so the inner border goes (corners clip via the card's
   * overflow, set by the quote). */
  bleedFrame: {borderWidth: 0, borderRadius: 0},
  video: {width: '100%', height: '100%'},
  audioBox: {borderRadius: 6, borderWidth: 1, padding: 4, justifyContent: 'center', minHeight: 80},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12},
  /** Audio toggle: the 44pt floor lives in layout (not hitSlop math), so
   * the target holds with short labels in every locale. */
  audioToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 44,
    minHeight: 44,
  },
  /** Play affordance over an unplaying gifv (reduce-motion / data-saver):
   * sanctioned scrim chrome, never a hardcoded literal. */
  playAffordance: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: overlayChrome.captionScrim,
  },
  fileMeta: {flex: 1, gap: 2},
  placeholder: {
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 6,
  },
  /** Revealed-sensitive re-hide: an overlay sibling of the tile (never
   * nested inside its Lightbox pressable, so one tap cannot both hide
   * and open). The 44pt floor keeps the target reachable in every locale. */
  revealedWrap: {alignSelf: 'flex-start', position: 'relative'},
  hideButton: {
    position: 'absolute',
    top: 8,
    end: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: overlayChrome.captionScrim,
  },
  /** Sensitive cover chrome over the blurhash: the scrim keeps the label
   * and the Show control legible on any blur. */
  sensitiveShade: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 8,
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

export function tileAspect(item: Media, single: boolean): number {
  if (!single) {
    // Strip tiles share the display clamp (repair X7.3, media M7): an
    // unclamped 10:1 panorama becomes a 2200px-wide tile and a 1:10
    // portrait a 22px sliver at the fixed 220px strip height. Both crop
    // (`cover`) to the clamped box instead.
    return displayAspect(metaAspect(item) ?? STRIP_AR)
  }
  // Singles show the natural ratio clamped to the display range: in-range
  // images render in full, only outside shapes crop to the clamped box.
  return displayAspect(metaAspect(item) ?? SINGLE_AR)
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
  bleed,
}: {
  item: Media
  single: boolean
  index: number
  aspect: number
  onOpen?: (index: number) => void
  testID?: string
  children: React.ReactNode
  label: string
  /** Edge-to-edge inside a quote card: no inner border (the card's own
   * border delineates), corners clipped by the card's overflow. */
  bleed?: boolean
}) {
  const theme = useTheme()
  const i18n = useI18n()
  return (
    <Pressable
      testID={testID ?? `media-${item.id}`}
      onPress={onOpen ? () => onOpen(index) : undefined}
      accessibilityRole={onOpen ? 'button' : 'image'}
      accessibilityLabel={onOpen ? i18n._(msg`Open media: ${label}`) : label}
      disabled={!onOpen}
      // Shrink-wrap: the pressable hugs the displayed frame instead of
      // stretching full row width (no dead click area beside a
      // narrower image). Singles sit in a column wrap (hug
      // horizontally); strip tiles sit in a row (hug vertically, widths
      // already hug). maxWidth only for singles: strip tiles scroll
      // horizontally and must keep their aspect widths.
      style={[{alignSelf: 'flex-start'}, single ? {maxWidth: '100%'} : null]}>
      <View
        style={[
          single ? styles.single : styles.stripItem,
          {aspectRatio: aspect, borderColor: theme.palette.border},
          // Shrink-to-fit: the frame hugs the displayed image instead of
          // forcing full width (no side bars inside the border).
          // Uncapped images hit maxWidth and stay full-width; capped ones
          // hug at 480 × aspect, left-justified like post content.
          ...(single ? [{width: MAX_DISPLAY_H * aspect, maxWidth: '100%'} as const] : []),
          bleed ? styles.bleedFrame : null,
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

/** Vector play triangle (real icon, never a unicode glyph). Defaults to
 * the theme text; pass the scrim foreground on dark overlays. */
function PlayGlyph({size = 24, color, testID}: {size?: number; color?: string; testID?: string}) {
  const theme = useTheme()
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color ?? theme.palette.text}
      testID={testID}
      accessibilityIgnoresInvertColors>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  )
}

/** Vector pause bars (real icon, never a unicode glyph). */
function PauseGlyph({size = 24, color, testID}: {size?: number; color?: string; testID?: string}) {
  const theme = useTheme()
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color ?? theme.palette.text}
      testID={testID}
      accessibilityIgnoresInvertColors>
      <Path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </Svg>
  )
}

function subscribeDataSaver(fn: () => void): () => void {
  return appearanceStore.subscribe(fn)
}

/** Data-saver pref that never crashes the feed: a prefs read that throws
 * (no storage on a bare tree) falls back to full autoplay, and the real
 * value flows once storage answers. Module-level seam so the hook below
 * keeps stable subscribe/snapshot identities. */
function readDataSaverSafe(): boolean {
  try {
    return appearanceStore.getDataSaver()
  } catch {
    return false
  }
}

function useDataSaverSafe(): boolean {
  return useSyncExternalStore(subscribeDataSaver, readDataSaverSafe, readDataSaverSafe)
}

function Still({item, single, index, onOpen, bleed}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void; bleed?: boolean}) {
  const [failed, setFailed] = useState(false)
  const [measured, setMeasured] = useState<number | null>(null)
  const i18n = useI18n()
  // Server strings are never trusted as image sources (F4): anything
  // but http(s) renders the missing-image placeholder, never a fetch.
  const full = safeHttpUrl(item.url)
  const preview = safeHttpUrl(item.previewUrl) ?? full
  if (full === null || preview === null || failed) {
    return (
      <Placeholder
        label={i18n._(msg`Image unavailable`)}
        reason={i18n._(msg`The server sent no image URL.`)}
        testID={`media-missing-${item.id}`}
      />
    )
  }
  // Singles: full-width natural ratio clamped to the display range, and
  // the whole image shows EXCEPT outside shapes, which crop to the
  // clamped box. Capped portraits scale down (letterbox), never crop.
  const natural = measured ?? metaAspect(item) ?? SINGLE_AR
  const ar = single ? displayAspect(natural) : tileAspect(item, single)
  const crop = single && isOutOfRange(natural)
  // Repair X7.3 (media M15): the accessible label falls back to the
  // generated `mediaAlt` text ("Image 2 of 4"), never the bare kind.
  const label = mediaAlt(item, index)
  return (
    <TileFrame item={item} single={single} index={index} aspect={ar} onOpen={onOpen} label={label} bleed={bleed}>
      <AppImage
        uri={preview}
        blurhash={item.blurhash}
        contentFit={crop || !single ? 'cover' : 'contain'}
        recyclingKey={item.id}
        alt={label}
        accessibilityLabel={label}
        accessibilityRole="image"
        testID={`media-still-${item.id}`}
        style={styles.image}
        onError={() => setFailed(true)}
        onLoad={(e?: ImageLoadEventData) => {
          // expo-image reports the decoded size on the event (not
          // `nativeEvent`): a meta-less frame re-fits once known, so the
          // blurhash placeholder holds layout until then (media M7).
          const w = e?.source?.width
          const h = e?.source?.height
          if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) setMeasured(w / h)
        }}
      />
    </TileFrame>
  )
}

/** gifv as a muted autoplay loop (v1 shows gifv as an `<img>`; RN has no
 * reliable animated-img, and the Lightbox already loops gifv — the loop
 * matches the behavior). Tapping opens the Lightbox. */
function GifvTile({item, single, index, onOpen, active, bleed}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void; active: boolean; bleed?: boolean}) {
  const i18n = useI18n()
  const url = safeHttpUrl(item.url)
  if (url === null) {
    return (
      <Placeholder
        label={i18n._(msg`Video unavailable`)}
        reason={i18n._(msg`The server sent no video URL.`)}
        testID={`media-missing-${item.id}`}
      />
    )
  }
  return <LoopTile item={item} single={single} index={index} onOpen={onOpen} url={url} active={active} bleed={bleed} />
}

function LoopTile({item, single, index, onOpen, url, active, bleed}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void; url: string; active: boolean; bleed?: boolean}) {
  const i18n = useI18n()
  const player = useVideoPlayer(url, p => {
    p.loop = true
    p.muted = true
  })
  // Autoplay policy (media M5): reduce-motion and the data-saver pref both
  // suppress autoplay — the tile shows a play affordance instead. A manual
  // tap always wins (the user explicitly asked).
  const reduceMotion = useReducedMotionSetting()
  const dataSaver = useDataSaverSafe()
  const appActive = useAppActive()
  const playerId = `gifv:${item.id}`
  const isCurrent = useIsPlayerActive(playerId)
  const [manualPlay, setManualPlay] = useState(false)
  const autoplayAllowed = !reduceMotion && !dataSaver
  // Viewability-driven `active` (the list's viewable rows): the tile plays
  // only while viewable, foregrounded, allowed-or-tapped, AND holding the
  // single global slot — scroll-off, blur (the list suspends the store),
  // backgrounding, policy, and preemption all pause it.
  const wantsPlay = active && appActive && (autoplayAllowed || manualPlay)
  useEffect(() => {
    if (wantsPlay) requestPlayerPlay(playerId)
    else releasePlayer(playerId)
  }, [wantsPlay, playerId])
  useEffect(() => {
    if (wantsPlay && isCurrent) player.play()
    else player.pause()
  }, [player, wantsPlay, isCurrent])
  // Unmount (row recycle, navigation away): leave the slot and stop decoding.
  useEffect(
    () => () => {
      releasePlayer(playerId)
      try {
        player.pause()
      } catch {
        // Best-effort: the player may already be released.
      }
    },
    [player, playerId],
  )
  // Singles crop only outside shapes (no measured path for video — meta
  // only); in-range loops fit like stills, strip keeps cover.
  const crop = single && isOutOfRange(metaAspect(item) ?? SINGLE_AR)
  const showAffordance = !autoplayAllowed && !manualPlay
  return (
    <TileFrame item={item} single={single} index={index} aspect={tileAspect(item, single)} onOpen={onOpen} testID={`media-gifv-${item.id}`} label={mediaLabel(item)} bleed={bleed}>
      <VideoView player={player as unknown as ViewPlayer} contentFit={crop || !single ? 'cover' : 'contain'} style={styles.video} testID={`media-gifv-player-${item.id}`} />
      {showAffordance ? (
        <Pressable
          testID={`media-gifv-play-${item.id}`}
          onPress={() => setManualPlay(true)}
          accessibilityRole="button"
          accessibilityLabel={i18n._(msg`Play ${mediaLabel(item)}`)}
          hitSlop={12}
          style={styles.playAffordance}>
          <PlayGlyph testID={`media-gifv-play-icon-${item.id}`} color={overlayChrome.fg} />
          <Caption style={{color: overlayChrome.fg}}>{i18n._(msg`Play`)}</Caption>
        </Pressable>
      ) : null}
    </TileFrame>
  )
}

function VideoTile({item, single, index, onOpen, active, bleed}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void; active: boolean; bleed?: boolean}) {
  const i18n = useI18n()
  const url = safeHttpUrl(item.url)
  if (url === null) {
    return (
      <Placeholder
        label={i18n._(msg`Video unavailable`)}
        reason={i18n._(msg`The server sent no video URL.`)}
        testID={`media-missing-${item.id}`}
      />
    )
  }
  return <PlayerTile item={item} single={single} index={index} onOpen={onOpen} url={url} active={active} bleed={bleed} />
}

function PlayerTile({item, single, index, onOpen, url, active, bleed}: {item: Media; single: boolean; index: number; onOpen?: (index: number) => void; url: string; active: boolean; bleed?: boolean}) {
  const player = useVideoPlayer(url, p => {
    p.loop = false
  })
  // Single-global-player membership for user-started video (native controls
  // own the start — this tile never auto-plays): starting here preempts any
  // gifv/audio elsewhere, and scroll-off, backgrounding, blur, or
  // preemption pauses here. Unmount releases and stops.
  const playerId = `video:${item.id}`
  const isCurrent = useIsPlayerActive(playerId)
  const appActive = useAppActive()
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (typeof player.addListener !== 'function') return
    const sub = player.addListener('playingChange', ({isPlaying}: {isPlaying: boolean}) => {
      const next = isPlaying === true
      setPlaying(next)
      if (next) requestPlayerPlay(playerId)
    })
    return () => {
      try {
        sub.remove()
      } catch {
        // Best-effort teardown.
      }
    }
  }, [player, playerId])
  useEffect(() => {
    if (playing && (!active || !appActive || !isCurrent)) {
      try {
        player.pause()
      } catch {
        // Best-effort: the player may already be released.
      }
    }
  }, [player, playing, active, appActive, isCurrent])
  useEffect(
    () => () => {
      releasePlayer(playerId)
      try {
        player.pause()
      } catch {
        // Best-effort: the player may already be released.
      }
    },
    [player, playerId],
  )
  return (
    <TileFrame item={item} single={single} index={index} aspect={tileAspect(item, single)} onOpen={onOpen} testID={`media-video-${item.id}`} label={mediaLabel(item)} bleed={bleed}>
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

function AudioTile({item, index, onOpen, active}: {item: Media; index: number; onOpen?: (index: number) => void; active: boolean}) {
  const i18n = useI18n()
  const url = safeHttpUrl(item.url)
  if (url === null) {
    return <Placeholder label={i18n._(msg`Audio unavailable`)} reason={i18n._(msg`The server sent no audio URL.`)} testID={`media-missing-${item.id}`} />
  }
  return <AudioPlayer item={item} index={index} onOpen={onOpen} url={url} active={active} />
}

function AudioPlayer({item, index, onOpen, url, active}: {item: Media; index: number; onOpen?: (index: number) => void; url: string; active: boolean}) {
  const theme = useTheme()
  const i18n = useI18n()
  const player = useVideoPlayer(url)
  // Same single-global membership as video: starting here preempts any
  // other player, and scroll-off, backgrounding, blur, or preemption
  // pauses here. Unmount releases and stops.
  const playerId = `audio:${item.id}`
  const isCurrent = useIsPlayerActive(playerId)
  const appActive = useAppActive()
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (typeof player.addListener !== 'function') return
    const sub = player.addListener('playingChange', ({isPlaying}: {isPlaying: boolean}) => {
      const next = isPlaying === true
      setPlaying(next)
      if (next) requestPlayerPlay(playerId)
    })
    return () => {
      try {
        sub.remove()
      } catch {
        // Best-effort teardown.
      }
    }
  }, [player, playerId])
  useEffect(() => {
    if (playing && (!active || !appActive || !isCurrent)) {
      try {
        player.pause()
      } catch {
        // Best-effort: the player may already be released.
      }
    }
  }, [player, playing, active, appActive, isCurrent])
  useEffect(
    () => () => {
      releasePlayer(playerId)
      try {
        player.pause()
      } catch {
        // Best-effort: the player may already be released.
      }
    },
    [player, playerId],
  )
  return (
    <View
      style={[styles.audioBox, {borderColor: theme.palette.border}]}
      testID={`media-audio-${item.id}`}>
      <View style={styles.row}>
        <Pressable
          testID={`media-audio-toggle-${item.id}`}
          onPress={() => {
            if (playing) player.pause()
            else {
              requestPlayerPlay(playerId)
              player.play()
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={playing ? i18n._(msg`Pause ${mediaLabel(item)}`) : i18n._(msg`Play ${mediaLabel(item)}`)}
          accessibilityState={{selected: playing}}
          hitSlop={12}
          style={styles.audioToggle}>
          {playing ? (
            <PauseGlyph testID={`media-audio-icon-${item.id}`} />
          ) : (
            <PlayGlyph testID={`media-audio-icon-${item.id}`} />
          )}
          <Caption color="muted">{playing ? i18n._(msg`Pause`) : i18n._(msg`Play`)}</Caption>
        </Pressable>
        <View style={styles.fileMeta}>
          <Caption numberOfLines={1}>{mediaLabel(item)}</Caption>
          {onOpen && (
            <Pressable testID={`media-audio-open-${item.id}`} onPress={() => onOpen(index)} accessibilityRole="link" accessibilityLabel={i18n._(msg`Open media: ${mediaLabel(item)}`)}>
              <Caption color="faint">{i18n._(msg`Open in viewer`)}</Caption>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}

function FileTile({item}: {item: Media}) {
  const theme = useTheme()
  const i18n = useI18n()
  const url = safeHttpUrl(item.url)
  const size = formatBytes(item.size, i18n.locale)
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
            onPress={() => void Linking.openURL(url).catch(() => showToast(i18n._(msg`Could not open this link.`)))}
            accessibilityRole="link"
            accessibilityLabel={i18n._(msg`Open attachment ${item.name || item.kind}`)}>
            <Caption color="muted">{i18n._(msg`Open`)}</Caption>
          </Pressable>
        ) : (
          <Caption color="faint">{i18n._(msg`Unavailable`)}</Caption>
        )}
      </View>
    </View>
  )
}

/** A hidden sensitive tile (repair X7.3, media M14): a blurred blurhash
 * cover — never a blank box, and never a fetch (the wrapper renders the
 * placeholder only, so nothing sensitive loads before reveal). The frame
 * reserves the same aspect the revealed tile will use, so revealing never
 * shifts the post height. An explicit Show control reveals; a Hide
 * control on the revealed tile re-hides. */
function SensitiveCover({
  item,
  single,
  index,
  aspect,
  bleed,
  onShow,
}: {
  item: Media
  single: boolean
  index: number
  aspect: number
  bleed?: boolean
  onShow: (id: string) => void
}) {
  const theme = useTheme()
  const i18n = useI18n()
  const hiddenLabel = i18n._(msg`Sensitive media hidden. The author marked this media sensitive.`)
  return (
    <TileFrame
      item={item}
      single={single}
      index={index}
      aspect={aspect}
      label={hiddenLabel}
      bleed={bleed}
      testID={`media-sensitive-cover-${item.id}`}>
      {item.blurhash ? (
        <AppImage
          uri={null}
          blurhash={item.blurhash}
          contentFit="cover"
          recyclingKey={`sensitive:${item.id}`}
          accessibilityLabel={hiddenLabel}
          testID={`media-sensitive-blur-${item.id}`}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, {backgroundColor: theme.palette.bgSoft}]} />
      )}
      <View style={[styles.sensitiveShade, {backgroundColor: overlayChrome.captionScrim}]}>
        <Caption style={{color: overlayChrome.fg}}>{i18n._(msg`Sensitive media hidden — tap to show`)}</Caption>
        <Button
          label={i18n._(msg`Show`)}
          variant="primary"
          onPress={() => onShow(item.id)}
          testID={`media-sensitive-show-${item.id}`}
        />
      </View>
    </TileFrame>
  )
}

/** Re-hide affordance for a revealed sensitive tile: an overlay sibling
 * of the tile (never nested in its Lightbox pressable, so one tap cannot
 * both hide and open). */
function RevealedSensitive({item, onHide, children}: {item: Media; onHide: (id: string) => void; children: React.ReactNode}) {
  const i18n = useI18n()
  return (
    <View testID={`media-sensitive-revealed-${item.id}`} style={styles.revealedWrap}>
      {children}
      <Pressable
        testID={`media-sensitive-hide-${item.id}`}
        onPress={() => onHide(item.id)}
        accessibilityRole="button"
        accessibilityLabel={i18n._(msg`Hide sensitive media`)}
        hitSlop={12}
        style={styles.hideButton}>
        <Caption style={{color: overlayChrome.fg}}>{i18n._(msg`Hide`)}</Caption>
      </Pressable>
    </View>
  )
}

export function PostMediaGrid({media, onOpen, testID, bleed, active = true}: {media: Media[]; onOpen?: (index: number) => void; testID?: string; bleed?: boolean; active?: boolean}) {
  // Per-tile reveal, keyed by media id (repair X7.3, media M14): revealing
  // one sensitive attachment leaves every other hidden tile behind its
  // own gate (v1 `NoteBody`). Ids — not indices — survive row recycling
  // (a recycled instance keeps stale ids that simply never match the new
  // row's items) and array reorder.
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set())
  const reveal = (id: string) =>
    setRevealedIds(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  const conceal = (id: string) =>
    setRevealedIds(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  if (media.length === 0) return null
  const renderItem = (item: Media, i: number) => {
    const single = media.length === 1
    if (item.isSensitive && !revealedIds.has(item.id)) {
      // Singles and strip tiles share the cover: the frame reserves the
      // revealed aspect up front, so showing never shifts the post height.
      const aspect = single ? displayAspect(metaAspect(item) ?? SINGLE_AR) : tileAspect(item, false)
      return <SensitiveCover key={item.id} item={item} single={single} index={i} aspect={aspect} bleed={bleed} onShow={reveal} />
    }
    // Viewability-driven `active` (repair X7.2, media M5): the list marks
    // viewable rows; the grid plays at most its first gifv while active,
    // and video/audio tiles pause on scroll-off through their own `active`.
    // Outside a list (detail, quotes) `active` defaults to true. The single
    // global slot in `#/state/activePlayer` still bounds N visible posts to
    // the configured maximum (default 1).
    const gifvActive = (index: number) => active && index === 0
    let tile: React.ReactNode
    switch (item.kind) {
      case 'image':
        tile = <Still key={item.id} item={item} single={single} index={i} onOpen={onOpen} bleed={bleed} />
        break
      case 'gifv':
        tile = <GifvTile key={item.id} item={item} single={single} index={i} onOpen={onOpen} active={gifvActive(i)} bleed={bleed} />
        break
      case 'video':
        tile = <VideoTile key={item.id} item={item} single={single} index={i} onOpen={onOpen} active={active} bleed={bleed} />
        break
      case 'audio':
        tile = <AudioTile key={item.id} item={item} index={i} onOpen={onOpen} active={active} />
        break
      default:
        tile = <FileTile key={item.id} item={item} />
        break
    }
    if (item.isSensitive) {
      return (
        <RevealedSensitive key={item.id} item={item} onHide={conceal}>
          {tile}
        </RevealedSensitive>
      )
    }
    return tile
  }
  if (media.length === 1) {
    return (
      <View style={[styles.wrap, bleed ? styles.bleedWrap : null]} testID={testID}>
        {renderItem(media[0], 0)}
      </View>
    )
  }
  return (
    <View style={[styles.wrap, bleed ? styles.bleedWrap : null]} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}>
        {media.map((item, i) => renderItem(item, i))}
      </ScrollView>
    </View>
  )
}
