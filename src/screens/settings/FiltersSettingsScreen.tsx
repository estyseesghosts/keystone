import {useI18n} from '#/locale/i18n'

import {FiltersSection} from '#/components/Settings/FiltersSection'

import {settingsTitle} from './meta'
import {SectionShell} from './SectionShell'

export function FiltersSettingsScreen() {
  const i18n = useI18n()
  return (
    <SectionShell title={settingsTitle(i18n, 'filters')}>
      <FiltersSection />
    </SectionShell>
  )
}
