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
  // Synchronously-initialized fallback position (viewport-centered): content
  // renders on first paint everywhere, then snaps to the anchor once
  // measured. Effects inside freshly-mounted Modal subtrees are not
  // guaranteed to flush before assertions (or first paint), so the card
  // must never wait on them. `caret` is null until measured — no arrow is
  // better than an arrow pointing at the wrong place.
  const [pos, setPos] = useState<{
    left: number
    top?: number
    bottom?: number
    maxH: number
    caret: {dx: number; side: 'top' | 'bottom'} | null
  }>(() => {
    const win = Dimensions.get('window')
    return {
      left: Math.max(EDGE, (win.width - Math.min(minWidth, win.width - EDGE * 2)) / 2),
      top: win.height * 0.25,
      maxH: win.height / 2,
      caret: null,
    }
  })

  useEffect(() => {
    const node = anchor.current as unknown as {
      measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void
    } | null
    const win = Dimensions.get('window')
    if (!node?.measureInWindow) {
      // No measurement (jest, edge runtimes): center the card instead of
      // rendering nothing — never a silent empty popup.
      setPos({left: Math.max(EDGE, (win.width - minWidth) / 2), top: win.height * 0.25, maxH: win.height / 2, caret: null})
      return
    }
    node.measureInWindow((mx, my, w, h) => {
      const scroll = viewportScroll()
      const x = mx - scroll.x
      const y = my - scroll.y
      // Size adapts to the viewport first: the card never exceeds the
      // window minus margins, so it can never hang half off-screen.
      const availBelow = win.height - (y + h) - EDGE
      const availAbove = y - EDGE
      // Preferred side wins when it fits something useful, else take
      // whichever side has more room.
      const belowFits = availBelow >= MIN_SIDE
      const aboveFits = availAbove >= MIN_SIDE
      const useBelow = side === 'below' ? belowFits || !aboveFits : belowFits && !aboveFits
      const maxH = Math.max(MIN_SIDE, (useBelow ? availBelow : availAbove) - GAP)
      // Anchor to the trigger's left edge; shift left while overflowing,
      // so right-edge triggers (⋯) pull the card fully on-screen.
      const cardWidth = Math.min(CARD_MAX, win.width - EDGE * 2)
      const left = Math.min(Math.max(EDGE, x), Math.max(EDGE, win.width - EDGE - cardWidth))
      // Caret: a diamond on the card edge aimed at the trigger's centre,
      // clamped inside the card so the origin is always legible.
      const caretSide = useBelow ? 'top' : 'bottom'
      const caretDx = Math.min(Math.max(x + w / 2 - left, CARET_MIN), cardWidth - CARET_MIN)
      const caret = {dx: caretDx, side: caretSide} as const
      if (useBelow) {
        setPos({left, top: y + h + GAP, maxH, caret})
      } else {
        setPos({left, bottom: win.height - y + GAP, maxH, caret})
      }
    })
  }, [anchor, minWidth, side])

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID={testID ? `${testID}-backdrop` : undefined}
      />
      <Animated.View
        style={[
          styles.card,
          {
            left: pos.left,
            ...(pos.top !== undefined ? {top: pos.top} : {bottom: pos.bottom}),
            width: Math.min(CARD_MAX, Dimensions.get('window').width - EDGE * 2),
            minWidth: Math.min(minWidth, Dimensions.get('window').width - EDGE * 2),
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
  children,
}: {
  testID?: string
  label: string
  onPress: () => void
  disabled?: boolean
  reason?: string
  right?: ReactNode
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
