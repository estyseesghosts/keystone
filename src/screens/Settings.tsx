import {useState} from 'react'
import {ScrollView, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Pressable} from '#/components/Pressable'
import type {RootParamList} from '#/routes'

import {AccountSection} from '#/components/Settings/AccountSection'
import {DisplaySection} from '#/components/Settings/DisplaySection'
import {ExportSection, ImportSection} from '#/components/Settings/TransferSections'
import {FeedsSection} from '#/components/Settings/FeedsSection'
import {FiltersSection} from '#/components/Settings/FiltersSection'
import {LanguageSection} from '#/components/Settings/LanguageSection'
import {MutesSection} from '#/components/Settings/MutesSection'
import {ReactionsSection} from '#/components/Settings/ReactionsSection'

// Settings: the multi-level tree (v1 `frontend/src/routes/Settings.tsx`
// parity). The index lists all nine v1 sections; each section renders
// inline with a working Back control (section state lives here — no
// navigator routes are added).
//
// Every row is either REAL (reads/writes real state or calls a real
// endpoint) or an honest greyed-out placeholder with its reason —
// nothing is omitted, nothing pretends to work.

type SectionId =
  | 'account'
  | 'display'
  | 'reactions'
  | 'feeds'
  | 'mutes'
  | 'import'
  | 'export'
  | 'filters'
  | 'language'

const SECTIONS: Array<{id: SectionId; title: string; hint: string}> = [
  {id: 'account', title: 'Your account', hint: 'Session info and sign out.'},
  {id: 'display', title: 'Accessibility and display', hint: 'Colour mode, text size, emoji art.'},
  {id: 'reactions', title: 'Reactions and emoji', hint: 'Like emoji and picker favourites.'},
  {id: 'feeds', title: 'Feeds', hint: 'Which Network tabs to show.'},
  {id: 'mutes', title: 'Mutes and blocks', hint: 'Words, servers, accounts.'},
  {id: 'import', title: 'Import', hint: 'Bring data in from files.'},
  {id: 'export', title: 'Export', hint: 'Take your data out.'},
  {id: 'filters', title: 'Word filters', hint: 'Server-side phrases.'},
  {id: 'language', title: 'Language', hint: 'The app language.'},
]

const TITLES: Record<SectionId, string> = {
  account: 'Your account',
  display: 'Accessibility and display',
  reactions: 'Reactions and emoji',
  feeds: 'Feeds',
  mutes: 'Mutes and blocks',
  import: 'Import',
  export: 'Export',
  filters: 'Word filters',
  language: 'Language',
}

export function SettingsScreen() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const [section, setSection] = useState<SectionId | null>(null)
  return (
    <ScrollView testID="settings-screen">
      <View style={[atoms.p_md, atoms.gap_md]}>
        {section === null ? (
          <>
            <Heading>Settings</Heading>
            {SECTIONS.map(s => (
              <Pressable
                key={s.id}
                testID={`settings-row-${s.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${s.title}. ${s.hint}`}
                onPress={() => setSection(s.id)}
                style={[atoms.gap_sm, {paddingVertical: 8}]}>
                <Body>{s.title}</Body>
                <Caption color="faint">{s.hint}</Caption>
              </Pressable>
            ))}
          </>
        ) : (
          <>
            <Heading>{TITLES[section]}</Heading>
            <Button
              label="Back"
              variant="secondary"
              onPress={() => setSection(null)}
              testID="settings-back"
            />
            {section === 'account' ? (
              <AccountSection onAddAccount={() => nav.navigate('Login')} />
            ) : section === 'display' ? (
              <DisplaySection />
            ) : section === 'reactions' ? (
              <ReactionsSection />
            ) : section === 'feeds' ? (
              <FeedsSection />
            ) : section === 'mutes' ? (
              <MutesSection />
            ) : section === 'import' ? (
              <ImportSection />
            ) : section === 'export' ? (
              <ExportSection />
            ) : section === 'filters' ? (
              <FiltersSection />
            ) : (
              <LanguageSection />
            )}
          </>
        )}
      </View>
    </ScrollView>
  )
}
