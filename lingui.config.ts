import {defineConfig} from '@lingui/cli'

// Catalog config: the 8 Keystone locales (plan slices 5.x/6.x). `en` is
// the source; the 7 carried locales seed from the v1 reference dicts.
// `pseudo` is the dev-only pseudo-locale (X0.2 ratchet aid): it is never
// shipped or translated, and Lingui excludes it from translation IO. It
// appears only here (so `lingui compile` can generate its catalog), never
// in `SUPPORTED_LOCALES` in `src/locale/i18n.ts`.
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'fr', 'de', 'zh-CN', 'zh-TW', 'yue-HK', 'ja', 'hi', 'pseudo'],
  pseudoLocale: 'pseudo',
  catalogs: [
    {
      path: '<rootDir>/src/locale/locales/{locale}/messages',
      include: ['src'],
    },
  ],
  compileNamespace: 'ts',
})
