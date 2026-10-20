import {StyleSheet, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'

// Shared Settings rows (v1 row pattern: title + hint, instant motion,
// no transitions). `SettingRow` pairs a label with its control;
// `PlaceholderRow` renders a v1 row that has no backing yet as a
// greyed-out disabled row with an honest reason — never pressable,
// never a dead-end subpage.

const styles = StyleSheet.create({
  row: {
    paddingVertical: 8,
    gap: 4,
  },
  divider: {
    borderBottomWidth: 1,
  },
  placeholder: {
    opacity: 0.5,
  },
})

export function SettingRow({
  title,
  hint,
  testID,
  children,
}: {
  title: string
  hint?: string
  testID?: string
  children?: React.ReactNode
}) {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      style={[styles.row, styles.divider, {borderBottomColor: theme.palette.border}]}>
      <Body>{title}</Body>
      {hint ? <Caption color="faint">{hint}</Caption> : null}
      {children}
    </View>
  )
}

export function PlaceholderRow({
  title,
  hint,
  reason,
  testID,
}: {
  title: string
  hint?: string
  reason: string
  testID?: string
}) {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      accessibilityRole="none"
      accessibilityState={{disabled: true}}
      accessibilityLabel={`${title}. Unavailable: ${reason}`}
      style={[
        styles.row,
        styles.divider,
        styles.placeholder,
        {borderBottomColor: theme.palette.border},
      ]}>
      <Body>{title}</Body>
      {hint ? <Caption color="faint">{hint}</Caption> : null}
      <Caption color="faint">{reason}</Caption>
    </View>
  )
}

export function SectionHint({children}: {children: React.ReactNode}) {
  return (
    <View style={[atoms.px_md, atoms.py_sm]}>
      <Caption color="faint">{children}</Caption>
    </View>
  )
}
