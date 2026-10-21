import {LanguageSection} from '#/components/Settings/LanguageSection'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function LanguageSettingsScreen() {
  return (
    <SectionShell title={SETTINGS_TITLES.language}>
      <LanguageSection />
    </SectionShell>
  )
}
