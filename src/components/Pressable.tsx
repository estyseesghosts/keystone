import {useState} from 'react'
import {
  Platform,
  Pressable as RNPressable,
  type PressableProps as RNPressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

import {focusRingStyle} from '#/alf/focus'
import {useTheme} from '#/alf/index'

// Base pressable: generous hit area + pressed feedback. All interactive
// components build on this instead of raw RN Pressable.
//
// Hover + keyboard-focus states (repair X10.1, audit a11y 11): hovered
// dims slightly, and keyboard focus (web only) draws the shared alf focus
// ring — Button and every other consumer inherit both without touching
// their own styles. A caller's own onHoverIn/out/onFocus/Blur still run
// (chained, not replaced).
export type PressableProps = Omit<RNPressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  /** Right-click handler. Web-only: react-native-web forwards
   * `onContextMenu` to the DOM node (native builds never see it — the
   * prop is dropped below unless `Platform.OS === 'web'`). Callers pass
   * it unconditionally; gating lives here, once. */
  onContextMenu?: (e: {preventDefault(): void}) => void
}

export function Pressable({
  style,
  children,
  onHoverIn,
  onHoverOut,
  onFocus,
  onBlur,
  onContextMenu,
  ...rest
}: PressableProps) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <RNPressable
      hitSlop={8}
      onHoverIn={e => {
        setHovered(true)
        onHoverIn?.(e)
      }}
      onHoverOut={e => {
        setHovered(false)
        onHoverOut?.(e)
      }}
      onFocus={e => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={e => {
        setFocused(false)
        onBlur?.(e)
      }}
      // Web-only gate (see the prop doc): native trees never receive the
      // unknown prop. The cast is type-only — RNW forwards `onContextMenu`
      // to the DOM node on web.
      {...(Platform.OS === 'web' && onContextMenu ? {onContextMenu} : {})}
      style={state => [
        state.pressed && {opacity: 0.7},
        hovered && !state.pressed && {opacity: 0.85},
        focused && Platform.OS === 'web' && focusRingStyle(theme),
        typeof style === 'function'
          ? (style as (s: typeof state) => StyleProp<ViewStyle>)(state)
          : style,
      ]}
      {...rest}>
      {children}
    </RNPressable>
  )
}
