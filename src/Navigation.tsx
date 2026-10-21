import {useState} from 'react'
import {Image, Platform, Pressable, StyleSheet, View, type ViewStyle} from 'react-native'
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
import * as Linking from 'expo-linking'
import {useLingui} from '@lingui/react'
import {msg} from '@lingui/macro'

import {useTheme as useAlfTheme} from '#/alf'
import {useLayoutBreakpoints, useShellLayout, type ShellLayout} from '#/alf/breakpoints'
import {butterflyPx} from '#/alf/tokens'
import {Body, Heading} from '#/alf/typography'
import {
  BackIcon,
  BellIcon,
  HomeIcon,
  LoginIcon,
  NetworkIcon,
  PencilIcon,
  ProfileIcon,
  SearchIcon,
  SettingsIcon,
} from '#/components/icons'
import {navigationRef} from '#/navigationRef'
import type {RootParamList} from '#/routes'
import {linkingScreens, rewriteLegacyPath, titleForRoute} from '#/routes'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'
import {AuthCallbackScreen} from '#/screens/AuthCallback'
import {ComposeScreen} from '#/screens/Compose'
import {PostHandlersProvider} from '#/screens/PostHandlers'
import {ExploreScreen} from '#/screens/Explore'
import {HomeScreen} from '#/screens/Home'
import {ListScreen} from '#/screens/List'
import {LoginScreen} from '#/screens/Login'
import {NetworkScreen} from '#/screens/Network'
import {NoteScreen} from '#/screens/Note'
import {NotificationsScreen} from '#/screens/Notifications'
import {SettingsScreen} from '#/screens/Settings'
import {SysDebugScreen} from '#/screens/SysDebug'
import {TagScreen} from '#/screens/Tag'
import {UserScreen} from '#/screens/User'

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

/** Deepest focused route (name + params) anywhere in the tree. The shell
 * chrome (strip, sidebar, tab bar) renders under the container — outside
 * any screen, where `useNavigationState` cannot run — so the root state is
 * tracked through the container callbacks and handed down as a prop. */
type LeafState = {name: string | undefined; params?: {id?: unknown; tag?: unknown; acct?: unknown}}

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

// --- Mobile top strip (Keystone v1 `.mobile-account`): back | section
// title | account. Only in the mobile layout; wider shells use the
// sidebar + pageheads instead.
function MobileStrip({leaf}: {leaf: LeafState}) {
  const session = useOptionalActiveSession()
  const alf = useAlfTheme()
  return (
    <View
      style={[
        styles.strip,
        {backgroundColor: alf.palette.bg, borderBottomColor: alf.palette.border},
      ]}>
      <View style={styles.stripSide}>
        <Pressable
          onPress={() => {
            // Live off the root ref: a value captured at render time would
            // go stale and strand the back button on pushed screens.
            if (navigationRef.isReady() && navigationRef.canGoBack()) navigationRef.goBack()
          }}
          accessibilityRole="button"
          accessibilityLabel="Back"
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
          <Pressable
            onPress={() => navigationRef.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Accounts and settings"
            hitSlop={8}
            testID="strip-account">
            <AccountAvatar />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => navigationRef.navigate('Login')}
            accessibilityRole="button"
            hitSlop={8}
            testID="strip-signin">
            <Body>Sign in</Body>
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
  Home: 'Home',
  Network: 'My Network',
  Explore: 'Search',
  Notifications: 'Notifications',
  User: 'Profile',
  Login: 'Sign in',
}

const SIGNED_IN_TABS: (keyof TabParamList)[] = ['Home', 'Network', 'Explore', 'Notifications', 'User']
const SIGNED_OUT_TABS: (keyof TabParamList)[] = ['Home', 'Network', 'Explore', 'Login']

function ShellTabBar({leaf}: {leaf: LeafState}) {
  const session = useOptionalActiveSession()
  const alf = useAlfTheme()
  const tabs = session ? SIGNED_IN_TABS : SIGNED_OUT_TABS
  const ownAccountId = session?.accountId ?? null
  return (
    <View
      style={[
        styles.tabbar,
        {backgroundColor: alf.palette.bg, borderTopColor: alf.palette.border},
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
          </Pressable>
        )
      })}
    </View>
  )
}

// --- Sidebar (rail + full): v1 `.sitenav`. 220px with labels, 68px icon
// rail 721–1000px. Sticky full-height column with the account footer.
// Like the tab bar, entries go through `goMainTab` — the sidebar lives
// outside every navigator, so bare tab names would resolve nowhere.
function Sidebar({layout, leaf}: {layout: ShellLayout; leaf: LeafState}) {
  const session = useOptionalActiveSession()
  const {i18n} = useLingui()
  const alf = useAlfTheme()
  const rail = layout === 'rail'
  const entries: {key: keyof TabParamList; label: string}[] = [
    {key: 'Home', label: i18n._(msg`Home`)},
    {key: 'Network', label: i18n._(msg`My Network`)},
    {key: 'Explore', label: i18n._(msg`Explore`)},
  ]
  if (session) {
    entries.push(
      {key: 'Notifications', label: i18n._(msg`Notifications`)},
      {key: 'User', label: i18n._(msg`Profile`)},
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
      {session && !rail ? (
        <Pressable
          onPress={() => navigationRef.navigate('Compose')}
          accessibilityRole="button"
          accessibilityLabel="Write a post"
          style={[styles.navlink, styles.postButton, {borderColor: alf.palette.edge}]}>
          <PencilIcon size={20} color={alf.palette.text} />
          <Body>Post</Body>
        </Pressable>
      ) : null}
      <View style={{flex: 1}} />
      <View style={[styles.navuser, {borderTopColor: alf.palette.border}]}>
        {session ? (
          <Pressable
            onPress={() => navigationRef.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Accounts and settings"
            style={[styles.navlink, rail && styles.navlinkRail]}>
            <AccountAvatar />
            {rail ? null : (
              <Body numberOfLines={1} style={{flex: 1, minWidth: 0}}>
                {session.user?.displayName ?? session.accountId}
              </Body>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => goMainTab('Login')}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            style={[styles.navlink, rail && styles.navlinkRail]}>
            <LoginIcon size={20} color={alf.palette.text} />
            {rail ? null : <Body>Sign in</Body>}
          </Pressable>
        )}
        {!rail ? (
          <Pressable
            onPress={() => navigationRef.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            style={styles.navlink}>
            <SettingsIcon size={20} color={alf.palette.text} />
            <Body>Settings</Body>
          </Pressable>
        ) : null}
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
      linking={linking}
      initialState={initialState}
      onReady={() => {
        try {
          const state = navigationRef.getState()
          if (state) setLeaf(leafOf(state))
        } catch {
          // Not ready yet; the state callback lands on first navigation.
        }
      }}
      onStateChange={state => {
        if (state) setLeaf(leafOf(state))
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
            <Stack.Navigator screenOptions={{headerShown: false, animation: 'none'}}>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen name="Note" component={NoteScreen} />
              <Stack.Screen name="Tag" component={TagScreen} />
              <Stack.Screen name="List" component={ListScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="AuthCallback" component={AuthCallbackScreen} />
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
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 4,
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
})
