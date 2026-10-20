import {StyleSheet, TextInput, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {radius, space, typeSize} from '#/alf/tokens'
import {Caption} from '#/alf/typography'

export type TextFieldProps = {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  error?: string
  secure?: boolean
  testID?: string
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secure,
  testID,
}: TextFieldProps) {
  const theme = useTheme()
  const styles = StyleSheet.create({
    input: {
      borderWidth: 1,
      borderColor: error ? theme.palette.borderStrong : theme.palette.edge,
      borderRadius: radius.md,
      backgroundColor: theme.palette.bg,
      color: theme.palette.text,
      fontSize: typeSize.body,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
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
        secureTextEntry={secure}
        accessibilityLabel={label}
        style={styles.input}
      />
      {error ? <Caption>{error}</Caption> : null}
    </View>
  )
}
