import {StyleSheet} from 'react-native'

import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

// Small toggle/choice pill used across the composer. A disabled chip always
// carries its reason (shown as the accessibility hint), never inert.
export function Chip({
  label,
  selected,
  disabled,
  disabledReason,
  onPress,
  testID,
}: {
  label: string
  selected?: boolean
  disabled?: boolean
  disabledReason?: string
  onPress: () => void
  testID?: string
}) {
  const theme = useTheme()
  const styles = StyleSheet.create({
    chip: {
      borderWidth: 1,
      borderColor: selected ? theme.palette.borderStrong : theme.palette.edge,
      backgroundColor: selected ? theme.palette.raise : 'transparent',
      borderRadius: radius.full,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      opacity: disabled ? 0.5 : 1,
    },
  })
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled ? disabledReason : undefined}
      accessibilityState={{selected: !!selected, disabled: !!disabled}}
      style={styles.chip}>
      <Caption color={selected ? 'text' : 'muted'}>{label}</Caption>
    </Pressable>
  )
}
