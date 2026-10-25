// Flat config: base style via oxlint (`pnpm lint` runs that first);
// this file enforces only our own boundary rules (see lint-rules/).
import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

import keystone from './lint-rules/index.js'

const nodeGlobals = {
  require: 'readonly',
  module: 'readonly',
  __dirname: 'readonly',
  process: 'readonly',
}

const jestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
}

export default [
  {
    files: ['packages/fedi/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {ecmaFeatures: {jsx: false}},
      globals: {...jestGlobals},
    },
    plugins: {keystone},
    rules: {
      'keystone/no-ui-in-fedi': 'error',
      'keystone/no-inner-html': 'error',
      'keystone/no-any-in-tests': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {ecmaFeatures: {jsx: true}},
    },
    plugins: {keystone, 'react-hooks': reactHooks},
    rules: {
      'keystone/no-wire-in-app': 'error',
      'keystone/no-hardcoded-color': 'error',
      'keystone/query-key-session-first': 'error',
      'keystone/no-inner-html': 'error',
      'keystone/no-literal-ui-string': 'error',
      // X11.2 test quality: no new `as any` in tests (12 grandfathered).
      'keystone/no-any-in-tests': 'error',
      // X9.6 RTL: logical start/end props only (tree converted, clean).
      'keystone/prefer-logical-style': 'error',
      // Promoted to error by X8.4 (cleanup pass landed, warning set is empty).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {ecmaFeatures: {jsx: false}},
      globals: {...nodeGlobals},
    },
  },
  {
    files: ['lint-rules/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {...nodeGlobals, ...jestGlobals},
    },
  },
  {
    // Generated Lingui catalogs: no lint signal, never hand-edited.
    ignores: ['src/locale/locales/**'],
  },
]
