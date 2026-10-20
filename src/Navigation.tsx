import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs'
import {
  NavigationContainer,
  useNavigation,
  type InitialState,
  type LinkingOptions,
  type NavigationProp,
} from '@react-navigation/native'
import {createNativeStackNavigator} from '@react-navigation/native-stack'
import * as Linking from 'expo-linking'
import {Platform, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useLayoutBreakpoints} from '#/alf/breakpoints'
import {Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import type {RootParamList} from '#/routes'
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
  'Home' | 'Network' | 'Explore' | 'Notifications' | 'User'
>

type StackParamList = RootParamList & {Main: undefined}

const Tab = createBottomTabNavigator<TabParamList>()
const Stack = createNativeStackNavigator<StackParamList>()

// Deep-link table. Mirrors the canonical `paths` in `#/routes`
// (which documents Keystone's web URLs); this is the shape
// react-navigation consumes.
export const linking: LinkingOptions<StackParamList> = {
  prefixes: [Linking.createURL('/')],
  config: {
    screens: {
      Main: {
        screens: {
          Home: '',
          Network: 'network/:tab?',
          Explore: 'explore',
          Notifications: 'notifications',
          User: 'users/:id?',
        },
      },
      Note: 'notes/:id',
      Tag: 'tags/:tag',
      List: 'lists/:id',
      Settings: 'settings',
      Login: 'login',
      AuthCallback: 'auth/callback',
      SysDebug: 'sys/debug',
      Compose: 'compose',
    },
  },
}

function LeftNav() {
  const nav = useNavigation<NavigationProp<TabParamList>>()
  const {i18n} = useLingui()
  const entries: {key: keyof TabParamList; label: string}[] = [
    {key: 'Home', label: i18n._(msg`Home`)},
    {key: 'Network', label: i18n._(msg`Network`)},
    {key: 'Explore', label: i18n._(msg`Explore`)},
    {key: 'Notifications', label: i18n._(msg`Notifications`)},
    {key: 'User', label: i18n._(msg`Profile`)},
  ]
  return (
    <View style={[{width: 220}, atoms.p_md, atoms.gap_sm]}>
      <Heading>Keystone</Heading>
      {entries.map(e => (
        <Button
          key={e.key}
          label={e.label}
          variant="secondary"
          onPress={() => nav.navigate(e.key)}
        />
      ))}
    </View>
  )
}

function RightNav() {
  const {i18n} = useLingui()
  return (
    <View style={[{width: 300}, atoms.p_md]}>
      <Caption color="faint">{i18n._(msg`Widgets land in Phase 5.`)}</Caption>
    </View>
  )
}

function MainTabs() {
  const {i18n} = useLingui()
  const showTabBar = !(Platform.OS === 'web')
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: showTabBar ? undefined : {display: 'none'},
      }}>
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
    </Tab.Navigator>
  )
}

export function Navigation({initialState}: {initialState?: InitialState}) {
  const {rightNavVisible} = useLayoutBreakpoints()
  const wide = Platform.OS === 'web' && rightNavVisible
  const leftRail = Platform.OS === 'web'
  return (
    <NavigationContainer linking={linking} initialState={initialState}>
      <PostHandlersProvider>
      <View style={[atoms.flex1, (leftRail || wide) && atoms.row]}>
        {leftRail ? <LeftNav /> : null}
        <View style={atoms.flex1}>
          <Stack.Navigator screenOptions={{headerShown: false}}>
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
              options={{presentation: 'modal'}}
            />
          </Stack.Navigator>
        </View>
        {wide ? <RightNav /> : null}
      </View>
      </PostHandlersProvider>
    </NavigationContainer>
  )
}
