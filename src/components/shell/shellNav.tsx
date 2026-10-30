import {useContext} from 'react'
import {StyleSheet, View} from 'react-native'
import {plural} from '@lingui/macro'
import type {I18n} from '@lingui/core'
import {useI18n} from '#/locale/i18n'
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
import {useUnreadBadge} from '#/state/queries'

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

// --- Unread-notifications badge (N18, P6.5) -----------------------------------
// Server-authoritative count from `useUnreadBadge` (the count query —
// never a second streaming-backed counter; stream status UI stays with
// the streaming owner, S4). `count` renders the numeric pill (`99+`
// cap; `compact` renders the same number in a smaller pill for the icon
// rail); the `dot` fallback (unsupported endpoint + a real presence
// signal) renders the 8px dot. Null renders nothing.
//
// The badge is accessibility-inert (`accessible={false}`) so the
// parent `Pressable`'s label — which carries the count (see
// `unreadCountLabel`) — wins on iOS. The guard keeps provider-less
// trees (tests, bare shells) rendering: no QueryClient, no badge, never
// a crash.
/** Short count phrase for bell accessibility labels ("3 unread");
 * parents compose it ("Notifications, 3 unread"). Pure. */
export function unreadCountLabel(i18n: I18n, count: number): string {
  return i18n._(plural(count, {one: '# unread', other: '# unread'}))
}

export function NotificationsUnreadBadge({
  sessionId,
  compact,
  testID = 'notifications-badge',
}: {
  sessionId: string | null
  /** Rail-width small pill instead of the full count pill. */
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
  const i18n = useI18n()
  const badge = useUnreadBadge(sessionId)
  if (badge == null) return null
  if (badge.kind === 'dot') {
    return (
      <View
        testID={testID}
        accessible={false}
        importantForAccessibility="no"
        style={[styles.badgeDot, {backgroundColor: alf.palette.text}]}
      />
    )
  }
  const unreadLabel = i18n._(
    plural(badge.count, {one: `${badge.count} unread notification`, other: `${badge.count} unread notifications`}),
  )
  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no"
      accessibilityLabel={unreadLabel}
      style={[styles.badge, compact && styles.badgeCompact, {backgroundColor: alf.palette.text}]}>
      <Body
        style={[styles.badgeText, compact && styles.badgeTextCompact, {color: alf.palette.bg}]}
        numberOfLines={1}>
        {badge.count > 99 ? '99+' : String(badge.count)}
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
  badgeCompact: {
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 0,
    minWidth: 16,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  badgeTextCompact: {
    fontSize: 10,
    lineHeight: 12,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
