import {ExportSection} from '#/components/Settings/TransferSections'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function ExportSettingsScreen() {
  return (
    <SectionShell title={SETTINGS_TITLES.export}>
      <ExportSection />
    </SectionShell>
  )
}
