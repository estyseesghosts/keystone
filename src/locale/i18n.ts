import {i18n} from '@lingui/core'

// Minimal catalog setup. Only `en` ships in the scaffold; the carried
// Keystone locales land via the translation-import script (plan 6.x).
// Keep all user-visible strings behind Lingui macros from day one so
// extraction later is mechanical.
i18n.load('en', {})
i18n.activate('en')

export {i18n}
