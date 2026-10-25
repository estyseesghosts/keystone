const {RuleTester} = require('eslint')

const rule = require('../no-inner-html')

const tester = new RuleTester()

// Server content renders through the content AST + RichText — never through
// a raw-HTML sink, never compiled from a string, never in a WebView.
tester.run('no-inner-html', rule, {
  valid: [
    {
      code: `el.textContent = value`,
      filename: 'src/components/RichText.tsx',
    },
    {
      code: `const html = astToHtml(node)`,
      filename: 'packages/fedi/src/core/content/ast.ts',
    },
    {
      code: `import {StyleSheet} from 'react-native'`,
      filename: 'src/components/Post.tsx',
    },
    {
      code: `stream.write(chunk)`,
      filename: 'packages/fedi/src/core/http.ts',
    },
    {
      code: `const f = new Foo(bar)`,
      filename: 'src/state/queries/feed.ts',
    },
  ],
  invalid: [
    {
      code: `el.innerHTML = html`,
      filename: 'src/components/RichText.tsx',
      errors: [{messageId: 'noUnsafeDom'}],
    },
    {
      code: `const h = el.outerHTML`,
      filename: 'packages/fedi/src/core/content/ast.ts',
      errors: [{messageId: 'noUnsafeDom'}],
    },
    {
      code: `el.insertAdjacentHTML('beforeend', html)`,
      filename: 'src/components/Post.tsx',
      errors: [{messageId: 'noUnsafeDom'}],
    },
    {
      code: `<div dangerouslySetInnerHTML={{__html: html}} />`,
      filename: 'src/components/RichText.tsx',
      languageOptions: {parserOptions: {ecmaFeatures: {jsx: true}}},
      errors: [{messageId: 'noUnsafeDom'}],
    },
    {
      code: `React.createElement('div', {dangerouslySetInnerHTML: {__html: html}})`,
      filename: 'src/components/RichText.tsx',
      errors: [{messageId: 'noUnsafeDom'}],
    },
    {
      code: `document.write(html)`,
      filename: 'src/components/Post.tsx',
      errors: [{messageId: 'noUnsafeDom'}],
    },
    {
      code: `const fn = eval(source)`,
      filename: 'packages/fedi/src/core/content/parse.ts',
      errors: [{messageId: 'noDynamicCode'}],
    },
    {
      code: `const fn = new Function('a', body)`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noDynamicCode'}],
    },
    {
      code: `import {WebView} from 'react-native-webview'`,
      filename: 'src/components/Post.tsx',
      errors: [{messageId: 'noWebViewImport'}],
    },
    {
      code: `const W = await import('react-native-webview/lib/WebView')`,
      filename: 'src/components/Post.tsx',
      errors: [{messageId: 'noWebViewImport'}],
    },
  ],
})
