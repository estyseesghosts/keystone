import {useI18n} from '#/locale/i18n'

import {LanguageSection} from '#/components/Settings/LanguageSection'

import {settingsTitle} from './meta'
import {SectionShell} from './SectionShell'

export function LanguageSettingsScreen() {
  const i18n = useI18n()
  return (
    <SectionShell title={settingsTitle(i18n, 'language')}>
      <LanguageSection />
    </SectionShell>
  )
}
