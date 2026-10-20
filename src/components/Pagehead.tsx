import {Platform, StyleSheet, View, type ViewStyle} from 'react-native'

import {useTheme as useAlfTheme} from '#/alf'
import {useShellLayout} from '#/alf/breakpoints'
import {Body} from '#/alf/typography'

// Pagehead (Keystone v1 `.pagehead`): sticky section header — 17px title,
// hairline bottom border. Hidden on the mobile layout, where the top strip
// carries the title instead. Optional `right` node (refresh, badges).
export function Pagehead({title, right}: {title: string; right?: React.ReactNode}) {
  const layout = useShellLayout()
  const alf = useAlfTheme()
  if (layout === 'mobile') return null
  return (
    <View
      style={[
        styles.head,
        {
          backgroundColor: alf.palette.bg,
          borderBottomColor: alf.palette.border,
        },
      ]}>
      <Body style={styles.title}>{title}</Body>
      {right}
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    ...Platform.select({
      web: {position: 'sticky'} as unknown as ViewStyle,
      default: {},
    }),
    top: 0,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
})
