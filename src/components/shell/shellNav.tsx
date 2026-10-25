import {useContext} from 'react'
import {StyleSheet, View} from 'react-native'
import {QueryClientContext} from '@tanstack/react-query'

import {useTheme as useAlfTheme} from '#/alf'
import {Body} from '#/alf/typography'
import {
  BellIcon,
  HomeIcon,
  LoginIcon,
  NetworkIcon,
  ProfileIcon,
  SearchIcon,
} from '#/components/icons'
import {navigationRef} from '#/navigationRef'
import type {RootParamList} from '#/routes'
import {lastFeedTabName as lastFeedTab} from '#/state/feedMemory'
import {useUnreadNotificationsCount} from '#/state/queries'

export type TabParamList = Pick<
  RootParamList,
  'Home' | 'Network' | 'Explore' | 'Notifications' | 'User' | 'Login'
>

/** Stack screens reachable from shell chrome (sidebar collections,
 * footer quick actions, account menu). */
export type StackDestination =
  | 'Channels'
  | 'Clips'
  | 'Antennas'
  | 'Lists'
  | 'Favorites'
  | 'Conversations'
  | 'ChatRooms'
  | 'Announcements'
  | 'Drive'

/** Shared shell back: go back when history exists, else the last feed
 * (Home by default) — never a silent no-op on deep-linked stacks. */
export function goBackOrFeed(): void {
  if (!navigationRef.isReady()) return
  if (navigationRef.canGoBack()) {
    navigationRef.goBack()
    return
  }
  goMainTab(lastFeedTab())
}

/** Deepest focused route (name + params) anywhere in the tree. The shell
 * chrome (strip, sidebar, tab bar) renders under the container — outside
 * any screen, where `useNavigationState` cannot run — so the root state is
 * tracked through the container callbacks and handed down as a prop. */
export type LeafState = {name: string | undefined; params?: {id?: unknown; tag?: unknown; acct?: unknown; section?: unknown}}

export function leafOf(state: object | undefined): LeafState {
  let node = state as
    | {routes: {name: string; params?: {id?: unknown; tag?: unknown; acct?: unknown}; state?: object}[]; index?: number}
    | undefined
  for (;;) {
    const route = node?.routes[node.index ?? 0]
    if (!route) return {name: undefined}
    if (!route.state) return {name: route.name, params: route.params}
    node = route.state as typeof node
  }
}

/** Shell navigation always goes through the root ref with an explicit
 * `Main` hop: shell chrome lives outside every navigator, so a bare tab
 * name would resolve nowhere. Focusing `Main` first also pops any stack
 * screens (Settings, Note, …) — tabs always escape. */
export function goMainTab(key: keyof TabParamList) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', {screen: key} as never)
}

/** Active-tab check. The Profile tab renders any user's page, so it reads
 * active only for the viewer's own profile: v1 keeps it lit on your own
 * subroutes, never on someone else's profile. */
export function isTabFocused(leaf: LeafState, key: keyof TabParamList, ownAccountId: string | null): boolean {
  if (leaf.name !== key) return false
  if (key !== 'User') return true
  const id = leaf.params?.id
  const acct = leaf.params?.acct
  return (id == null || id === ownAccountId) && acct == null
}

export function TabIcon({name, color}: {name: keyof TabParamList; color: string}) {
  const size = 20
  switch (name) {
    case 'Home':
      return <HomeIcon size={size} color={color} />
    case 'Network':
      return <NetworkIcon size={size} color={color} />
    case 'Explore':
      return <SearchIcon size={size} color={color} />
    case 'Notifications':
      return <BellIcon size={size} color={color} />
    case 'User':
      return <ProfileIcon size={size} color={color} />
    case 'Login':
      return <LoginIcon size={size} color={color} />
  }
}

/** Open a stack screen from shell chrome (lives outside every navigator). */
export function goStackScreen(key: StackDestination) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate(key as never)
}

// --- Unread-notifications badge (N18) --------------------------------------
// Cache-derived count from `useUnreadNotificationsCount` (the
// notifications query cache — never a second streaming-backed counter;
// stream status UI stays with the streaming owner, S4). The guard keeps
// provider-less trees (tests, bare shells) rendering: no QueryClient, no
// badge, never a crash.
export function NotificationsUnreadBadge({
  sessionId,
  compact,
  testID = 'notifications-badge',
}: {
  sessionId: string | null
  /** Rail-width dot instead of the count pill. */
  compact?: boolean
  testID?: string
}) {
  const qc = useContext(QueryClientContext)
  if (!qc || !sessionId) return null
  return <NotificationsUnreadBadgeInner sessionId={sessionId} compact={compact} testID={testID} />
}

function NotificationsUnreadBadgeInner({
  sessionId,
  compact,
  testID,
}: {
  sessionId: string
  compact?: boolean
  testID: string
}) {
  const alf = useAlfTheme()
  const unread = useUnreadNotificationsCount(sessionId)
  if (unread == null || unread <= 0) return null
  if (compact) {
    return (
      <View
        testID={testID}
        accessibilityLabel={`${unread} unread notifications`}
        style={[styles.badgeDot, {backgroundColor: alf.palette.text}]}
      />
    )
  }
  return (
    <View testID={testID} accessibilityLabel={`${unread} unread notifications`} style={[styles.badge, {backgroundColor: alf.palette.text}]}>
      <Body style={[styles.badgeText, {color: alf.palette.bg}]} numberOfLines={1}>
        {unread > 99 ? '99+' : String(unread)}
      </Body>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
