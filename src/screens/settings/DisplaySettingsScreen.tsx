import {DisplaySection} from '#/components/Settings/DisplaySection'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function DisplaySettingsScreen() {
  return (
    <SectionShell title={SETTINGS_TITLES.display}>
      <DisplaySection />
    </SectionShell>
  )
}
