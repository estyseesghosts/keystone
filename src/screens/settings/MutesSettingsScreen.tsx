import {MutesSection} from '#/components/Settings/MutesSection'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function MutesSettingsScreen() {
  return (
    <SectionShell title={SETTINGS_TITLES.mutes}>
      <MutesSection />
    </SectionShell>
  )
}
