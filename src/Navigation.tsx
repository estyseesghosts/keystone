import {useContext, useMemo, useRef, useState, type ReactNode} from 'react'
import {Image, Platform, Pressable, StyleSheet, View, type View as ViewType, type ViewStyle} from 'react-native'
import {useOptionalSafeAreaInsets} from '#/components/insets'
import {t} from '@lingui/macro'
import {
  DarkTheme,
  DefaultTheme,
  getStateFromPath as defaultGetStateFromPath,
  NavigationContainer,
  type InitialState,
  type LinkingOptions,
} from '@react-navigation/native'
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs'
import {createNativeStackNavigator} from '@react-navigation/native-stack'
import {QueryClientContext} from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import {useLingui} from '@lingui/react'
import type {I18n} from '@lingui/core'
import {msg} from '@lingui/macro'

import {useTheme as useAlfTheme} from '#/alf'
import {useLayoutBreakpoints, useShellLayout, type ShellLayout} from '#/alf/breakpoints'
import {butterflyPx} from '#/alf/tokens'
import {Body, Caption, Heading} from '#/alf/typography'
import {AnchoredPopup, PopupDesc, PopupHead, PopupRadioDot, PopupRow, PopupSep} from '#/components/Popup'
import {
  AnnouncementIcon,
  BackIcon,
  BellIcon,
  DriveIcon,
  ClipIcon,
  AntennaIcon,
  ChannelIcon,
  HomeIcon,
  ListIcon,
  LoginIcon,
  MessageIcon,
  NetworkIcon,
  PageIcon,
  PencilIcon,
  ProfileIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
} from '#/components/icons'
import {ScopeUpgradeBanner} from '#/components/ScopeUpgradeBanner'
import {navigationRef} from '#/navigationRef'
import type {RootParamList} from '#/routes'
import {isAuthCallbackPath, linkingScreens, rewriteLegacyPath, titleForRoute} from '#/routes'
import {useOptionalActiveSession, useSessionStore, useSessions} from '#/state/session/SessionProvider'
import {backendForSession, type Backend} from '@keystone/fedi'
import {useHosting} from '#/state/hosting'
import {AuthCallbackScreen} from '#/screens/AuthCallback'
import {AntennaScreen} from '#/screens/Antenna'
import {AntennasScreen} from '#/screens/Antennas'
import {ChannelScreen} from '#/screens/Channel'
import {ChannelsScreen} from '#/screens/Channels'
import {ConversationScreen} from '#/screens/Conversation'
import {ConversationsScreen} from '#/screens/Conversations'
import {ChatRoomScreen} from '#/screens/ChatRoom'
import {ChatRoomsScreen} from '#/screens/ChatRooms'
import {ChatUserScreen} from '#/screens/ChatUser'
import {AnnouncementsScreen} from '#/screens/Announcements'
import {AdminInsightScreen} from '#/screens/AdminInsight'
import {AdminReportScreen, AdminReportsScreen} from '#/screens/AdminReports'
import {ClipScreen} from '#/screens/Clip'
import {ClipsScreen} from '#/screens/Clips'
import {ComposeScreen} from '#/screens/Compose'
import {PostHandlersProvider} from '#/screens/PostHandlers'
import {DriveScreen} from '#/screens/Drive'
import {ExploreScreen} from '#/screens/Explore'
import {FavoritesScreen} from '#/screens/Favorites'
import {FollowersScreen} from '#/screens/Followers'
import {FollowingScreen} from '#/screens/Following'
import {FollowRequestsScreen} from '#/screens/FollowRequests'
import {HomeScreen} from '#/screens/Home'
import {ListScreen} from '#/screens/List'
import {ListsScreen} from '#/screens/Lists'
import {LoginScreen} from '#/screens/Login'
import {NetworkScreen} from '#/screens/Network'
import {NoteScreen} from '#/screens/Note'
import {NoteHistoryScreen} from '#/screens/NoteHistory'
import {NotificationsScreen} from '#/screens/Notifications'
import {ProfileEditorScreen} from '#/screens/ProfileEditor'
import {SettingsScreen} from '#/screens/Settings'
import {SysDebugScreen} from '#/screens/SysDebug'
import {TagScreen} from '#/screens/Tag'
import {UserScreen} from '#/screens/User'
import {useUnreadNotificationsCount} from '#/state/queries'

type TabParamList = Pick<
  RootParamList,
  'Home' | 'Network' | 'Explore' | 'Notifications' | 'User' | 'Login'
>

type StackParamList = RootParamList & {Main: undefined}

// Deep-link table. Derived from the canonical `paths` in `#/routes`
// (which documents Keystone's web URLs) — this is the shape
// react-navigation consumes. The Login tab is intentionally absent here:
// `/login` maps to the stack screen, tab presses navigate by name.
// Legacy URLs (`/local`, `/social`, `/global`, `/search`) rewrite to
// their canonical targets before the default parser runs.
export const linking: LinkingOptions<StackParamList> = {
  prefixes: [Linking.createURL('/')],
  config: {
    screens: linkingScreens(),
  },
  getStateFromPath: (path, options) =>
    defaultGetStateFromPath(rewriteLegacyPath(path), options),
}

// --- Base-path hosting (N13) -------------------------------------------------
// `HostingResolution.basePath` is the router namespace (`/.../` form, `/`
// for root deploys). Dev stays root `/`; when the runtime config pins a
// sub-path the deep-link parser must strip it before the default parser
// runs, or no non-root URL resolves. Honest fallback: unknown base → `/`.

/** Normalize a base to the no-trailing-slash form (`/` stays `/`). */
export function normalizeShellBase(base: string | null | undefined): string {
  if (base == null) return '/'
  const v = base.trim()
  if (v === '' || v === '/') return '/'
  const leading = v.startsWith('/') ? v : `/${v}`
  const stripped = leading.replace(/\/+$/, '')
  return stripped === '' ? '/' : stripped
}

/** Strip the deploy base off a path (`/keystone/notes/x` → `/notes/x`).
 * Callback paths are exempt: both are accepted at the origin root as well
 * (v1 registered `/keystone/callback` there), and under base `/keystone`
 * stripping would turn that URL into `/callback`, which matches no route.
 * The canonical callback is also accepted base-prefixed — that form is
 * longer, so it never equals a bare callback path and strips normally. */
export function stripShellBase(path: string, base: string | null | undefined): string {
  if (isAuthCallbackPath(path)) return path
  const b = normalizeShellBase(base)
  if (b === '/') return path
  if (path === b) return '/'
  if (path.startsWith(`${b}/`)) return path.slice(b.length)
  return path
}

/** Base-aware `getStateFromPath`: strip base, rewrite legacy URLs, parse. */
export function getStateFromPathWithBase(
  path: string,
  base: string | null | undefined,
  options?: Parameters<typeof defaultGetStateFromPath>[1],
) {
  return defaultGetStateFromPath(rewriteLegacyPath(stripShellBase(path, base)), options)
}

/** Prefix list for a base (`/` → root only, else root + the base). */
export function linkingPrefixesForBase(base: string | null | undefined): string[] {
  const b = normalizeShellBase(base)
  const root = Linking.createURL('/')
  if (b === '/') return [root]
  return [root, b]
}

// --- Last feed + scroll memory (N14) ------------------------------------------
// The shell back control's fallback when there is no back history
// (deep-linked stack screens): the last visited feed tab, else Home.
// The memory itself lives in `#/state/feedMemory` (pure module state —
// the chrome lives outside every navigator, and feed views import it
// without dragging the whole shell in). Re-exported here so existing
// importers keep working.
export {
  clearFeedScrolls,
  feedScrollKey,
  lastFeedTabName,
  readFeedScroll,
  recordFeedVisit,
  resetLastFeed,
  saveFeedScroll,
  type FeedTabKey,
} from '#/state/feedMemory'
import {lastFeedTabName as lastFeedTab, recordFeedVisit} from '#/state/feedMemory'

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
type LeafState = {name: string | undefined; params?: {id?: unknown; tag?: unknown; acct?: unknown; section?: unknown}}

function leafOf(state: object | undefined): LeafState {
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
function goMainTab(key: keyof TabParamList) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', {screen: key} as never)
}

/** Active-tab check. The Profile tab renders any user's page, so it reads
 * active only for the viewer's own profile: v1 keeps it lit on your own
 * subroutes, never on someone else's profile. */
function isTabFocused(leaf: LeafState, key: keyof TabParamList, ownAccountId: string | null): boolean {
  if (leaf.name !== key) return false
  if (key !== 'User') return true
  const id = leaf.params?.id
  const acct = leaf.params?.acct
  return (id == null || id === ownAccountId) && acct == null
}

function TabIcon({name, color}: {name: keyof TabParamList; color: string}) {
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

// --- Sidebar collections + footer actions (sidebar reshuffle) --------------
// Groups are separated by padding space only (no divider lines). Feeds:
// Home / My Network / Explore. Channels: Misskey family only (Mastodon has
// no equivalent backend, so the group hides there). Collections: one row
// per concept with the platform's own name — Mastodon `Bookmarks` (opens
// the Favorites screen) + `Lists`; Misskey `Clips` + `Antennas`. Favourites
// on Misskey live inside Clips (a pinned entry to Favorites); Misskey
// lists live inside Antennas (a link to Lists) — see those screens.
// `Pages` is a Misskey-only stub (disabled with a reason) until it ships.
// Footer quick actions: Settings + Messages + Notifications everywhere,
// plus My Uploads (Drive) on Misskey only.
type CollectionTarget = 'Channels' | 'Clips' | 'Antennas' | 'Lists' | 'Favorites'

type StackDestination =
  | CollectionTarget
  | 'Conversations'
  | 'ChatRooms'
  | 'Announcements'
  | 'Drive'

const COLLECTION_ICONS: Record<CollectionTarget, (p: {size?: number; color?: string}) => ReactNode> = {
  Channels: ChannelIcon,
  Clips: ClipIcon,
  Antennas: AntennaIcon,
  Lists: ListIcon,
  Favorites: StarIcon,
}

function collectionEntries(
  session: {family: string} | null,
  backend: Backend | null,
): CollectionTarget[] {
  if (!session) return []
  // Misskey: channels (capability + module gate), clips (capability +
  // module gate), antennas (family gate, as before).
  if (session.family === 'misskey') {
    const out: CollectionTarget[] = []
    if (backend?.capabilities.channels === 'supported' && backend.channels) {
      out.push('Channels')
    }
    if (backend?.capabilities.clips === 'supported' && backend.clips) {
      out.push('Clips')
    }
    out.push('Antennas')
    return out
  }
  // Mastodon: bookmarks (the Favorites screen, always present when signed
  // in) + lists (capability + module gate). No channels row — there is no
  // Communities backend yet, so the group hides instead of going inert.
  const out: CollectionTarget[] = ['Favorites']
  if (backend?.capabilities.lists === 'supported' && backend.lists) {
    out.push('Lists')
  }
  return out
}

function collectionEntryLabel(i18n: I18n, key: CollectionTarget): string {
  switch (key) {
    case 'Channels':
      return i18n._(msg`Channels`)
    case 'Clips':
      return i18n._(msg`Clips`)
    case 'Antennas':
      return i18n._(msg`Antennas`)
    case 'Lists':
      return i18n._(msg`Lists`)
    case 'Favorites':
      return i18n._(msg`Bookmarks`)
  }
}

/** Collection rows navigate to stack screens, except Misskey `Bookmarks`
 * which is the Favorites screen under its platform name. */
function collectionTarget(key: CollectionTarget): StackDestination {
  return key
}

/** Stable testIDs under the platform label (Bookmarks, not Favorites). */
function collectionTestID(key: CollectionTarget): string {
  if (key === 'Favorites') return 'sidebar-bookmarks'
  return `sidebar-${key.toLowerCase()}`
}

/** `@user@host` for the sidebar footer identity row. The username comes
 * from the session profile — `accountId` is the internal session key (a
 * server-side ID like `are3i8gsgn…`), never the login name. */
export function handleLine(session: {
  accountId: string
  origin: string
  user?: {username: string} | null
}): string {
  const username = session.user?.username ?? session.accountId
  try {
    return `@${username}@${new URL(session.origin).host}`
  } catch {
    return `@${username}@${session.origin}`
  }
}

/** Which message destination ships, if any: the DM inbox on mastodon +
 * akkoma, Misskey chat rooms on misskey + sharkey. Null hides the footer
 * entry instead of rendering an inert control. */
function messageTarget(backend: Backend | null): 'Conversations' | 'ChatRooms' | null {
  if (backend?.capabilities.direct_messages === 'supported' && backend.conversations) {
    return 'Conversations'
  }
  if (backend?.capabilities.direct_messages === 'supported' && backend.chat) {
    return 'ChatRooms'
  }
  return null
}

/** Misskey Pages stub reason (sidebar reshuffle: Pages ship later). */
function pagesStubReason(i18n: I18n): string {
  return i18n._(msg`Pages ship in a later slice.`)
}

/** Open a stack screen from shell chrome (lives outside every navigator). */
function goStackScreen(key: StackDestination) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate(key as never)
}

function AccountAvatar({size = 32}: {size?: number}) {
  const session = useOptionalActiveSession()
  const alf = useAlfTheme()
  const uri = session?.user?.avatarUrl ?? null
  const label = (session?.user?.displayName ?? session?.accountId ?? '?')
    .slice(0, 1)
    .toUpperCase()
  if (uri) {
    return (
      <Image
        source={{uri}}
        style={{width: size, height: size, borderRadius: size / 2}}
        accessibilityIgnoresInvertColors
      />
    )
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: alf.palette.raise,
      }}>
      <Body>{label}</Body>
    </View>
  )
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

// --- Account menu (N16) ------------------------------------------------------
// v1 `AccountCard` parity, shell-chrome edition: the sidebar footer avatar
// and the mobile strip avatar open the full account list — every stored
// session as a row (name + origin), the active account labelled (never an
// inert switch button), one-tap switch for inactive accounts, per-account
// sign-out, Add account, Profile shortcut, and Announcements. Everything
// else (Messages, collections, Drive, Settings) lives in the sidebar
// proper or its footer buttons, so the menu no longer duplicates them.
// Rendered in `AnchoredPopup` (above the sidebar trigger, below the strip
// trigger), which flips and clamps so the menu can never hang off-screen.
function AccountMenu({
  onClose,
  testPrefix,
  overflowActions,
}: {
  onClose: () => void
  testPrefix: string
  /** Rail overflow: the collapsed sidebar hides its Settings / My Uploads
   * footer buttons, so the profile menu carries them instead. Expanded
   * sidebar and mobile strip leave this off (footer owns them there). */
  overflowActions?: boolean
}) {
  const {i18n} = useLingui()
  const store = useSessionStore()
  const sessions = useSessions()
  const activeId = store.activeId()
  const active = sessions.find(s => s.id === activeId) ?? null
  const backend = useMemo(() => (active ? backendForSession(active) : null), [active])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const closeAnd = (fn: () => void) => {
    onClose()
    fn()
  }
  const signOut = (id: string) => {
    setBusyId(id)
    setError(null)
    void store
      .signOut(id)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Sign-out failed.')
      })
      .finally(() => setBusyId(null))
  }

  return (
    <>
      <PopupHead>{i18n._(msg`Accounts`)}</PopupHead>
      {sessions.map(session => {
        const name = session.user?.displayName ?? session.accountId
        const isActive = session.id === activeId
        return (
          <View key={session.id}>
            {isActive ? (
              <PopupRow
                testID={`${testPrefix}-current-${session.id}`}
                label={name}
                disabled
                reason={i18n._(msg`Current account`)}
                onPress={() => {}}
                right={<PopupRadioDot on />}
              >
                <PopupDesc>{`${name} · ${session.origin}`}</PopupDesc>
              </PopupRow>
            ) : (
              <PopupRow
                testID={`${testPrefix}-switch-${session.id}`}
                label={i18n._(msg`Switch to ${name}`)}
                onPress={() => closeAnd(() => store.switch(session.id))}
                right={<PopupRadioDot on={false} />}
              >
                <PopupDesc>{`${name} · ${session.origin}`}</PopupDesc>
              </PopupRow>
            )}
            <PopupRow
              testID={`${testPrefix}-signout-${session.id}`}
              label={i18n._(msg`Sign out ${name}`)}
              disabled={busyId === session.id}
              reason={busyId === session.id ? i18n._(msg`Working…`) : undefined}
              onPress={() => signOut(session.id)}
            />
          </View>
        )
      })}
      <PopupSep />
      <PopupRow
        testID={`${testPrefix}-add`}
        label={i18n._(msg`Add account`)}
        onPress={() => closeAnd(() => navigationRef.navigate('Login'))}
      />
      <PopupSep />
      <PopupRow
        testID={`${testPrefix}-profile`}
        label={i18n._(msg`Profile`)}
        onPress={() => closeAnd(() => goMainTab('User'))}
      />
      {/* Announcements is the only stack destination left in the menu:
          everything else has a first-class sidebar or footer entry. */}
      {backend?.capabilities.announcements === 'supported' && backend.announcements ? (
        <PopupRow
          testID={`${testPrefix}-announcements`}
          label={i18n._(msg`Announcements`)}
          onPress={() => closeAnd(() => goStackScreen('Announcements'))}
        />
      ) : null}
      {/* Rail overflow: the collapsed sidebar hides Settings + My Uploads
          (footer buttons), so they live here instead. Expanded sidebar
          owns them in the footer, so they stay out of this menu there. */}
      {overflowActions ? (
        <>
          <PopupRow
            testID={`${testPrefix}-settings`}
            label={i18n._(msg`Settings`)}
            onPress={() =>
              closeAnd(() => {
                if (navigationRef.isReady()) navigationRef.navigate('Settings')
              })
            }
          />
          {active?.family === 'misskey' ? (
            <PopupRow
              testID={`${testPrefix}-uploads`}
              label={i18n._(msg`My Uploads`)}
              onPress={() => closeAnd(() => goStackScreen('Drive'))}
            />
          ) : null}
        </>
      ) : null}
      {error ? <Caption testID={`${testPrefix}-error`}>{error}</Caption> : null}
    </>
  )
}

function AccountButton({
  testPrefix,
  menuSide,
  overflowActions,
}: {
  testPrefix: string
  menuSide: 'below' | 'above'
  overflowActions?: boolean
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<ViewType | null>(null)
  return (
    <>
      <View ref={anchor} collapsable={false}>
        <Pressable
          onPress={() => setOpen(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={t`Account menu`}
          accessibilityState={{expanded: open}}
          hitSlop={8}
          testID={testPrefix}>
          <AccountAvatar />
        </Pressable>
      </View>
      {open ? (
        <AnchoredPopup
          anchor={anchor}
          onClose={() => setOpen(false)}
          side={menuSide}
          minWidth={240}
          testID={`${testPrefix}-menu`}>
          <AccountMenu
            onClose={() => setOpen(false)}
            testPrefix={`${testPrefix}-menu`}
            overflowActions={overflowActions}
          />
        </AnchoredPopup>
      ) : null}
    </>
  )
}

// --- Mobile top strip (Keystone v1 `.mobile-account`): back | section
// title | account. Only in the mobile layout; wider shells use the
// sidebar + pageheads instead.
function MobileStrip({leaf}: {leaf: LeafState}) {
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

function ShellTabBar({leaf}: {leaf: LeafState}) {
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

// --- Sidebar (rail + full): feeds, channels, collections, footer actions.
// 220px with labels, 68px icon rail 721–1000px. Sticky full-height column.
// Groups are separated by padding space only (no divider lines). Feed
// entries go through `goMainTab` — the sidebar lives outside every
// navigator, so bare tab names would resolve nowhere.
function Sidebar({layout, leaf}: {layout: ShellLayout; leaf: LeafState}) {
  const session = useOptionalActiveSession()
  const {i18n} = useLingui()
  const alf = useAlfTheme()
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  const rail = layout === 'rail'
  const isMisskey = session?.family === 'misskey'
  const entries: {key: keyof TabParamList; label: string}[] = [
    {key: 'Home', label: i18n._(msg`Home`)},
    {key: 'Network', label: i18n._(msg`My Network`)},
    {key: 'Explore', label: i18n._(msg`Explore`)},
  ]
  const allCollections = collectionEntries(session, backend)
  const channelRows = allCollections.filter(k => k === 'Channels')
  const collectionRows = allCollections.filter(k => k !== 'Channels')
  const msgTarget = messageTarget(backend)
  const quickActions: {
    key: string
    label: string
    testID: string
    Icon: (p: {size?: number; color?: string}) => ReactNode
    badge?: boolean
    onPress: () => void
  }[] = []
  if (session) {
    quickActions.push({
      key: 'settings',
      label: i18n._(msg`Settings`),
      testID: 'sidebar-settings',
      Icon: SettingsIcon,
      onPress: () => navigationRef.navigate('Settings'),
    })
    if (msgTarget) {
      quickActions.push({
        key: 'messages',
        label: i18n._(msg`Messages`),
        testID: 'sidebar-messages',
        Icon: MessageIcon,
        onPress: () => goStackScreen(msgTarget),
      })
    }
    if (isMisskey) {
      quickActions.push({
        key: 'uploads',
        label: i18n._(msg`My Uploads`),
        testID: 'sidebar-uploads',
        Icon: DriveIcon,
        onPress: () => goStackScreen('Drive'),
      })
    }
    quickActions.push({
      key: 'notifications',
      label: i18n._(msg`Notifications`),
      testID: 'sidebar-notifications',
      Icon: BellIcon,
      badge: true,
      onPress: () => goMainTab('Notifications'),
    })
  }
  const renderCollectionRow = (key: CollectionTarget) => {
    const Icon = COLLECTION_ICONS[key]
    const label = collectionEntryLabel(i18n, key)
    const target = collectionTarget(key)
    const active = leaf.name === target
    const fg = active ? alf.palette.bg : alf.palette.text
    return (
      <Pressable
        key={key}
        onPress={() => goStackScreen(target)}
        accessibilityRole="button"
        accessibilityState={{selected: active}}
        accessibilityLabel={label}
        testID={collectionTestID(key)}
        style={[
          styles.navlink,
          rail && styles.navlinkRail,
          active && {backgroundColor: alf.palette.text},
        ]}>
        <Icon size={20} color={fg} />
        {rail ? null : <Body style={{color: fg}}>{label}</Body>}
      </Pressable>
    )
  }
  // Signed out, the sidebar footer carries Sign in (v1) — no Login entry up
  // top. (The Login *tab* still exists for the mobile layout.)
  return (
    <View
      style={[
        styles.sidebar,
        rail ? styles.sidebarRail : styles.sidebarFull,
        {borderRightColor: alf.palette.border},
      ]}>
      {rail ? (
        <Heading style={styles.brand}>K</Heading>
      ) : (
        <Heading style={styles.brand}>Keystone</Heading>
      )}
      {entries.map(e => {
        const active = isTabFocused(leaf, e.key, session?.accountId ?? null)
        const fg = active ? alf.palette.bg : alf.palette.text
        return (
          <Pressable
            key={e.key}
            onPress={() => goMainTab(e.key)}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            accessibilityLabel={e.label}
            style={[
              styles.navlink,
              rail && styles.navlinkRail,
              active && {backgroundColor: alf.palette.text},
            ]}>
            <TabIcon name={e.key} color={fg} />
            {rail ? null : <Body style={{color: fg}}>{e.label}</Body>}
          </Pressable>
        )
      })}
      {isMisskey ? (
        <View style={styles.sideGroup}>
          {channelRows.map(renderCollectionRow)}
          <Pressable
            disabled
            accessibilityRole="button"
            accessibilityState={{disabled: true}}
            accessibilityLabel={`${i18n._(msg`Pages`)}. ${pagesStubReason(i18n)}`}
            testID="sidebar-pages"
            style={[styles.navlink, rail && styles.navlinkRail, {opacity: 0.55}]}>
            <PageIcon size={20} color={alf.palette.text} />
            {rail ? null : <Body>{i18n._(msg`Pages`)}</Body>}
          </Pressable>
        </View>
      ) : null}
      {collectionRows.length > 0 ? (
        <View style={styles.sideGroup}>{collectionRows.map(renderCollectionRow)}</View>
      ) : null}
      <View style={{flex: 1}} />
      <View style={styles.navuser}>
        {session ? (
          <>
            <View style={[styles.navlink, rail && styles.navlinkRail]}>
              <AccountButton
                testPrefix="sidebar-account"
                menuSide="above"
                overflowActions={rail}
              />
              {rail ? null : (
                <View style={{flex: 1, minWidth: 0}}>
                  <Body numberOfLines={1}>
                    {session.user?.displayName ?? session.accountId}
                  </Body>
                  <Caption color="faint" numberOfLines={1}>
                    {handleLine(session)}
                  </Caption>
                </View>
              )}
            </View>
            {/* Post sits below the profile, above the quick actions — in
                BOTH layouts, so the narrow sidebar never loses it. The
                outline + pencil mark it apart from the category tabs. */}
            <Pressable
              onPress={() => navigationRef.navigate('Compose')}
              accessibilityRole="button"
              accessibilityLabel={t`Write a post`}
              testID="sidebar-post"
              style={[
                styles.navlink,
                rail && styles.navlinkRail,
                styles.postButton,
                {borderColor: alf.palette.edge},
              ]}>
              <PencilIcon size={20} color={alf.palette.text} />
              {rail ? null : <Body>{t`Post`}</Body>}
            </Pressable>
            {rail ? (
              <View style={styles.quickRail}>
                {quickActions
                  .filter(a => a.key !== 'settings' && a.key !== 'uploads')
                  .map(a => (
                    <Pressable
                      key={a.key}
                      onPress={a.onPress}
                      accessibilityRole="button"
                      accessibilityLabel={a.label}
                      testID={a.testID}
                      style={styles.navlinkRail}>
                      <a.Icon size={20} color={alf.palette.text} />
                      {a.badge ? (
                        <NotificationsUnreadBadge sessionId={session.id} compact />
                      ) : null}
                    </Pressable>
                  ))}
              </View>
            ) : (
              <View style={[styles.quickGrid, isMisskey && styles.quickGridWrap]}>
                {quickActions.map(a => (
                  <Pressable
                    key={a.key}
                    onPress={a.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={a.label}
                    testID={a.testID}
                    style={[styles.quickCell, isMisskey && styles.quickCellHalf]}>
                    <View style={styles.quickIconRow}>
                      <a.Icon size={20} color={alf.palette.text} />
                      {a.badge ? (
                        <NotificationsUnreadBadge sessionId={session.id} compact />
                      ) : null}
                    </View>
                    <Body style={[styles.tabLabel, {color: alf.palette.text}]} numberOfLines={1}>
                      {a.label}
                    </Body>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : (
          <Pressable
            onPress={() => goMainTab('Login')}
            accessibilityRole="button"
            accessibilityLabel={t`Sign in`}
            style={[styles.navlink, rail && styles.navlinkRail]}>
            <LoginIcon size={20} color={alf.palette.text} />
            {rail ? null : <Body>{t`Sign in`}</Body>}
          </Pressable>
        )}
      </View>
    </View>
  )
}

function RightNav() {
  const {i18n} = useLingui()
  return (
    <View style={[{width: 300}, {padding: 16}]}>
      <Body color="faint">{i18n._(msg`Widgets land in Phase 5.`)}</Body>
    </View>
  )
}

const Tab = createBottomTabNavigator<TabParamList>()
const Stack = createNativeStackNavigator<StackParamList>()

function MainTabs() {
  const {i18n} = useLingui()
  const session = useOptionalActiveSession()
  // No tabBar here: v1's bar stays visible on pushed screens, so the
  // shell renders `ShellTabBar` itself (mobile layout only).
  return (
    <Tab.Navigator screenOptions={{headerShown: false, tabBarStyle: {display: 'none'}}}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{tabBarLabel: i18n._(msg`Home`)}}
      />
      <Tab.Screen
        name="Network"
        component={NetworkScreen}
        options={{tabBarLabel: i18n._(msg`Network`)}}
      />
      <Tab.Screen
        name="Explore"
        component={ExploreScreen}
        options={{tabBarLabel: i18n._(msg`Explore`)}}
      />
      {session ? (
        <>
          <Tab.Screen
            name="Notifications"
            component={NotificationsScreen}
            options={{tabBarLabel: i18n._(msg`Notifications`)}}
          />
          <Tab.Screen
            name="User"
            component={UserScreen}
            options={{tabBarLabel: i18n._(msg`Profile`)}}
          />
        </>
      ) : (
        <Tab.Screen
          name="Login"
          component={LoginScreen}
          options={{tabBarLabel: i18n._(msg`Sign in`)}}
        />
      )}
    </Tab.Navigator>
  )
}

export function Navigation({initialState}: {initialState?: InitialState}) {
  const layout = useShellLayout()
  const {rightNavVisible} = useLayoutBreakpoints()
  const [leaf, setLeaf] = useState<LeafState>({name: undefined})
  const alf = useAlfTheme()
  // Runtime deploy base (hosting boot in Root.tsx): subscribe, never a
  // build-time constant. Unresolved (bare tests, no provider) → root `/`.
  const hosting = useHosting()
  const shellBase = normalizeShellBase(hosting?.basePath)
  const shellLinking = useMemo<LinkingOptions<StackParamList>>(
    () => ({
      prefixes: linkingPrefixesForBase(shellBase),
      config: {
        screens: linkingScreens(),
      },
      getStateFromPath: (path, options) => getStateFromPathWithBase(path, shellBase, options),
    }),
    [shellBase],
  )
  const mobile = layout === 'mobile'
  const wide = Platform.OS === 'web' && rightNavVisible
  // The compose overlay takes over the whole viewport (v1): the mobile
  // strip stays out of its way while it is focused.
  const stripVisible = mobile && leaf.name !== 'Compose'
  const baseTheme = alf.name === 'dark' ? DarkTheme : DefaultTheme
  const navTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: alf.palette.bg,
      card: alf.palette.bg,
      text: alf.palette.text,
      border: alf.palette.border,
    },
  }
  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      linking={shellLinking}
      initialState={initialState}
      onReady={() => {
        try {
          const state = navigationRef.getState()
          if (state) {
            const next = leafOf(state)
            recordFeedVisit(next)
            setLeaf(next)
          }
        } catch {
          // Not ready yet; the state callback lands on first navigation.
        }
      }}
      onStateChange={state => {
        if (state) {
          const next = leafOf(state)
          recordFeedVisit(next)
          setLeaf(next)
        }
      }}>
      <PostHandlersProvider>
        <View
          style={[
            styles.shell,
            {backgroundColor: alf.palette.bg},
            mobile ? styles.shellColumn : styles.shellRow,
          ]}>
          {mobile ? null : <Sidebar layout={layout} leaf={leaf} />}
          <View
            style={[
              styles.maincol,
              mobile
                ? null
                : {borderRightColor: alf.palette.border, borderRightWidth: 1},
            ]}>
            {stripVisible ? <MobileStrip leaf={leaf} /> : null}
            {/* 0.8 — global, per-session permission/scope prompt. Reads
                `scopeHealth` for the active session, so it survives a
                screen unmount and shows for every route in the shell. */}
            <ScopeUpgradeBanner />
            <Stack.Navigator screenOptions={{headerShown: false, animation: 'none'}}>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen name="Note" component={NoteScreen} />
              <Stack.Screen name="NoteHistory" component={NoteHistoryScreen} />
              <Stack.Screen name="Tag" component={TagScreen} />
              <Stack.Screen name="List" component={ListScreen} />
              <Stack.Screen name="Lists" component={ListsScreen} />
              <Stack.Screen name="Clip" component={ClipScreen} />
              <Stack.Screen name="Clips" component={ClipsScreen} />
              <Stack.Screen name="Channel" component={ChannelScreen} />
              <Stack.Screen name="Channels" component={ChannelsScreen} />
              <Stack.Screen name="Conversations" component={ConversationsScreen} />
              <Stack.Screen name="Conversation" component={ConversationScreen} />
              <Stack.Screen name="ChatRooms" component={ChatRoomsScreen} />
              <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />
              <Stack.Screen name="ChatUser" component={ChatUserScreen} />
              <Stack.Screen name="Announcements" component={AnnouncementsScreen} />
              <Stack.Screen name="AdminInsight" component={AdminInsightScreen} />
              <Stack.Screen
                name="AdminReports"
                component={AdminReportsScreen}
              />
              <Stack.Screen name="AdminReport" component={AdminReportScreen} />
              <Stack.Screen name="Antenna" component={AntennaScreen} />
              <Stack.Screen name="Antennas" component={AntennasScreen} />
              <Stack.Screen name="Drive" component={DriveScreen} />
              <Stack.Screen name="Favorites" component={FavoritesScreen} />
              <Stack.Screen name="Followers" component={FollowersScreen} />
              <Stack.Screen name="Following" component={FollowingScreen} />
              <Stack.Screen name="FollowRequests" component={FollowRequestsScreen} />
              <Stack.Screen
                name="ProfileEdit"
                component={ProfileEditorScreen}
                options={{presentation: 'transparentModal', animation: 'none'}}
              />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="AuthCallback" component={AuthCallbackScreen} />
              {/* clickstone §1.13: v1's root-base callback URL renders the
                  same screen (`/auth/callback` stays canonical). */}
              <Stack.Screen name="KeystoneCallback" component={AuthCallbackScreen} />
              <Stack.Screen name="SysDebug" component={SysDebugScreen} />
              <Stack.Screen
                name="Compose"
                component={ComposeScreen}
                options={{presentation: 'transparentModal', animation: 'none'}}
              />
            </Stack.Navigator>
          </View>
          {wide ? <RightNav /> : null}
          {mobile ? <ShellTabBar leaf={leaf} /> : null}
        </View>
      </PostHandlersProvider>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  shellColumn: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  sidebar: {
    flexShrink: 0,
    borderRightWidth: 1,
    padding: 16,
    gap: 4,
    ...Platform.select({
      web: {position: 'sticky', top: 0, height: '100vh'} as unknown as ViewStyle,
      default: {},
    }),
  },
  sidebarFull: {
    ...Platform.select({
      web: {width: 'max-content', minWidth: butterflyPx.sidebarMin, maxWidth: '40vw'} as unknown as ViewStyle,
      default: {width: butterflyPx.sidebarMin},
    }),
  },
  sidebarRail: {
    width: butterflyPx.railWidth,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  brand: {
    fontWeight: '700',
    fontSize: 20,
    marginBottom: 12,
  },
  navlink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  navlinkRail: {
    justifyContent: 'center',
    minHeight: 40,
  },
  postButton: {
    borderWidth: 1,
    marginTop: 8,
  },
  navuser: {
    paddingTop: 12,
    gap: 4,
  },
  sideGroup: {
    marginTop: 28,
  },
  quickGrid: {
    flexDirection: 'row',
    marginTop: 8,
  },
  quickGridWrap: {
    flexWrap: 'wrap',
  },
  quickCell: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  quickCellHalf: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: '50%',
  },
  quickIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  quickRail: {
    alignItems: 'center',
    marginTop: 8,
  },
  maincol: {
    flex: 1,
    width: '100%',
    maxWidth: butterflyPx.mainColMax,
  },
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
