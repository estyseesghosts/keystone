import {View} from 'react-native'

import {atoms} from '#/alf/atoms'

import {PlaceholderRow} from './rows'

// Language section (v1 `/settings/language` parity): the app-wide
// language switch. Only English ships in this build (one empty `en`
// catalog; no carried locales, no runtime switch yet), so every locale
// renders as an honest placeholder — switching with nothing behind it
// would change nothing.

const LOCALES = [
  {code: 'en', name: 'English'},
  {code: 'fr', name: 'Français'},
  {code: 'de', name: 'Deutsch'},
  {code: 'zh-CN', name: '简体中文'},
  {code: 'zh-TW', name: '繁體中文'},
  {code: 'yue-HK', name: '廣東話'},
  {code: 'ja', name: '日本語'},
  {code: 'hi', name: 'हिन्दी'},
]

export function LanguageSection() {
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-language">
      {LOCALES.map(locale => (
        <PlaceholderRow
          key={locale.code}
          title={locale.name}
          hint={locale.code === 'en' ? 'Current language.' : undefined}
          reason={
            locale.code === 'en'
              ? 'Only English ships in this build.'
              : 'Not available yet — only English ships in this build.'
          }
          testID={`placeholder-locale-${locale.code}`}
        />
      ))}
    </View>
  )
}
