import {StyleSheet} from 'react-native'

import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Body} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

export type ButtonProps = {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  /** Shown to AT and as a caption when disabled. Never inert without reason. */
  disabledReason?: string
  testID?: string
}

// Two variants, no accent: primary is inverted chrome, secondary is a
// bordered quiet button.
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  disabledReason,
  testID,
}: ButtonProps) {
  const theme = useTheme()
  const styles = StyleSheet.create({
    base: {
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      // 44dp minimum touch target (P10): short labels still tap reliably.
      minHeight: 44,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: disabled ? 0.5 : 1,
    },
    primary: {backgroundColor: theme.palette.borderStrong},
    secondary: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.palette.edge,
    },
  })
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      accessibilityLabel={
        disabled && disabledReason ? `${label}. ${disabledReason}` : label
      }
      style={[
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
      ]}>
      <Body
        color={variant === 'primary' ? undefined : 'text'}
        style={variant === 'primary' ? {color: theme.palette.bg} : undefined}>
        {label}
      </Body>
    </Pressable>
  )
}
