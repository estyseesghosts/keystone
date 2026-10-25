import {useI18n} from '#/locale/i18n'

import {MutesSection} from '#/components/Settings/MutesSection'

import {settingsTitle} from './meta'
import {SectionShell} from './SectionShell'

export function MutesSettingsScreen() {
  const i18n = useI18n()
  return (
    <SectionShell title={settingsTitle(i18n, 'mutes')}>
      <MutesSection />
    </SectionShell>
  )
}
