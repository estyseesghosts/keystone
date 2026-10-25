const {RuleTester} = require('eslint')

const rule = require('../prefer-logical-style')

const tester = new RuleTester()

tester.run('prefer-logical-style', rule, {
  valid: [
    // Logical props pass everywhere.
    {
      code: `const s = {marginStart: 8, paddingEnd: 8}`,
      filename: 'src/components/Dialog.tsx',
    },
    {
      code: `const s = {borderStartWidth: 2, borderEndColor: 'red'}`,
      filename: 'src/components/Post/PostQuote.tsx',
    },
    {
      code: `const s = {start: 0, end: 0}`,
      filename: 'src/components/ToastHost.tsx',
    },
    // Bare left/right is viewport geometry / system insets, not layout
    // direction — never flagged.
    {
      code: `const pos = {left: pos.left, top: pos.top}`,
      filename: 'src/components/Popup.tsx',
    },
    {
      code: `const insets = {top: 0, bottom: 0, left: 0, right: 0}`,
      filename: 'src/components/insets.ts',
    },
    {
      code: `const p = {hitSlop: {top: 10, bottom: 10, left: 8, right: 8}}`,
      filename: 'src/components/Post/ActionBar.tsx',
    },
    // Non-style object keys with the same spelling are out of scope.
    {
      code: `const anchor = {left: rect.left, right: rect.right}`,
      filename: 'src/components/Profile/HoverPreview.tsx',
    },
  ],
  invalid: [
    {
      code: `const s = {marginLeft: 8}`,
      filename: 'src/components/Composer/CompactComposer.tsx',
      errors: [{messageId: 'preferLogical'}],
      output: `const s = {marginStart: 8}`,
    },
    {
      code: `const s = {paddingRight: insets.right}`,
      filename: 'src/components/shell/TabBar.tsx',
      errors: [{messageId: 'preferLogical'}],
      output: `const s = {paddingEnd: insets.right}`,
    },
    {
      code: `const s = {borderLeftWidth: 2, borderLeftColor: edge}`,
      filename: 'src/components/RichText.tsx',
      errors: [{messageId: 'preferLogical'}, {messageId: 'preferLogical'}],
      output: `const s = {borderStartWidth: 2, borderStartColor: edge}`,
    },
    {
      code: `const s = {borderRightWidth: 1}`,
      filename: 'src/components/shell/Sidebar.tsx',
      errors: [{messageId: 'preferLogical'}],
      output: `const s = {borderEndWidth: 1}`,
    },
  ],
})
