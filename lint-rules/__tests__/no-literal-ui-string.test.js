const {RuleTester} = require('eslint')

const rule = require('../no-literal-ui-string')

const tester = new RuleTester()

// Plain error since X9.8 (the Wave 9 baseline burned to zero and the
// baseline mechanism was deleted): every violation reports, no options.
const fresh = (code, filename) => ({
  code,
  filename,
  languageOptions: {parserOptions: {ecmaFeatures: {jsx: true}}},
})

// New UI strings go through Lingui (`msg` / `t` / `Trans` / `plural`); raw
// literals fail. The pseudo-locale smoke test
// (`src/locale/pseudo-locale-smoke.test.tsx`) covers the paths this rule
// cannot see (`setError` / `errorText` fallbacks).
tester.run('no-literal-ui-string', rule, {
  valid: [
    fresh(`const s = theme.palette.bg`, 'src/components/Clean.ts'),
    fresh(`<Trans>Hello</Trans>`, 'src/components/Clean.tsx'),
    fresh(
      `import {Trans} from '@lingui/macro'; <Trans><Text>Hello</Text></Trans>`,
      'src/components/Clean.tsx',
    ),
    // Whitespace, digits, and pure punctuation/glyph text are not words.
    fresh(`<Text>123</Text>`, 'src/components/Clean.tsx'),
    fresh(`<Text>· / | … —</Text>`, 'src/components/Clean.tsx'),
    fresh(`<Text>&middot;</Text>`, 'src/components/Clean.tsx'),
    fresh(`<Text>{' '}</Text>`, 'src/components/Clean.tsx'),
    // Lingui-wrapped props and non-speakable props stay quiet.
    fresh(
      'import {t} from "@lingui/macro"; <Input placeholder={t`Search`} />',
      'src/components/Clean.tsx',
    ),
    fresh(`<View testID="header" />`, 'src/components/Clean.tsx'),
    fresh(`<Icon name="chevron-right" />`, 'src/components/Clean.tsx'),
    fresh(
      `<Link title="https://example.com/x" />`,
      'src/components/Clean.tsx',
    ),
    fresh(`<Input placeholder="" />`, 'src/components/Clean.tsx'),
    // i18n calls, enum comparisons, and excluded files are out of scope.
    fresh(
      `plural(n, {one: 'book', other: 'books'})`,
      'src/components/Clean.ts',
    ),
    fresh(`i18n._({id: 'k', message: 'Hi'})`, 'src/components/Clean.ts'),
    fresh('showToast(t`Done`)', 'src/components/Clean.ts'),
    fresh(
      `if (status === 'active') { run() }`,
      'src/components/Clean.tsx',
    ),
    fresh(`<Text>Hello</Text>`, 'src/components/Clean.test.tsx'),
    fresh(`<Text>Hello</Text>`, 'src/__tests__/helper.tsx'),
    fresh(
      `export const m = {hello: 'Hello'}`,
      'src/locale/locales/en/custom.ts',
    ),
  ],
  invalid: [
    {
      // Acceptance probe: a literal in a clean file must fail lint.
      ...fresh(`<Text>Hello</Text>`, 'src/components/Clean.tsx'),
      errors: [{messageId: 'noLiteralJsxText'}],
    },
    {
      ...fresh(`<Text>{'Hello'}</Text>`, 'src/components/Clean.tsx'),
      errors: [{messageId: 'noLiteralJsxText'}],
    },
    {
      ...fresh(
        `<Input placeholder="Search" />`,
        'src/components/Clean.tsx',
      ),
      errors: [{messageId: 'noLiteralProp'}],
    },
    {
      ...fresh(`<Btn aria-label="Close" />`, 'src/components/Clean.tsx'),
      errors: [{messageId: 'noLiteralProp'}],
    },
    {
      ...fresh(
        `<Text accessibilityHint="Double tap" />`,
        'src/components/Clean.tsx',
      ),
      errors: [{messageId: 'noLiteralProp'}],
    },
    {
      ...fresh(`<Input label={\`Name for \${kind}\`} />`, 'src/components/Clean.tsx'),
      errors: [{messageId: 'noLiteralProp'}],
    },
    {
      ...fresh(`showToast('Saved')`, 'src/components/Clean.ts'),
      errors: [{messageId: 'noLiteralCallArg'}],
    },
    {
      ...fresh(`Alert.alert('Title', 'Body')`, 'src/components/Clean.ts'),
      errors: [{messageId: 'noLiteralCallArg'}],
    },
    {
      ...fresh(`confirm('Delete?')`, 'src/components/Clean.ts'),
      errors: [{messageId: 'noLiteralCallArg'}],
    },
    {
      ...fresh('showToast(`Failed: ${code}`)', 'src/components/Clean.ts'),
      errors: [{messageId: 'noLiteralCallArg'}],
    },
    {
      // No grandfathering: a second violation in the same file reports too.
      ...fresh(
        `<Text>One</Text>; showToast('Two')`,
        'src/components/Old.tsx',
      ),
      errors: [{messageId: 'noLiteralJsxText'}, {messageId: 'noLiteralCallArg'}],
    },
    {
      // A formerly grandfathered file fails on any violation now.
      ...fresh(`<Text>Hello</Text>`, 'src/components/Old.tsx'),
      errors: [{messageId: 'noLiteralJsxText'}],
    },
  ],
})
