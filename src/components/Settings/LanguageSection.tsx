import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {
  SUPPORTED_LOCALES,
  localeStore,
  setLocale,
  useLocale,
  type LocaleCode,
  type LocaleStore,
} from '#/locale/i18n'

// Language section (v1 `/settings/language` parity): the app-wide
// language switch. Every carried locale switches at runtime — the store
// persists the code and re-activates the Lingui catalog, and the root
// `I18nProvider` re-renders on activation. Native names are proper nouns
// (never translated); only the "current" hint is UI chrome.

const DOT_SIZE = 8

export function LanguageSection({store = localeStore}: {store?: LocaleStore}) {
  const selected = useLocale(store)
  const theme = useTheme()
  const {i18n} = useLingui()
  const currentHint = i18n._(msg`Current language.`)
  const groupLabel = i18n._(msg`Language`)
  return (
    <View
      style={[atoms.gap_sm]}
      testID="settings-section-language"
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}>
      {SUPPORTED_LOCALES.map(locale => (
        <LocaleRow
          key={locale.code}
          code={locale.code}
          name={locale.nativeName}
          active={selected === locale.code}
          currentHint={currentHint}
          onSelect={() => setLocale(locale.code as LocaleCode, store)}
          dotColor={theme.palette.text}
        />
      ))}
    </View>
  )
}

function LocaleRow({
  code,
  name,
  active,
  currentHint,
  onSelect,
  dotColor,
}: {
  code: string
  name: string
  active: boolean
  currentHint: string
  onSelect: () => void
  dotColor: string
}) {
  return (
    <Pressable
      testID={`locale-${code}`}
      accessibilityRole="radio"
      accessibilityState={{selected: active}}
      accessibilityLabel={active ? `${name}, ${currentHint}` : name}
      onPress={onSelect}
      style={[atoms.row, atoms.itemsCenter, {gap: 12, paddingVertical: 8}]}>
      <View
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: active ? dotColor : 'transparent',
        }}
      />
      <View style={[atoms.flex1, atoms.gap_sm]}>
        <Body>{name}</Body>
        {active ? <Caption color="faint">{currentHint}</Caption> : null}
      </View>
    </Pressable>
  )
}
