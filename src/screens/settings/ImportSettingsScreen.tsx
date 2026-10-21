import {ImportSection} from '#/components/Settings/TransferSections'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function ImportSettingsScreen() {
  return (
    <SectionShell title={SETTINGS_TITLES.import}>
      <ImportSection />
    </SectionShell>
  )
}
