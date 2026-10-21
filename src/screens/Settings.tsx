import {ScrollView, View} from 'react-native'
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native'

import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {SETTINGS_SECTIONS, type RootParamList, type SettingsSection} from '#/routes'

import {AccountSettingsScreen} from './settings/AccountSettingsScreen'
import {DisplaySettingsScreen} from './settings/DisplaySettingsScreen'
import {ExportSettingsScreen} from './settings/ExportSettingsScreen'
import {FeedsSettingsScreen} from './settings/FeedsSettingsScreen'
import {FiltersSettingsScreen} from './settings/FiltersSettingsScreen'
import {ImportSettingsScreen} from './settings/ImportSettingsScreen'
import {LanguageSettingsScreen} from './settings/LanguageSettingsScreen'
import {SETTINGS_META} from './settings/meta'
import {MutesSettingsScreen} from './settings/MutesSettingsScreen'
import {ReactionsSettingsScreen} from './settings/ReactionsSettingsScreen'

// Settings: the multi-level tree (v1 `frontend/src/routes/Settings.tsx`
// parity). With no `section` route param this renders the index listing
// all nine v1 sections; with one it renders that section's screen
// directly, so deep links (`/settings/mutes`) and browser back resolve
// through the navigator, not component state. Unknown sections fall back
// to the index, never a crash.
//
// Every row is either REAL (reads/writes real state or calls a real
// endpoint) or an honest greyed-out placeholder with its reason —
// nothing is omitted, nothing pretends to work.

function sectionFromParam(raw: unknown): SettingsSection | undefined {
  return typeof raw === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(raw)
    ? (raw as SettingsSection)
    : undefined
}

export function SettingsScreen() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const route = useRoute<RouteProp<RootParamList, 'Settings'>>()
  const section = sectionFromParam(route.params?.section)
  return (
    <ScrollView testID="settings-screen">
      <View style={[atoms.p_md, atoms.gap_md]}>
        {section === undefined ? (
          <>
            <Heading>Settings</Heading>
            {SETTINGS_META.map(s => (
              <Pressable
                key={s.id}
                testID={`settings-row-${s.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${s.title}. ${s.hint}`}
                onPress={() => nav.navigate('Settings', {section: s.id})}
                style={[atoms.gap_sm, {paddingVertical: 8}]}>
                <Body>{s.title}</Body>
                <Caption color="faint">{s.hint}</Caption>
              </Pressable>
            ))}
          </>
        ) : section === 'account' ? (
          <AccountSettingsScreen />
        ) : section === 'display' ? (
          <DisplaySettingsScreen />
        ) : section === 'reactions' ? (
          <ReactionsSettingsScreen />
        ) : section === 'feeds' ? (
          <FeedsSettingsScreen />
        ) : section === 'mutes' ? (
          <MutesSettingsScreen />
        ) : section === 'import' ? (
          <ImportSettingsScreen />
        ) : section === 'export' ? (
          <ExportSettingsScreen />
        ) : section === 'filters' ? (
          <FiltersSettingsScreen />
        ) : (
          <LanguageSettingsScreen />
        )}
      </View>
    </ScrollView>
  )
}
