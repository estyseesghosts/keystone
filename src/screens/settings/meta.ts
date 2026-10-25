import {msg} from '@lingui/macro'
import type {I18n} from '@lingui/core'

import type {SettingsSection} from '#/routes'

// Index metadata for the Settings tree (v1
// `frontend/src/routes/Settings.tsx` parity). Titles match
// `titleForRoute` section titles in `#/routes` (identical source strings,
// so both share one catalog entry). Resolved at render time — module
// constants would freeze the boot locale (the locale switches at runtime).

export function settingsTitle(i18n: I18n, id: SettingsSection): string {
  switch (id) {
    case 'account':
      return i18n._(msg`Your account`)
    case 'display':
      return i18n._(msg`Accessibility and display`)
    case 'reactions':
      return i18n._(msg`Reactions and emoji`)
    case 'feeds':
      return i18n._(msg`Feeds`)
    case 'mutes':
      return i18n._(msg`Mutes and blocks`)
    case 'import':
      return i18n._(msg`Import`)
    case 'export':
      return i18n._(msg`Export`)
    case 'filters':
      return i18n._(msg`Word filters`)
    case 'language':
      return i18n._(msg`Language`)
  }
}

function settingsHint(i18n: I18n, id: SettingsSection): string {
  switch (id) {
    case 'account':
      return i18n._(msg`Session info and sign out.`)
    case 'display':
      return i18n._(msg`Colour mode, text size, emoji art.`)
    case 'reactions':
      return i18n._(msg`Like emoji and picker favourites.`)
    case 'feeds':
      return i18n._(msg`Which Network tabs to show.`)
    case 'mutes':
      return i18n._(msg`Words, servers, accounts.`)
    case 'import':
      return i18n._(msg`Bring data in from files.`)
    case 'export':
      return i18n._(msg`Take your data out.`)
    case 'filters':
      return i18n._(msg`Server-side phrases.`)
    case 'language':
      return i18n._(msg`The app language.`)
  }
}

const SETTINGS_ORDER: readonly SettingsSection[] = [
  'account',
  'display',
  'reactions',
  'feeds',
  'mutes',
  'import',
  'export',
  'filters',
  'language',
]

export function settingsMeta(i18n: I18n): Array<{id: SettingsSection; title: string; hint: string}> {
  return SETTINGS_ORDER.map(id => ({id, title: settingsTitle(i18n, id), hint: settingsHint(i18n, id)}))
}
