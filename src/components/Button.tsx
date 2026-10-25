import {StyleSheet} from 'react-native'

import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

export type ButtonProps = {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary'
  /** Compact pill for dense toolbars (composer submit): lower height and
   * tighter padding. The 44dp touch target is a guideline, not a law —
   * toolbar pills sit beside hitSlop'd icon buttons. */
  compact?: boolean
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
  compact,
  disabled,
  disabledReason,
  testID,
}: ButtonProps) {
  const theme = useTheme()
  // Disabled label token (repair X10.2, audit a11y 9): `muted` meets 3:1
  // on every surface in both themes (pinned by the alf contrast test), so
  // the disabled label never needs an opacity dim to read as disabled.
  const labelColor: 'text' | 'muted' | undefined = disabled
    ? 'muted'
    : variant === 'primary'
      ? undefined
      : 'text'
  const styles = StyleSheet.create({
    base: {
      paddingHorizontal: compact ? space.md : space.lg,
      paddingVertical: space.sm,
      // 44dp minimum touch target (P10): short labels still tap reliably.
      // Compact pills trade down to 36dp for dense toolbars.
      minHeight: compact ? 36 : 44,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primary: {backgroundColor: theme.palette.borderStrong},
    secondary: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.palette.edge,
    },
    // Disabled chrome: never halve the whole button's opacity (that dims
    // the label too). Instead the fill hollows out to a dashed outline — a
    // shape/pattern cue, not a colour-only one — while the label above
    // carries the contrast. Focus/hover/pressed behaviour stays in the
    // shared Pressable (X10.1); this entry only re-skins the resting box.
    disabled: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.palette.edge,
      borderStyle: 'dashed',
    },
  })
  // Compact pills read smaller all over: Caption label, never wrapped.
  const Label = compact ? Caption : Body
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
        disabled && styles.disabled,
      ]}>
      <Label
        color={labelColor}
        style={
          variant === 'primary' && !disabled
            ? {color: theme.palette.bg}
            : undefined
        }
        numberOfLines={1}>
        {label}
      </Label>
    </Pressable>
  )
}
