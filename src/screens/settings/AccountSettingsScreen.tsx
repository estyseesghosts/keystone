import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {AccountSection} from '#/components/Settings/AccountSection'
import type {RootParamList} from '#/routes'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function AccountSettingsScreen() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  return (
    <SectionShell title={SETTINGS_TITLES.account}>
      <AccountSection
        onAddAccount={() => nav.navigate('Login')}
        onOpenFollowRequests={() => nav.navigate('FollowRequests')}
        onOpenAdminInsight={() => nav.navigate('AdminInsight')}
      />
    </SectionShell>
  )
}
