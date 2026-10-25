import {useI18n} from '#/locale/i18n'

import {FeedsSection} from '#/components/Settings/FeedsSection'

import {settingsTitle} from './meta'
import {SectionShell} from './SectionShell'

export function FeedsSettingsScreen() {
  const i18n = useI18n()
  return (
    <SectionShell title={settingsTitle(i18n, 'feeds')}>
      <FeedsSection />
    </SectionShell>
  )
}
