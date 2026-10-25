const {RuleTester} = require('eslint')

const rule = require('../no-literal-ui-string')

const tester = new RuleTester()

// Fixtures always pass an explicit empty baseline so they exercise the raw
// detector, never the checked-in grandfather counts.
const fresh = (code, filename) => ({
  code,
  filename,
  options: [{baseline: {}}],
  languageOptions: {parserOptions: {ecmaFeatures: {jsx: true}}},
})

const withBaseline = (code, filename, baseline) => ({
  code,
  filename,
  options: [{baseline}],
  languageOptions: {parserOptions: {ecmaFeatures: {jsx: true}}},
})

// New UI strings go through Lingui (`msg` / `t` / `Trans` / `plural`); raw
// literals are the Wave 9 burn-down, grandfathered per file in
// `lint-rules/baselines/no-literal-ui-string.json`.
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
    // At or below the grandfathered count, the file passes silently.
    withBaseline(
      `<Text>Hello</Text>`,
      'src/components/Old.tsx',
      {'src/components/Old.tsx': 1},
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
      // Above the grandfathered count, every violation reports.
      ...withBaseline(
        `<Text>One</Text>; showToast('Two')`,
        'src/components/Old.tsx',
        {'src/components/Old.tsx': 1},
      ),
      errors: [{messageId: 'noLiteralJsxText'}, {messageId: 'noLiteralCallArg'}],
    },
    {
      // A file with no baseline entry fails on any violation.
      ...withBaseline(`<Text>Hello</Text>`, 'src/components/New.tsx', {}),
      errors: [{messageId: 'noLiteralJsxText'}],
    },
  ],
})
