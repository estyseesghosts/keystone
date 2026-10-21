import {defineConfig} from '@lingui/cli'

// Catalog config: the 8 Keystone locales (plan slices 5.x/6.x). `en` is
// the source; the 7 carried locales seed from the v1 reference dicts.
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'fr', 'de', 'zh-CN', 'zh-TW', 'yue-HK', 'ja', 'hi'],
  catalogs: [
    {
      path: '<rootDir>/src/locale/locales/{locale}/messages',
      include: ['src'],
    },
  ],
  compileNamespace: 'ts',
})
