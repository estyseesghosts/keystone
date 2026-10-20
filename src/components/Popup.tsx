import {useEffect, useState, type ReactNode, type RefObject} from 'react'
import {
  Dimensions,
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

// Anchored popup (Keystone v1 `.vispick-menu` style): a floating card
// measured off its trigger — below by default, flipped above when space
// runs out, clamped to the viewport. Dismisses on backdrop tap. Renders in
// a transparent Modal so it floats above every navigator and sibling.

const CARD_MIN = 200
const CARD_MAX = 340
const EDGE = 8
const GAP = 6
const MIN_SIDE = 120

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
  // Synchronously-initialized fallback position (viewport-centered): content
  // renders on first paint everywhere, then snaps to the anchor once
  // measured. Effects inside freshly-mounted Modal subtrees are not
  // guaranteed to flush before assertions (or first paint), so the card
  // must never wait on them.
  const [pos, setPos] = useState<{left: number; top?: number; bottom?: number; maxH: number}>(() => {
    const win = Dimensions.get('window')
    return {
      left: Math.max(EDGE, (win.width - Math.min(minWidth, win.width - EDGE * 2)) / 2),
      top: win.height * 0.25,
      maxH: win.height / 2,
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
      setPos({left: Math.max(EDGE, (win.width - minWidth) / 2), top: win.height * 0.25, maxH: win.height / 2})
      return
    }
    node.measureInWindow((mx, my, w, h) => {
      const scroll = viewportScroll()
      const x = mx - scroll.x
      const y = my - scroll.y
      // Size adapts to the viewport first: the card never exceeds the
      // window minus margins, so it can never hang half off-screen.
      const width = Math.min(Math.max(minWidth, Math.min(w, CARD_MAX)), CARD_MAX, win.width - EDGE * 2)
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
      const left = Math.min(Math.max(EDGE, x), Math.max(EDGE, win.width - EDGE - width))
      if (useBelow) {
        setPos({left, top: y + h + GAP, maxH})
      } else {
        setPos({left, bottom: win.height - y + GAP, maxH})
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
      <View
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
          },
        ]}
        testID={testID}>
        <ScrollView>{children}</ScrollView>
      </View>
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
