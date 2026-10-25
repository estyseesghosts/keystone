import {StyleSheet, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Body} from '#/alf/typography'

export type ToastProps = {
  message: string
  /** Errors announce assertively with an alert role; info toasts are
   * polite with no role (repair X10.1, audit a11y 6). */
  kind?: 'info' | 'error'
  testID?: string
}

// Presentational toast. Queue/host wiring lands with the shell (1.5).
export function Toast({message, kind = 'info', testID}: ToastProps) {
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
    <View
      testID={testID}
      style={[atoms.centered, styles.box]}
      accessibilityLiveRegion={kind === 'error' ? 'assertive' : 'polite'}
      accessibilityRole={kind === 'error' ? 'alert' : undefined}>
      <Body>{message}</Body>
    </View>
  )
}
