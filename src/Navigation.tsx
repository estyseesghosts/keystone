import {useMemo, useState} from 'react'
import {Platform, StyleSheet, View} from 'react-native'
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type InitialState,
  type LinkingOptions,
} from '@react-navigation/native'
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs'
import {createNativeStackNavigator} from '@react-navigation/native-stack'
import {useLingui} from '@lingui/react'
import {msg} from '@lingui/macro'

import {useTheme as useAlfTheme} from '#/alf'
import {useShellLayout} from '#/alf/breakpoints'
import {useViewportWidth} from '#/alf/useViewportWidth'
import {butterflyPx} from '#/alf/tokens'
import {Body} from '#/alf/typography'
import {ScopeUpgradeBanner} from '#/components/ScopeUpgradeBanner'
import {navigationRef} from '#/navigationRef'
import {
  effectiveSidebarLayout,
  useSidebarMode,
} from '#/state/sideNav'
import {linkingScreens} from '#/routes'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'
import {useHosting} from '#/state/hosting'
import {AuthCallbackScreen} from '#/screens/AuthCallback'
import {AntennaScreen} from '#/screens/Antenna'
import {AntennasScreen} from '#/screens/Antennas'
import {ChannelScreen} from '#/screens/Channel'
import {ChannelsScreen} from '#/screens/Channels'
import {ConversationScreen} from '#/screens/Conversation'
import {ConversationsScreen} from '#/screens/Conversations'
import {NewsDiscussionsScreen} from '#/screens/NewsDiscussions'
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
import {Sidebar} from '#/components/shell/Sidebar'
import {ShellTabBar} from '#/components/shell/TabBar'
import {MobileStrip} from '#/components/shell/MobileStrip'
import {
  getStateFromPathWithBase,
  linkingPrefixesForBase,
  normalizeShellBase,
  type StackParamList,
} from '#/components/shell/linking'
import {leafOf, type LeafState, type TabParamList} from '#/components/shell/shellNav'
import {recordFeedVisit} from '#/state/feedMemory'

// D3.4 split: linking helpers live in `#/components/shell/linking`,
// shared chrome primitives in `#/components/shell/shellNav`, and the
// chrome itself in `Sidebar` / `TabBar` / `MobileStrip` / `AccountMenu`.
// This module assembles the navigator and re-exports the moved symbols
// so existing `#/Navigation` importers keep working; new code should
// import from `#/components/shell/*` directly.
export {
  linking,
  normalizeShellBase,
  stripShellBase,
  getStateFromPathWithBase,
  linkingPrefixesForBase,
} from '#/components/shell/linking'
export {goBackOrFeed, NotificationsUnreadBadge} from '#/components/shell/shellNav'
export {handleLine} from '#/components/shell/Sidebar'

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

// Widgets column (Phase 5 stub): 300 content + 16 padding per side.
const RIGHT_NAV_WIDTH = 300 + 32

function RightNav() {
  const {i18n} = useLingui()
  return (
    <View style={{width: RIGHT_NAV_WIDTH, paddingHorizontal: 16, paddingVertical: 16}} testID="right-nav">
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
  const autoLayout = useShellLayout()
  const sidebarMode = useSidebarMode()
  // Manual collapse/expand overrides the width-derived layout on desktop;
  // mobile is always mobile (the override never applies there).
  const layout = effectiveSidebarLayout(autoLayout, sidebarMode)
  const viewportWidth = useViewportWidth()
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
  // Widgets render only when the feed keeps its full 600 AND the 332px
  // widgets column (300 + padding) fits beside the *effective* sidebar —
  // collapsing the sidebar can earn the widgets back on narrow windows.
  // Without widgets the feed widens to mainColMaxWide instead of leaving
  // the freed space empty.
  const sidebarWidth = layout === 'full' ? butterflyPx.sidebarMin : butterflyPx.railWidth
  const wide =
    Platform.OS === 'web' &&
    !mobile &&
    viewportWidth >= sidebarWidth + butterflyPx.mainColMax + RIGHT_NAV_WIDTH
  const feedMaxWidth = wide ? butterflyPx.mainColMax : butterflyPx.mainColMaxWide
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
          {/* Feed column: flexes with the window; the capped inner feed
              centers, so leftover space becomes L/R padding on large
              screens. The widgets rail beside it is a fixed width,
              mounted only when it fits (see `wide` above). */}
          <View style={[styles.maincol, mobile ? styles.maincolMobile : styles.maincolCenter]}>
            {stripVisible ? <MobileStrip leaf={leaf} /> : null}
            {/* 0.8 — global, per-session permission/scope prompt. Reads
                `scopeHealth` for the active session, so it survives a
                screen unmount and shows for every route in the shell. */}
            <View style={styles.bannerStretch}>
              <ScopeUpgradeBanner />
            </View>
            <View
              style={[
                styles.feedcol,
                {maxWidth: mobile ? butterflyPx.mainColMax : feedMaxWidth},
                mobile
                  ? null
                  : {borderRightColor: alf.palette.border, borderRightWidth: 1},
              ]}>
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
              <Stack.Screen name="NewsDiscussions" component={NewsDiscussionsScreen} />
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
    // Left-aligned: the rail/full sidebar hugs the window's left edge.
    // Centering here left a dead gutter between the rail and the edge on
    // any window wider than rail + feed max (dead-space screenshot).
    justifyContent: 'flex-start',
  },
  shellColumn: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  maincol: {
    flex: 1,
    width: '100%',
  },
  maincolMobile: {
    maxWidth: butterflyPx.mainColMax,
  },
  maincolCenter: {
    alignItems: 'center',
  },
  bannerStretch: {
    alignSelf: 'stretch',
  },
  feedcol: {
    flex: 1,
    width: '100%',
  },
})
