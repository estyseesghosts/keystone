import type {SettingsSection} from '#/routes'

// Index metadata for the Settings tree (v1
// `frontend/src/routes/Settings.tsx` parity). Titles match
// `titleForRoute` section titles in `#/routes`.
export const SETTINGS_META: Array<{id: SettingsSection; title: string; hint: string}> = [
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

export const SETTINGS_TITLES: Record<SettingsSection, string> = {
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
