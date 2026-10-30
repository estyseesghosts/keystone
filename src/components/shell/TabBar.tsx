import {useContext} from 'react'
import {StyleSheet, View} from 'react-native'
import {t} from '@lingui/macro'
import {QueryClientContext} from '@tanstack/react-query'

import {useTheme as useAlfTheme} from '#/alf'
import {useOptionalSafeAreaInsets} from '#/components/insets'
import {Pressable} from '#/components/Pressable'
import {Body} from '#/alf/typography'
import {useI18n} from '#/locale/i18n'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'
import {useUnreadNotificationsCount} from '#/state/queries'

import {
  NotificationsUnreadBadge,
  TabIcon,
  goMainTab,
  isTabFocused,
  unreadCountLabel,
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
  const sessionId = session?.id ?? null
  return (
    <View
      style={[
        styles.tabbar,
        {
          backgroundColor: alf.palette.bg,
          borderTopColor: alf.palette.border,
          paddingBottom: 12 + insets.bottom,
          paddingStart: Math.max(8, insets.left),
          paddingEnd: Math.max(8, insets.right),
        },
      ]}>
      {tabs.map(key => {
        const label = MOBILE_LABELS[key]
        const isFocused = isTabFocused(leaf, key, ownAccountId)
        const fg = isFocused ? alf.palette.bg : alf.palette.text
        if (key === 'Notifications') {
          return (
            <BellTab
              key={key}
              label={label}
              isFocused={isFocused}
              fg={fg}
              sessionId={sessionId}
            />
          )
        }
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
          </Pressable>
        )
      })}
    </View>
  )
}

// Bell tab behind the QueryClient guard (same rule as
// `NotificationsUnreadBadge`): provider-less trees (tests, bare shells)
// render the plain tab, never crash on `useQueryClient`.
function BellTab({
  label,
  isFocused,
  fg,
  sessionId,
}: {
  label: string
  isFocused: boolean
  fg: string
  sessionId: string | null
}) {
  const qc = useContext(QueryClientContext)
  const alf = useAlfTheme()
  if (!qc) {
    return (
      <Pressable
        onPress={() => goMainTab('Notifications')}
        accessibilityRole="button"
        accessibilityState={{selected: isFocused}}
        accessibilityLabel={label}
        style={[styles.tab, isFocused && {backgroundColor: alf.palette.text}]}
        testID="tab-Notifications">
        <TabIcon name="Notifications" color={fg} />
        <Body style={[styles.tabLabel, {color: fg}]} numberOfLines={1}>
          {label}
        </Body>
      </Pressable>
    )
  }
  return <BellTabInner label={label} isFocused={isFocused} fg={fg} sessionId={sessionId} />
}

function BellTabInner({
  label,
  isFocused,
  fg,
  sessionId,
}: {
  label: string
  isFocused: boolean
  fg: string
  sessionId: string | null
}) {
  const alf = useAlfTheme()
  const i18n = useI18n()
  // Server count for the a11y label (the badge itself is
  // accessibility-inert — this label is what screen readers hear).
  const unread = useUnreadNotificationsCount(sessionId)
  const tabLabel =
    unread != null && unread > 0 ? `${label}, ${unreadCountLabel(i18n, unread)}` : label
  return (
    <Pressable
      onPress={() => goMainTab('Notifications')}
      accessibilityRole="button"
      accessibilityState={{selected: isFocused}}
      accessibilityLabel={tabLabel}
      style={[styles.tab, isFocused && {backgroundColor: alf.palette.text}]}
      testID="tab-Notifications">
      <View style={styles.iconWrap} testID="notifications-icon-wrap">
        <TabIcon name="Notifications" color={fg} />
        <View style={styles.badgeOverlay} pointerEvents="none" testID="notifications-badge-overlay">
          <NotificationsUnreadBadge sessionId={sessionId} />
        </View>
      </View>
      <Body style={[styles.tabLabel, {color: fg}]} numberOfLines={1}>
        {label}
      </Body>
    </Pressable>
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
  // Bell glyph anchor: the badge overlays this box (absolute, out of
  // flow) so a visible badge never grows the tab — the bar stays exactly
  // SHELL_TAB_BAR_HEIGHT.
  iconWrap: {
    position: 'relative',
  },
  badgeOverlay: {
    position: 'absolute',
    top: -6,
    right: -10,
  },
  tabLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
})
