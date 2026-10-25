import {Image} from 'expo-image'
import {useVideoPlayer, VideoView} from 'expo-video'
import {useEffect, useRef, useState} from 'react'
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native'
import type {ComponentProps} from 'react'
import {msg, plural} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {safeHttpUrl, type Media} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {overlayChrome} from '#/alf/themes'
import {space} from '#/alf/tokens'
import {Caption} from '#/components/Typography'
import {Button} from '#/components/Button'
import {Pressable} from '#/components/Pressable'
import {useOptionalSafeAreaInsets} from '#/components/insets'
import {mediaAlt} from '#/lib/mediaAlt'
import {useReducedMotionSetting} from '#/lib/motion'

// SDK 57 web types: `VideoView` wants the web player class while
// `useVideoPlayer` returns the native type. The runtime instance is
// correct per platform, so this cast is type-only.
type ViewPlayer = ComponentProps<typeof VideoView>['player']

export type LightboxProps = {
  media: Media[]
  index: number
  onIndexChange?: (index: number) => void
  onClose: () => void
  /** Attachment ids the opener already revealed (its sensitive gate passed
   * there). Any other sensitive frame starts covered with its own Show
   * control. Defaults to the tapped frame (see `seedRevealed`). */
  revealedIds?: ReadonlyArray<string> | ReadonlySet<string>
  testID?: string
}

/** Manual zoom ceiling (double-tap / ctrl+wheel). */
export const LIGHTBOX_ZOOM_MAX = 3
/** Double-tap window for the zoom toggle (ms). */
const DOUBLE_TAP_MS = 350
/** Downward travel that dismisses the viewer (must also dominate horizontally). */
const DISMISS_DY = 120

/** Clamp a frame index into `[0, count - 1]` (empty list reads 0). Pure. */
export function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index)) return 0
  if (count <= 0) return 0
  return Math.min(Math.max(Math.floor(index), 0), count - 1)
}

/** Absolute x offset of frame `index` at page width `width`. Pure. */
export function frameOffset(index: number, width: number): number {
  return Math.max(0, Math.floor(index)) * width
}

/** Frame visible at horizontal offset `offsetX`. Pure. */
export function frameIndexForOffset(offsetX: number, width: number, count: number): number {
  if (!(width > 0)) return 0
  return clampIndex(Math.round(offsetX / width), count)
}

/** Mounted window: the active frame ±1 (windowSize 3). Pure. */
export function windowFor(safe: number, count: number): {lo: number; hi: number} {
  return {lo: Math.max(0, safe - 1), hi: Math.min(Math.max(count - 1, 0), safe + 1)}
}

/** FlatList-shaped layout for frame `index` at page width `width`
 * (`getItemLayout` form, kept for a future FlatList migration). Pure. */
export function frameLayout(width: number, index: number): {length: number; offset: number; index: number} {
  return {length: width, offset: frameOffset(index, width), index}
}

/** Clamp a manual zoom into `[1, LIGHTBOX_ZOOM_MAX]`. Pure. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(LIGHTBOX_ZOOM_MAX, Math.max(1, zoom))
}

/** Pan bounds for a zoomed frame (content stays centered). Pure. */
export function panBounds(zoom: number, width: number, height: number): {x: number; y: number} {
  const z = Math.max(1, zoom)
  return {x: (width * (z - 1)) / 2, y: (height * (z - 1)) / 2}
}

/** Clamp one pan axis into `±bound`. Pure. */
export function clampPan(value: number, bound: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(bound, Math.max(-bound, value))
}

/** Spread between two touch points. Pure. */
export function touchDistance(a: {x: number; y: number}, b: {x: number; y: number}): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Pinch zoom from finger spread, relative to the spread at gesture start.
 * Pure. */
export function pinchScale(startDist: number, curDist: number, startZoom: number): number {
  if (!(startDist > 0) || !Number.isFinite(curDist) || !Number.isFinite(startZoom)) return clampZoom(startZoom)
  return clampZoom(startZoom * (curDist / startDist))
}

type TouchPoint = {x: number; y: number}

/** Touch points of a responder event (defensive: single-touch events and
 * the test renderer carry no `touches` array). Pure. */
export function touchPoints(nativeEvent: unknown): TouchPoint[] {
  const touches = (nativeEvent as {touches?: Array<{pageX?: unknown; pageY?: unknown}>} | null | undefined)?.touches
  if (!Array.isArray(touches)) return []
  const points: TouchPoint[] = []
  for (const t of touches) {
    if (typeof t?.pageX === 'number' && typeof t?.pageY === 'number') points.push({x: t.pageX, y: t.pageY})
  }
  return points
}

type PanGesture = {
  sx: number
  sy: number
  px: number
  py: number
  pinchDist?: number
  pinchZoom?: number
}

/** True for a downward-dominant swipe (swipe-to-dismiss). Zoomed frames pan
 * instead — dismissal only fires at 1x. Pure. */
export function isDismissSwipe(dx: number, dy: number): boolean {
  return dy >= DISMISS_DY && Math.abs(dy) >= 2 * Math.abs(dx)
}

/** True when a web key target is a text entry (never hijack typing). Pure. */
export function isTextEntryTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const node = target as {tagName?: unknown; isContentEditable?: unknown}
  if (node.isContentEditable === true) return true
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA'
}

/** Seed the per-open revealed set: the opener's ids plus the tapped frame.
 * Both openers only fire `onOpen` for revealed tiles, so the tapped frame
 * was already gated there — every other sensitive frame stays covered until
 * its own Show control runs. Pure. */
export function seedRevealed(
  media: Media[],
  index: number,
  revealedIds?: ReadonlyArray<string> | ReadonlySet<string>,
): Set<string> {
  const seed = new Set<string>()
  if (revealedIds) {
    for (const id of revealedIds) seed.add(id)
  }
  const tapped: Media | undefined = media[clampIndex(index, media.length)]
  if (tapped) seed.add(tapped.id)
  return seed
}

/** Double-tap / double-click toggle. Pure timing, hook for the ref. */
function useDoubleTapToggle(onToggleZoom: () => void): (e: GestureResponderEvent) => void {
  const lastTap = useRef(0)
  return (e: GestureResponderEvent) => {
    const t = e.nativeEvent.timestamp ?? Date.now()
    if (t - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      onToggleZoom()
    } else {
      lastTap.current = t
    }
  }
}

function SensitiveCover({width, onShow, testID}: {width: number; onShow: () => void; testID?: string}) {
  const {i18n} = useLingui()
  return (
    <View
      style={{width, justifyContent: 'center', alignItems: 'center', gap: space.md, padding: space.xl}}
      testID={testID}>
      <Caption style={{color: CHROME_FG}}>{i18n._(msg`Sensitive media hidden — tap to show`)}</Caption>
      <Button
        label={i18n._(msg`Show`)}
        variant="primary"
        onPress={onShow}
        testID={testID ? `${testID}-show` : undefined}
      />
    </View>
  )
}

function LightboxImage({
  item,
  index,
  width,
  zoom,
  pan,
  onToggleZoom,
  testID,
}: {
  item: Media
  index: number
  width: number
  zoom: number
  pan: {x: number; y: number}
  onToggleZoom: () => void
  testID?: string
}) {
  const {i18n} = useLingui()
  const reduceMotion = useReducedMotionSetting()
  const onDoubleTap = useDoubleTapToggle(onToggleZoom)
  const alt = mediaAlt(item, index)
  // Upgrade path: paint the preview first, swap to the full source once it
  // has settled. Either leg can be absent — only a frame with neither
  // renders the caption-only fallback, and unsafe schemes never fetch.
  const full = safeHttpUrl(item.url)
  const preview = safeHttpUrl(item.previewUrl)
  const [settled, setSettled] = useState(false)
  if (full === null && preview === null) {
    return (
      <View style={{width, padding: space.xl, justifyContent: 'center'}}>
        <Caption style={{color: CHROME_FG}}>{alt}</Caption>
      </View>
    )
  }
  const uri = !settled && preview !== null ? preview : (full ?? preview)
  return (
    <View style={{width, overflow: 'hidden'}} testID={testID} onTouchEnd={onDoubleTap}>
      <Image
        source={{uri: uri ?? ''}}
        alt={alt}
        accessibilityLabel={alt}
        accessibilityRole="image"
        accessibilityHint={i18n._(msg`Double-tap to zoom`)}
        contentFit="contain"
        recyclingKey={item.id}
        transition={reduceMotion ? 0 : undefined}
        onLoad={() => setSettled(true)}
        testID={testID ? `${testID}-img` : undefined}
        style={{
          width,
          height: '100%',
          transform: [{scale: zoom}, {translateX: pan.x}, {translateY: pan.y}],
        }}
      />
    </View>
  )
}

function LightboxVideo({
  item,
  index,
  width,
  url,
  active,
  zoom,
  pan,
  onToggleZoom,
}: {
  item: Media
  index: number
  width: number
  url: string
  active: boolean
  zoom: number
  pan: {x: number; y: number}
  onToggleZoom: () => void
}) {
  const player = useVideoPlayer(url, player => {
    player.loop = item.kind === 'gifv'
  })
  const onDoubleTap = useDoubleTapToggle(onToggleZoom)
  // Pager-driven playback: only the focused frame plays. Every frame
  // mounting its own player and playing on init meant opening a 4-video
  // Lightbox started 4 audio tracks at once.
  useEffect(() => {
    if (active) player.play()
    else player.pause()
  }, [player, active])
  return (
    <View style={{width, overflow: 'hidden'}} onTouchEnd={onDoubleTap}>
      <VideoView
        player={player as unknown as ViewPlayer}
        nativeControls
        contentFit="contain"
        accessibilityLabel={mediaAlt(item, index)}
        style={{
          width,
          height: '100%',
          transform: [{scale: zoom}, {translateX: pan.x}, {translateY: pan.y}],
        }}
      />
    </View>
  )
}

function LightboxFrame({
  item,
  index,
  width,
  active,
  zoom,
  pan,
  covered,
  onReveal,
  onToggleZoom,
  testID,
}: {
  item: Media
  index: number
  width: number
  active: boolean
  zoom: number
  pan: {x: number; y: number}
  covered: boolean
  onReveal: () => void
  onToggleZoom: () => void
  testID?: string
}) {
  // Sensitive re-check inside the viewer: a frame the opener never revealed
  // stays behind its own cover (no fetch, no player) until Show runs.
  if (covered) {
    return <SensitiveCover width={width} onShow={onReveal} testID={testID ? `${testID}-cover` : undefined} />
  }
  const alt = mediaAlt(item, index)
  // Server strings are never trusted as player/image sources:
  // anything but http(s) renders the alt caption only, never a fetch.
  const safeUrl = safeHttpUrl(item.url)
  if ((item.kind === 'video' || item.kind === 'gifv') && safeUrl) {
    return (
      <LightboxVideo
        item={item}
        index={index}
        width={width}
        url={safeUrl}
        active={active}
        zoom={zoom}
        pan={pan}
        onToggleZoom={onToggleZoom}
      />
    )
  }
  if (item.kind === 'image') {
    return (
      <LightboxImage
        item={item}
        index={index}
        width={width}
        zoom={zoom}
        pan={pan}
        onToggleZoom={onToggleZoom}
        testID={testID}
      />
    )
  }
  return (
    <View style={{width, padding: space.xl, justifyContent: 'center'}}>
      <Caption style={{color: CHROME_FG}}>{alt}</Caption>
    </View>
  )
}

// Fixed light-on-dark chrome: the viewer backdrop is always black in both
// themes, so the counter, alt caption, and fallback caption use the shared
// `overlayChrome` pair (near-white on near-black) — theme text would be
// dark-on-dark in light mode. The caption bar keeps its own semi-opaque
// scrim so text never sits directly on media pixels.
const CHROME_FG = overlayChrome.fg

const styles = StyleSheet.create({
  backdrop: {...StyleSheet.absoluteFill, backgroundColor: overlayChrome.backdrop},
  pager: {flex: 1},
  chrome: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.md,
  },
  chromeActions: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  chromeButton: {minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm},
  caption: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    padding: space.md,
    backgroundColor: overlayChrome.captionScrim,
  },
})

/**
 * Fullscreen media viewer. Shape follows Bluesky's `components/Lightbox`
 * (fullscreen modal + horizontal pager + alt caption + close chrome) with
 * our own code (ADR-0001). Stills via expo-image, motion via expo-video;
 * every frame carries its alt text as both `alt` and the visible caption.
 *
 * Repair X7.1 behavior: opens at the tapped index (initial offset + scroll
 * re-sync), mounts only the active ±1 window, re-syncs on rotation, pages
 * on web (buttons + arrows/Home/End, focus trapped and returned), zooms
 * (double-tap everywhere, two-finger pinch on touch, ctrl+wheel on web),
 * pans when zoomed, dismisses on swipe-down, re-checks sensitivity per
 * frame, and upgrades preview → full on settle. Zoom, pan and dismiss apply
 * instantly (no animation), so reduced motion is honored by construction;
 * the modal fade still follows the OS setting.
 */
export function Lightbox({media, index, onIndexChange, onClose, revealedIds, testID}: LightboxProps) {
  const {width, height} = useWindowDimensions()
  const insets = useOptionalSafeAreaInsets()
  // Reduced motion: no fade transition into the viewer.
  const reduceMotion = useReducedMotionSetting()
  const {i18n} = useLingui()
  const pagerRef = useRef<ScrollView | null>(null)
  const dialogRef = useRef<View | null>(null)
  const gesture = useRef<PanGesture | null>(null)
  const lastSynced = useRef<{safe: number; width: number} | null>(null)
  // Focused frame: the `index` prop names it — only this frame's player
  // runs. Every caller owns `index` state and echoes `onIndexChange`, so
  // the prop is the single source of focus.
  const safe = clampIndex(index, media.length)
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => seedRevealed(media, index, revealedIds))
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({x: 0, y: 0})
  const current: Media | undefined = media[safe]

  // Open at the tapped index and re-sync on rotation/resize: `contentOffset`
  // covers the initial mount; `scrollTo` covers every later [safe, width]
  // change. Skipped on mount (the offset prop already shows the frame) and
  // best-effort afterwards — the native view may not exist yet.
  useEffect(() => {
    const prev = lastSynced.current
    lastSynced.current = {safe, width}
    if (prev && (prev.safe !== safe || prev.width !== width)) {
      try {
        pagerRef.current?.scrollTo?.({x: frameOffset(safe, width), y: 0, animated: false})
      } catch {
        // First paint / bare test renderer: the offset prop holds the frame.
      }
    }
  }, [safe, width])

  // Zoom is per frame: paging away resets it (and the pan with it).
  useEffect(() => {
    setZoom(1)
    setPan(prev => (prev.x === 0 && prev.y === 0 ? prev : {x: 0, y: 0}))
  }, [safe])

  const goTo = (target: number) => {
    const next = clampIndex(target, media.length)
    if (next !== safe) onIndexChange?.(next)
  }
  const toggleZoom = () => setZoom(z => clampZoom(z >= 2 ? 1 : 2))
  const reveal = (id: string) =>
    setRevealed(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })

  // Web paging (M2): Prev/Next buttons plus ArrowLeft/Right, Home/End and
  // Escape. Typing targets never lose their keys. Focus stays trapped while
  // open (Tab wraps) and returns to the opener on close.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const move = (target: number) => {
      const next = clampIndex(target, media.length)
      if (next !== safe) onIndexChange?.(next)
    }
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntryTarget(e.target)) return
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          move(safe - 1)
          break
        case 'ArrowRight':
          e.preventDefault()
          move(safe + 1)
          break
        case 'Home':
          e.preventDefault()
          move(0)
          break
        case 'End':
          e.preventDefault()
          move(media.length - 1)
          break
        case 'Escape':
          e.stopPropagation()
          onClose()
          break
        case 'Tab': {
          const root = dialogRef.current as unknown as {
            querySelectorAll?: (sel: string) => ArrayLike<{focus?: () => void}>
            contains?: (node: unknown) => boolean
          } | null
          if (!root || typeof root.querySelectorAll !== 'function') return
          const doc = document as unknown as {activeElement?: unknown}
          if (typeof root.contains === 'function' && !root.contains(doc.activeElement)) return
          const nodes = root.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')
          const focusables = Array.prototype.filter.call(nodes, (n: {focus?: unknown}) => typeof n.focus === 'function') as Array<{
            focus: () => void
          }>
          if (focusables.length === 0) return
          const first = focusables[0]
          const last = focusables[focusables.length - 1]
          if (e.shiftKey && doc.activeElement === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && doc.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
          break
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [safe, media.length, onClose, onIndexChange])

  // Focus returns to the opener on close (web only; native keeps its own
  // focus). Best-effort: the opener may be gone.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const prev = (document as Document).activeElement as unknown as {focus?: () => unknown} | null
    return () => {
      try {
        prev?.focus?.()
      } catch {
        // The opener unmounted first: nothing to return to.
      }
    }
  }, [])

  // Web wheel zoom (ctrl/pinch): adjusts the shared frame zoom, clamped.
  // Double-tap and two-finger pinch cover touch.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const root = dialogRef.current as unknown as {
      addEventListener?: (type: string, fn: (e: WheelEvent) => void, opts?: {passive: boolean}) => void
      removeEventListener?: (type: string, fn: (e: WheelEvent) => void) => void
    } | null
    if (!root || typeof root.addEventListener !== 'function') return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom(z => clampZoom(z + (e.deltaY < 0 ? 0.5 : -0.5)))
    }
    root.addEventListener('wheel', onWheel, {passive: false})
    return () => root.removeEventListener?.('wheel', onWheel)
  }, [])

  if (media.length === 0) return null
  const alt = current ? mediaAlt(current, safe) : ''
  const position = safe + 1
  const total = media.length
  const atStart = safe <= 0
  const atEnd = safe >= total - 1
  // The accessible announcement keeps both numbers ("Image 2 of 3").
  // one/other stay identical in English — the plural is for locales that
  // inflect the announcement.
  const counterLabel = i18n._(
    plural(total, {
      one: `Image ${position} of ${total}`,
      other: `Image ${position} of ${total}`,
    }),
  )
  const closeLabel = i18n._(msg`Close`)
  const prevLabel = i18n._(msg`Previous`)
  const nextLabel = i18n._(msg`Next`)
  const prevA11y = atStart ? i18n._(msg`Already at the first image`) : i18n._(msg`Show previous image`)
  const nextA11y = atEnd ? i18n._(msg`Already at the last image`) : i18n._(msg`Show next image`)
  const {lo, hi} = windowFor(safe, total)
  const windowed: Array<{item: Media; frame: number}> = []
  for (let frame = lo; frame <= hi; frame++) {
    const item: Media | undefined = media[frame]
    if (item) windowed.push({item, frame})
  }
  return (
    <Modal
      testID={testID}
      visible
      transparent={false}
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}>
      <View
        ref={dialogRef}
        testID={testID ? `${testID}-dialog` : undefined}
        style={[styles.backdrop, atoms.flex1]}
        accessibilityViewIsModal
        role="dialog"
        aria-modal>
        <ScrollView
          ref={pagerRef}
          testID={testID ? `${testID}-pager` : undefined}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.pager}
          contentOffset={{x: frameOffset(safe, width), y: 0}}
          onMomentumScrollEnd={e => {
            goTo(frameIndexForOffset(e.nativeEvent.contentOffset.x, width, total))
          }}
          onTouchStart={e => {
            const n = e.nativeEvent
            const points = touchPoints(n)
            gesture.current = {
              sx: n.pageX,
              sy: n.pageY,
              px: pan.x,
              py: pan.y,
              pinchDist: points.length >= 2 ? touchDistance(points[0], points[1]) : undefined,
              pinchZoom: zoom,
            }
          }}
          onTouchMove={e => {
            const g = gesture.current
            if (!g) return
            const n = e.nativeEvent
            const points = touchPoints(n)
            // Pinch-to-zoom wins over pan while two fingers are down.
            if (points.length >= 2 && g.pinchDist !== undefined) {
              setZoom(pinchScale(g.pinchDist, touchDistance(points[0], points[1]), g.pinchZoom ?? 1))
              return
            }
            if (zoom <= 1) return
            const bounds = panBounds(zoom, width, height)
            setPan({
              x: clampPan(g.px + (n.pageX - g.sx), bounds.x),
              y: clampPan(g.py + (n.pageY - g.sy), bounds.y),
            })
          }}
          onTouchEnd={e => {
            const g = gesture.current
            gesture.current = null
            if (zoom !== 1 || !g) return
            const n = e.nativeEvent
            if (isDismissSwipe(n.pageX - g.sx, n.pageY - g.sy)) onClose()
          }}>
          {lo > 0 ? <View style={{width: frameOffset(lo, width)}} /> : null}
          {windowed.map(({item, frame}) => (
            <LightboxFrame
              key={item.id}
              item={item}
              index={frame}
              width={width}
              active={frame === safe}
              zoom={frame === safe ? zoom : 1}
              pan={frame === safe ? pan : {x: 0, y: 0}}
              covered={item.isSensitive && !revealed.has(item.id)}
              onReveal={() => reveal(item.id)}
              onToggleZoom={toggleZoom}
              testID={testID ? `${testID}-frame-${item.id}` : undefined}
            />
          ))}
        </ScrollView>
        <View
          style={[
            styles.chrome,
            {
              paddingTop: insets.top + space.md,
              paddingStart: insets.left + space.md,
              paddingEnd: insets.right + space.md,
            },
          ]}
          testID="lightbox-chrome">
          <Caption
            style={{color: CHROME_FG}}
            accessibilityLiveRegion="polite"
            accessibilityLabel={counterLabel}
            testID={testID ? `${testID}-counter` : undefined}>
            {position} / {total}
          </Caption>
          <View style={styles.chromeActions}>
            {Platform.OS === 'web' ? (
              <>
                <Pressable
                  testID={testID ? `${testID}-prev` : undefined}
                  onPress={() => goTo(safe - 1)}
                  disabled={atStart}
                  accessibilityRole="button"
                  accessibilityLabel={prevA11y}
                  accessibilityState={{disabled: atStart}}
                  style={[styles.chromeButton, atStart && {opacity: 0.4}]}>
                  <Caption style={{color: CHROME_FG}}>{prevLabel}</Caption>
                </Pressable>
                <Pressable
                  testID={testID ? `${testID}-next` : undefined}
                  onPress={() => goTo(safe + 1)}
                  disabled={atEnd}
                  accessibilityRole="button"
                  accessibilityLabel={nextA11y}
                  accessibilityState={{disabled: atEnd}}
                  style={[styles.chromeButton, atEnd && {opacity: 0.4}]}>
                  <Caption style={{color: CHROME_FG}}>{nextLabel}</Caption>
                </Pressable>
              </>
            ) : null}
            <Button label={closeLabel} variant="primary" onPress={onClose} testID="lightbox-close" />
          </View>
        </View>
        <View
          style={[
            styles.caption,
            {
              paddingBottom: insets.bottom + space.md,
              paddingStart: insets.left + space.md,
              paddingEnd: insets.right + space.md,
            },
          ]}
          testID="lightbox-caption">
          <Caption style={{color: CHROME_FG}}>{alt}</Caption>
        </View>
      </View>
    </Modal>
  )
}
