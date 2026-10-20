import {View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {atoms} from '#/alf/atoms'
import {Heading} from '#/alf/typography'
import {AccountSwitcher} from '#/components/AccountSwitcher'
import type {RootParamList} from '#/routes'

// Settings: account management (switch, sign out, sign out everywhere, add
// another) over the session store. Display/appearance settings land here in
// a later slice; this screen exists now so signed-in users can reach the
// Login flow again (the Sign in tab only shows while signed out).
export function SettingsScreen() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  return (
    <View style={[atoms.flex1, atoms.p_md, atoms.gap_md]} testID="settings-screen">
      <Heading>Settings</Heading>
      <AccountSwitcher onAddAccount={() => nav.navigate('Login')} />
    </View>
  )
}
