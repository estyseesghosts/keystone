// Flat config: base style via oxlint (`pnpm lint` runs that first);
// this file enforces only our own boundary rules (see lint-rules/).
import tsParser from '@typescript-eslint/parser'

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
    files: ['packages/fedi/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {ecmaFeatures: {jsx: false}},
      globals: {...jestGlobals},
    },
    plugins: {keystone},
    rules: {'keystone/no-ui-in-fedi': 'error'},
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {ecmaFeatures: {jsx: true}},
    },
    plugins: {keystone},
    rules: {'keystone/no-wire-in-app': 'error'},
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
