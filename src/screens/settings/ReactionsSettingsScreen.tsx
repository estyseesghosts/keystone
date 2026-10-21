import {ReactionsSection} from '#/components/Settings/ReactionsSection'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function ReactionsSettingsScreen() {
  return (
    <SectionShell title={SETTINGS_TITLES.reactions}>
      <ReactionsSection />
    </SectionShell>
  )
}
