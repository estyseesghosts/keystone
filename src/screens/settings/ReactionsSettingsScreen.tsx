import {useI18n} from '#/locale/i18n'

import {ReactionsSection} from '#/components/Settings/ReactionsSection'

import {settingsTitle} from './meta'
import {SectionShell} from './SectionShell'

export function ReactionsSettingsScreen() {
  const i18n = useI18n()
  return (
    <SectionShell title={settingsTitle(i18n, 'reactions')}>
      <ReactionsSection />
    </SectionShell>
  )
}
