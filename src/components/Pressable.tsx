import {
  Pressable as RNPressable,
  type PressableProps as RNPressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

// Base pressable: generous hit area + pressed feedback. All interactive
// components build on this instead of raw RN Pressable.
export type PressableProps = Omit<RNPressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
}

export function Pressable({style, children, ...rest}: PressableProps) {
  return (
    <RNPressable
      hitSlop={8}
      style={state => [state.pressed && {opacity: 0.7}, style]}
      {...rest}>
      {children}
    </RNPressable>
  )
}
