import {useI18n} from '#/locale/i18n'

import {ImportSection} from '#/components/Settings/TransferSections'

import {settingsTitle} from './meta'
import {SectionShell} from './SectionShell'

export function ImportSettingsScreen() {
  const i18n = useI18n()
  return (
    <SectionShell title={settingsTitle(i18n, 'import')}>
      <ImportSection />
    </SectionShell>
  )
}
