import {useI18n} from '#/locale/i18n'

import {ExportSection} from '#/components/Settings/TransferSections'

import {settingsTitle} from './meta'
import {SectionShell} from './SectionShell'

export function ExportSettingsScreen() {
  const i18n = useI18n()
  return (
    <SectionShell title={settingsTitle(i18n, 'export')}>
      <ExportSection />
    </SectionShell>
  )
}
