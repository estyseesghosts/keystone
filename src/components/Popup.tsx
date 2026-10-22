import {msg} from '@lingui/macro'
import {useEffect, useRef, useState, type ReactNode, type RefObject} from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type View as ViewType,
} from 'react-native'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {i18n} from '#/locale/i18n'
import {useReducedMotionSetting} from '#/lib/motion'

// Anchored popup (Keystone v1 `.vispick-menu` style): a floating card
// measured off its trigger — below by default, flipped above when space
// runs out, clamped to the viewport. Dismisses on backdrop tap. Renders in
// a transparent Modal so it floats above every navigator and sibling.

const ENTER_MS = 150

/** Quick fade-and-scale entrance shared by every popup. It also masks the
 * first-paint jump: the card paints at its fallback position, then snaps to
 * the measured anchor — the fade keeps that snap from flashing. Under the
 * OS reduced-motion setting the card appears instantly (P9). */
export function usePopupEnter(): {opacity: Animated.Value; scale: Animated.AnimatedInterpolation<number>} {
  const motion = useRef(new Animated.Value(0)).current
  const reduceMotion = useReducedMotionSetting()
  useEffect(() => {
    if (reduceMotion) {
      motion.setValue(1)
      return
    }
    const anim = Animated.timing(motion, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [motion, reduceMotion])
  const scale = motion.interpolate({inputRange: [0, 1], outputRange: [0.96, 1]})
  return {opacity: motion, scale}
}

const CARD_MIN = 200
const CARD_MAX = 340
const EDGE = 8
const GAP = 6
const MIN_SIDE = 120
const CARET = 10
const CARET_MIN = 16

export type PopupSide = 'below' | 'above'

export type PopupLayout = {
  left: number
  top?: number
  bottom?: number
  maxH: number
  cardWidth: number
  effMinWidth: number
  caret: {dx: number; side: 'top' | 'bottom'} | null
}

/** Pure viewport-clamped layout for an anchored popup card. The card never
 * renders off-screen on either axis:
 * - width is content-driven between a floor and a cap: `effMinWidth`
 *   (never wider than the window margins) keeps tiny content tappable while
 *   `cardWidth` (capped at `CARD_MAX`, never wider than the window minus
 *   margins) lets roomy content use the free space; `left` is clamped into
 *   `[EDGE, winW - EDGE - cardWidth]` (right-edge triggers pull fully
 *   on-screen), so `left + maxWidth` stays in-viewport at any content size
 * - the preferred side wins when it fits something useful (`MIN_SIDE`),
 *   otherwise the other side is tried; `maxH` is the chosen side's full
 *   real space minus `GAP`, so `top + maxH` / `bottom + maxH` stay in-viewport
 * - when neither side fits (tiny viewport), the card falls back to a
 *   centered full-height sheet with no caret instead of hanging off-screen
 * - the caret aims at the trigger centre, clamped inside the card (or null
 *   when the card is too narrow to hold it / not edge-anchored)
 * Pure (unit-tested) so the math holds without rendering. */
export function computePopupLayout({
  x,
  y,
  w,
  h,
  winW,
  winH,
  side,
  minWidth,
}: {
  x: number
  y: number
  w: number
  h: number
  winW: number
  winH: number
  side: PopupSide
  minWidth: number
}): PopupLayout {
  const roomW = Math.max(0, winW - EDGE * 2)
  const cardWidth = Math.min(CARD_MAX, roomW)
  const effMinWidth = Math.min(minWidth, roomW)
  const left = Math.min(Math.max(EDGE, x), Math.max(EDGE, winW - EDGE - cardWidth))
  const availBelow = winH - (y + h) - EDGE
  const availAbove = y - EDGE
  // A side is usable only when it fits something useful AND the card edge
  // nearest the trigger lands in-viewport (a scrolled-off trigger must not
  // drag the card off-screen with it).
  const fits = (useBelow: boolean): boolean => {
    const avail = useBelow ? availBelow : availAbove
    if (avail - GAP < MIN_SIDE) return false
    const edge = useBelow ? y + h + GAP : y - GAP
    return edge >= EDGE && edge <= winH - EDGE
  }
  const anchored = (useBelow: boolean): PopupLayout => {
    const maxH = (useBelow ? availBelow : availAbove) - GAP
    const caretSide: 'top' | 'bottom' = useBelow ? 'top' : 'bottom'
    const caret =
      cardWidth < CARET * 2
        ? null
        : {
            dx: Math.min(Math.max(x + w / 2 - left, CARET_MIN), cardWidth - CARET_MIN),
            side: caretSide,
          }
    return useBelow
      ? {left, top: y + h + GAP, maxH, cardWidth, effMinWidth, caret}
      : {left, bottom: winH - y + GAP, maxH, cardWidth, effMinWidth, caret}
  }
  if (side === 'below') {
    if (fits(true)) return anchored(true)
    if (fits(false)) return anchored(false)
  } else {
    if (fits(false)) return anchored(false)
    if (fits(true)) return anchored(true)
  }
  return {left, top: EDGE, maxH: Math.max(0, winH - EDGE * 2), cardWidth, effMinWidth, caret: null}
}

/** Pre-measure / no-measurement fallback: viewport-centered card, sized
 * within the window so first paint is never off-screen. */
function fallbackPopupLayout(winW: number, winH: number, minWidth: number): PopupLayout {
  const roomW = Math.max(0, winW - EDGE * 2)
  const cardWidth = Math.min(CARD_MAX, roomW)
  const effMinWidth = Math.min(minWidth, roomW)
  return {
    left: Math.max(EDGE, (winW - cardWidth) / 2),
    top: winH * 0.25,
    maxH: winH / 2,
    cardWidth,
    effMinWidth,
    caret: null,
  }
}

// Web `measureInWindow` reports document-relative coordinates while the
// Modal portal positions viewport-relative; native reports window-relative
// already. These normalize both to viewport coordinates (0 on native).
function viewportScroll(): {x: number; y: number} {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return {x: 0, y: 0}
  return {
    x: typeof window.scrollX === 'number' ? window.scrollX : 0,
    y: typeof window.scrollY === 'number' ? window.scrollY : 0,
  }
}

export function AnchoredPopup({
  anchor,
  onClose,
  side = 'below',
  minWidth = CARD_MIN,
  testID,
  children,
}: {
  anchor: RefObject<ViewType | null>
  onClose: () => void
  side?: PopupSide
  minWidth?: number
  testID?: string
  children: ReactNode
}) {
  const theme = useTheme()
  const enter = usePopupEnter()
  // Web keyboard (P8): Escape dismisses the popup. Guarded to web with
  // cleanup on unmount; native keeps the backdrop tap + `onRequestClose`.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // Synchronously-initialized fallback position (viewport-centered): content
  // renders on first paint everywhere, then snaps to the anchor once
  // measured. Effects inside freshly-mounted Modal subtrees are not
  // guaranteed to flush before assertions (or first paint), so the card
  // must never wait on them. `caret` is null until measured — no arrow is
  // better than an arrow pointing at the wrong place.
  const [pos, setPos] = useState<PopupLayout>(() => {
    const win = Dimensions.get('window')
    return fallbackPopupLayout(win.width, win.height, minWidth)
  })

  useEffect(() => {
    const measure = () => {
      const win = Dimensions.get('window')
      const node = anchor.current as unknown as {
        measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void
      } | null
      if (!node?.measureInWindow) {
        // No measurement (jest, edge runtimes): center the card instead of
        // rendering nothing — never a silent empty popup.
        setPos(fallbackPopupLayout(win.width, win.height, minWidth))
        return
      }
      node.measureInWindow((mx, my, w, h) => {
        // Re-read the window inside the callback: rotation/resize between
        // the measure call and its result must not strand the card.
        const now = Dimensions.get('window')
        const scroll = viewportScroll()
        setPos(
          computePopupLayout({
            x: mx - scroll.x,
            y: my - scroll.y,
            w,
            h,
            winW: now.width,
            winH: now.height,
            side,
            minWidth,
          }),
        )
      })
    }
    measure()
    // Viewport changes (rotation, window resize incl. web): re-measure so
    // the card re-clamps instead of stranding off-screen. RN-web forwards
    // window resizes to Dimensions, so one subscription covers all platforms.
    const sub = Dimensions.addEventListener('change', measure)
    return () => sub.remove()
  }, [anchor, minWidth, side])

  // The backdrop label is UI chrome (Lingui macro); the singleton call
  // (not the hook) keeps provider-less trees — jest, previews — working.
  const dismissLabel = i18n._(msg`Dismiss`)
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        testID={testID ? `${testID}-backdrop` : undefined}
      />
      <Animated.View
        style={[
          styles.card,
          {
            left: pos.left,
            ...(pos.top !== undefined ? {top: pos.top} : {bottom: pos.bottom}),
            // Content-driven width: the absolutely-positioned card
            // shrink-wraps its content between `minWidth` (floor, so tiny
            // content stays tappable) and `maxWidth` (cap, so roomy content
            // uses the free space up to CARD_MAX). Never a fixed `width`:
            // pinning it would bloat small content to the cap and could
            // never let content use the space. `left + maxWidth` stays
            // in-viewport by construction (see computePopupLayout).
            minWidth: pos.effMinWidth,
            maxWidth: pos.cardWidth,
            maxHeight: pos.maxH,
            backgroundColor: theme.palette.bg,
            borderColor: theme.palette.edge,
            opacity: enter.opacity,
            transform: [{scale: enter.scale}],
          },
        ]}
        testID={testID}>
        {pos.caret ? (
          <View
            testID={testID ? `${testID}-caret` : undefined}
            pointerEvents="none"
            style={[
              styles.caret,
              pos.caret.side === 'top' ? styles.caretTop : styles.caretBottom,
              {
                left: pos.caret.dx - CARET / 2,
                backgroundColor: theme.palette.bg,
                borderColor: theme.palette.edge,
              },
            ]}
          />
        ) : null}
        <ScrollView>{children}</ScrollView>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 12,
    padding: 6,
  },
  caret: {
    position: 'absolute',
    width: CARET,
    height: CARET,
    borderWidth: 1,
    transform: [{rotate: '45deg'}],
    zIndex: 1,
  },
  // Top caret: diamond straddling the top edge, upper half showing the
  // top+left borders as an up-arrow. Bottom mirrors it.
  caretTop: {
    top: -CARET / 2 - 1,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  caretBottom: {
    bottom: -CARET / 2 - 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
})

export function PopupRow({
  testID,
  label,
  onPress,
  disabled,
  reason,
  right,
  left,
  children,
}: {
  testID?: string
  label: string
  onPress: () => void
  disabled?: boolean
  reason?: string
  right?: ReactNode
  /** Leading slot: stretches the row's full height and centers its
   * content (used for full-height option icons). */
  left?: ReactNode
  children?: ReactNode
}) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={{disabled}}
      accessibilityLabel={disabled && reason ? `${label}. ${reason}` : label}
      style={[popupRowStyles.row, disabled && popupRowStyles.disabled]}>
      {left ? <View style={popupRowStyles.left}>{left}</View> : null}
      <View style={popupRowStyles.text}>
        <Body>{label}</Body>
        {children}
      </View>
      {right}
    </Pressable>
  )
}

const popupRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    // 44dp minimum touch target (P10): short rows still tap reliably.
    minHeight: 44,
    borderRadius: 8,
  },
  disabled: {opacity: 0.5},
  text: {flex: 1, gap: 2, minWidth: 0},
  left: {justifyContent: 'center', alignSelf: 'stretch'},
})

export function PopupRadioDot({on}: {on: boolean}) {
  const theme = useTheme()
  return (
    <View
      style={{
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: theme.palette.text,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {on ? (
        <View
          style={{width: 10, height: 10, borderRadius: 5, backgroundColor: theme.palette.text}}
        />
      ) : null}
    </View>
  )
}

export function PopupDesc({children}: {children: ReactNode}) {
  return <Caption color="muted">{children}</Caption>
}

export function PopupSep() {
  const theme = useTheme()
  return <View style={{height: 1, backgroundColor: theme.palette.border, marginVertical: 4}} />
}

export function PopupHead({children}: {children: ReactNode}) {
  return (
    <View style={{paddingHorizontal: 10, paddingVertical: 6}}>
      <Caption color="faint">{children}</Caption>
    </View>
  )
}
