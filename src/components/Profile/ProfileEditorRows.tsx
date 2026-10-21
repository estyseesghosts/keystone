// Shared profile-editor rows (C13): a labelled text row (editable or
// disabled-with-reason) and a labelled switch row. Every unsupported row
// renders disabled WITH its reason — never omitted, never inert.
import {StyleSheet, Switch, TextInput, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {radius, space, typeSize} from '#/alf/tokens'
import {Caption} from '#/alf/typography'

export function EditorTextRow({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  editable = true,
  disabledReason,
  testID,
}: {
  label: string
  value: string
  onChangeText?: (text: string) => void
  placeholder?: string
  multiline?: boolean
  editable?: boolean
  /** Required when `editable` is false: why this row cannot be edited. */
  disabledReason?: string
  testID?: string
}) {
  const theme = useTheme()
  const styles = StyleSheet.create({
    input: {
      borderWidth: 1,
      borderColor: theme.palette.edge,
      borderRadius: radius.md,
      backgroundColor: editable ? theme.palette.bg : theme.palette.raise,
      color: theme.palette.text,
      fontSize: typeSize.body,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      opacity: editable ? 1 : 0.6,
    },
  })
  return (
    <View style={atoms.gap_sm}>
      <Caption>{label}</Caption>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.palette.faint}
        multiline={multiline}
        editable={editable}
        accessibilityLabel={label}
        accessibilityState={{disabled: !editable}}
        style={[styles.input, multiline ? {minHeight: 80, textAlignVertical: 'top'} : null]}
      />
      {!editable && disabledReason ? (
        <Caption color="faint">{disabledReason}</Caption>
      ) : null}
    </View>
  )
}

export function EditorSwitchRow({
  label,
  hint,
  value,
  onValueChange,
  disabled,
  disabledReason,
  testID,
}: {
  label: string
  hint?: string
  value: boolean
  onValueChange?: (v: boolean) => void
  disabled?: boolean
  /** Required when `disabled` is true: why this row cannot be changed. */
  disabledReason?: string
  testID?: string
}) {
  return (
    <View style={[atoms.row, atoms.itemsCenter]}>
      <View style={[atoms.flex1, atoms.gap_sm]}>
        <Caption>{label}</Caption>
        {hint ? <Caption color="faint">{hint}</Caption> : null}
        {disabled && disabledReason ? (
          <Caption color="faint">{disabledReason}</Caption>
        ) : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityState={{disabled}}
      />
    </View>
  )
}
