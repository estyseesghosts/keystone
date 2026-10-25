import {Platform, Pressable, StyleSheet, View, type ViewStyle} from 'react-native'
import {t} from '@lingui/macro'

import {useTheme as useAlfTheme} from '#/alf'
import {useOptionalSafeAreaInsets} from '#/components/insets'
import {Body} from '#/alf/typography'
import {BackIcon} from '#/components/icons'
import {navigationRef} from '#/navigationRef'
import {titleForRoute} from '#/routes'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'

import {AccountButton} from './AccountMenu'
import {goBackOrFeed, type LeafState} from './shellNav'

// --- Mobile top strip (Keystone v1 `.mobile-account`): back | section
// title | account. Only in the mobile layout; wider shells use the
// sidebar + pageheads instead.
export function MobileStrip({leaf}: {leaf: LeafState}) {
  const session = useOptionalActiveSession()
  const alf = useAlfTheme()
  const insets = useOptionalSafeAreaInsets()
  return (
    <View
      style={[
        styles.strip,
        {
          backgroundColor: alf.palette.bg,
          borderBottomColor: alf.palette.border,
          paddingTop: insets.top,
          paddingLeft: Math.max(16, insets.left),
          paddingRight: Math.max(16, insets.right),
        },
      ]}>
      <View style={styles.stripSide}>
        <Pressable
          onPress={goBackOrFeed}
          accessibilityRole="button"
          accessibilityLabel={t`Back`}
          hitSlop={12}
          testID="strip-back">
          <BackIcon size={20} color={alf.palette.text} />
        </Pressable>
      </View>
      <Body style={styles.stripTitle} numberOfLines={1}>
        {titleForRoute(leaf.name, leaf.params)}
      </Body>
      <View style={[styles.stripSide, styles.stripRight]}>
        {session ? (
          <AccountButton testPrefix="strip-account" menuSide="below" />
        ) : (
          <Pressable
            onPress={() => navigationRef.navigate('Login')}
            accessibilityRole="button"
            hitSlop={8}
            testID="strip-signin">
            <Body>{t`Sign in`}</Body>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    ...Platform.select({
      web: {position: 'sticky', top: 0, zIndex: 10} as unknown as ViewStyle,
      default: {},
    }),
  },
  stripSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stripRight: {
    justifyContent: 'flex-end',
  },
  stripTitle: {
    fontWeight: '700',
    fontSize: 17,
    lineHeight: 22,
    textAlign: 'center',
  },
})
