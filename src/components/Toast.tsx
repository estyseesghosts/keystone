import {StyleSheet, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Body} from '#/alf/typography'

export type ToastProps = {
  message: string
  testID?: string
}

// Presentational toast. Queue/host wiring lands with the shell (1.5).
export function Toast({message, testID}: ToastProps) {
  const theme = useTheme()
  const styles = StyleSheet.create({
    box: {
      backgroundColor: theme.palette.raise,
      borderWidth: 1,
      borderColor: theme.palette.edge,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
  })
  return (
    <View testID={testID} style={[atoms.centered, styles.box]}>
      <Body>{message}</Body>
    </View>
  )
}
