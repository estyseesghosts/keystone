import {useI18n} from '#/locale/i18n'

import {DisplaySection} from '#/components/Settings/DisplaySection'
import {PrivacySection} from '#/components/Settings/PrivacySection'

import {settingsTitle} from './meta'
import {SectionShell} from './SectionShell'

export function DisplaySettingsScreen() {
  const i18n = useI18n()
  return (
    <SectionShell title={settingsTitle(i18n, 'display')}>
      <DisplaySection />
      {/* Repair X2.5: preview + shield prefs live here (display/device
        behavior) rather than a new tenth route section — no route-type,
        meta, or deep-link churn for two switches and a radio. */}
      <PrivacySection />
    </SectionShell>
  )
}
