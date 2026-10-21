import {FiltersSection} from '#/components/Settings/FiltersSection'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function FiltersSettingsScreen() {
  return (
    <SectionShell title={SETTINGS_TITLES.filters}>
      <FiltersSection />
    </SectionShell>
  )
}
