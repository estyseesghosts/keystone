import {defineConfig} from '@lingui/cli'

// Minimal catalog config. Only `en` for the scaffold; the 8 Keystone
// locales land via the translation-import script (plan slice 6.x).
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en'],
  catalogs: [
    {
      path: '<rootDir>/src/locale/locales/{locale}/messages',
      include: ['src'],
    },
  ],
  compileNamespace: 'ts',
})
