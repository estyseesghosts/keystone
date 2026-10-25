import {useNavigation, type NavigationProp} from '@react-navigation/native'
import {useI18n} from '#/locale/i18n'

import {AccountSection} from '#/components/Settings/AccountSection'
import type {RootParamList} from '#/routes'

import {settingsTitle} from './meta'
import {SectionShell} from './SectionShell'

export function AccountSettingsScreen() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const i18n = useI18n()
  return (
    <SectionShell title={settingsTitle(i18n, 'account')}>
      <AccountSection
        onAddAccount={() => nav.navigate('Login')}
        onOpenFollowRequests={() => nav.navigate('FollowRequests')}
        onOpenAdminInsight={() => nav.navigate('AdminInsight')}
        onOpenAdminReports={() => nav.navigate('AdminReports')}
      />
    </SectionShell>
  )
}
