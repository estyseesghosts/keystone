import {DisplaySection} from '#/components/Settings/DisplaySection'
import {PrivacySection} from '#/components/Settings/PrivacySection'

import {SETTINGS_TITLES} from './meta'
import {SectionShell} from './SectionShell'

export function DisplaySettingsScreen() {
  return (
    <SectionShell title={SETTINGS_TITLES.display}>
      <DisplaySection />
      {/* Repair X2.5: preview + shield prefs live here (display/device
        behavior) rather than a new tenth route section — no route-type,
        meta, or deep-link churn for two switches and a radio. */}
      <PrivacySection />
    </SectionShell>
  )
}
