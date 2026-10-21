import {FeedsSection} from '#/components/Settings/FeedsSection'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function FeedsSettingsScreen() {
  return (
    <SectionShell title={SETTINGS_TITLES.feeds}>
      <FeedsSection />
    </SectionShell>
  )
}
