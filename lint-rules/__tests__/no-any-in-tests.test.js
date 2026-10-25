const {RuleTester} = require('eslint')
const tsParser = require('@typescript-eslint/parser')

const rule = require('../no-any-in-tests')

const tester = new RuleTester()

const ts = {parser: tsParser}

// X11.2: `as any` is grandfathered per file (12 total across 7 files) and
// forbidden everywhere else in tests. Factories replace casts; the baseline
// only ever moves down.
tester.run('no-any-in-tests', rule, {
  valid: [
    // Narrower casts are fine.
    {
      code: `const x = value as unknown as Post`,
      filename: 'src/state/queries/composer.test.tsx',
      languageOptions: ts,
    },
    {
      code: `const x = 1 as const`,
      filename: 'src/state/queries/composer.test.tsx',
      languageOptions: ts,
    },
    // Not a test file: the rule does not apply.
    {
      code: `const x = value as any`,
      filename: 'src/state/queries/composer.ts',
      languageOptions: ts,
    },
    {
      code: `function render(props: any) { return props }`,
      filename: 'src/components/Button.tsx',
      languageOptions: ts,
    },
    // At the baseline: Settings.test.tsx is allowed 1.
    {
      code: `const x = value as any`,
      filename: 'src/screens/Settings.test.tsx',
      languageOptions: ts,
    },
    // Helpers under __tests__/ count as tests too, but clean ones pass.
    {
      code: `export const x = makePost()`,
      filename: 'src/__tests__/factories.ts',
      languageOptions: ts,
    },
  ],
  invalid: [
    // A new test file has an allowance of zero.
    {
      code: `const x = value as any`,
      filename: 'src/screens/NewThing.test.tsx',
      languageOptions: ts,
      errors: [{messageId: 'noAnyInTests'}],
    },
    // One over the baseline: the second occurrence is reported.
    {
      code: `const a = x as any\nconst b = y as any`,
      filename: 'src/screens/Settings.test.tsx',
      languageOptions: ts,
      errors: [{messageId: 'noAnyInTests'}],
    },
    // Angle-bracket assertions are covered too (fedi .ts tests).
    {
      code: `const x = <any>value`,
      filename: 'packages/fedi/test/sample.test.ts',
      languageOptions: ts,
      errors: [{messageId: 'noAnyInTests'}],
    },
    // Unlisted test helper with a fresh `as any`.
    {
      code: `const x = value as any`,
      filename: 'packages/fedi/test/helpers.ts',
      languageOptions: ts,
      errors: [{messageId: 'noAnyInTests'}],
    },
  ],
})
