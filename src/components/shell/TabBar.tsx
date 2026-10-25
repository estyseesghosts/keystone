import {Pressable, StyleSheet, View} from 'react-native'
import {t} from '@lingui/macro'

import {useTheme as useAlfTheme} from '#/alf'
import {useOptionalSafeAreaInsets} from '#/components/insets'
import {Body} from '#/alf/typography'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'

import {
  NotificationsUnreadBadge,
  TabIcon,
  goMainTab,
  isTabFocused,
  type LeafState,
  type TabParamList,
} from './shellNav'

// --- Bottom tab bar (mobile layout): icon over a 10px label, active tab
// inverted like `.navlink.active` on v1. v1's `.mobilenav` lives OUTSIDE
// the route content and stays mounted on every screen — so does this:
// it is rendered by the shell, not by the tab navigator, and every tab
// press goes through `goMainTab`, which pops pushed stack screens.
// v1 mobile wording: the Network tab reads "My Network" and Explore reads
// "Search" on phones (section names, not chrome names).
const MOBILE_LABELS: Record<keyof TabParamList, string> = {
  Home: t`Home`,
  Network: t`My Network`,
  Explore: t`Search`,
  Notifications: t`Notifications`,
  User: t`Profile`,
  Login: t`Sign in`,
}

const SIGNED_IN_TABS: (keyof TabParamList)[] = ['Home', 'Network', 'Explore', 'Notifications', 'User']
const SIGNED_OUT_TABS: (keyof TabParamList)[] = ['Home', 'Network', 'Explore', 'Login']

// Non-inset chrome height of the mobile tab bar, read by overlays that
// float above it (`ToastHost`, `ComposeFab` clearance): container top
// padding 6 + tab content (vertical padding 9*2 + 20px icon + 3 gap +
// 12px label) + container bottom padding 12 + 1px top border = 72. The
// home-indicator inset stacks on top at the call site. Keep in sync with
// `styles` below.
export const SHELL_TAB_BAR_HEIGHT = 72

export function ShellTabBar({leaf}: {leaf: LeafState}) {
  const session = useOptionalActiveSession()
  const alf = useAlfTheme()
  const insets = useOptionalSafeAreaInsets()
  const tabs = session ? SIGNED_IN_TABS : SIGNED_OUT_TABS
  const ownAccountId = session?.accountId ?? null
  return (
    <View
      style={[
        styles.tabbar,
        {
          backgroundColor: alf.palette.bg,
          borderTopColor: alf.palette.border,
          paddingBottom: 12 + insets.bottom,
          paddingLeft: Math.max(8, insets.left),
          paddingRight: Math.max(8, insets.right),
        },
      ]}>
      {tabs.map(key => {
        const label = MOBILE_LABELS[key]
        const isFocused = isTabFocused(leaf, key, ownAccountId)
        const fg = isFocused ? alf.palette.bg : alf.palette.text
        return (
          <Pressable
            key={key}
            onPress={() => goMainTab(key)}
            accessibilityRole="button"
            accessibilityState={{selected: isFocused}}
            accessibilityLabel={label}
            style={[styles.tab, isFocused && {backgroundColor: alf.palette.text}]}
            testID={`tab-${key}`}>
            <TabIcon name={key} color={fg} />
            <Body style={[styles.tabLabel, {color: fg}]} numberOfLines={1}>
              {label}
            </Body>
            {key === 'Notifications' ? (
              <NotificationsUnreadBadge sessionId={session?.id ?? null} />
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  tabbar: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    borderTopWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    paddingBottom: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 3,
    paddingVertical: 9,
    borderRadius: 8,
  },
  tabLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
})
