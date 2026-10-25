/**
 * Safety rule: no raw-HTML sinks or dynamic-code compilation in `src/` or
 * `packages/`.
 *
 * Server content is parsed to the allow-listed AST in
 * `packages/fedi/src/core/content` and rendered by the single `RichText`
 * component — never via `innerHTML`, never in a WebView. This rule pins
 * that: it bans `innerHTML` / `outerHTML` / `insertAdjacentHTML` /
 * `dangerouslySetInnerHTML` / `document.write`, `eval` / `new Function`,
 * and `react-native-webview` imports. Applies to `src/**` and
 * `packages/fedi/**` via `eslint.config.mjs`.
 */

const BANNED_MEMBERS = new Set([
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
])
const BANNED_WEBVIEW = /^react-native-webview($|\/)/

function checkSource(context, value, node) {
  if (typeof value === 'string' && BANNED_WEBVIEW.test(value)) {
    context.report({node, messageId: 'noWebViewImport', data: {source: value}})
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'no raw-HTML sinks, document.write, eval/new Function, or react-native-webview imports',
    },
    messages: {
      noUnsafeDom:
        'Raw-HTML sink "{{name}}" is banned; render server content through the content AST + RichText.',
      noDynamicCode:
        '"{{name}}" compiles strings to code and is banned; use a static import or a lookup table.',
      noWebViewImport:
        '"{{source}}" is banned; render server content through the content AST + RichText.',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        checkSource(context, node.source.value, node.source)
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkSource(context, node.source.value, node.source)
        }
      },
      ExportAllDeclaration(node) {
        checkSource(context, node.source.value, node.source)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') {
          checkSource(context, node.source.value, node.source)
        }
      },
      MemberExpression(node) {
        if (
          !node.computed &&
          node.property.type === 'Identifier' &&
          BANNED_MEMBERS.has(node.property.name)
        ) {
          context.report({
            node: node.property,
            messageId: 'noUnsafeDom',
            data: {name: node.property.name},
          })
        }
      },
      JSXAttribute(node) {
        if (
          node.name.type === 'JSXIdentifier' &&
          node.name.name === 'dangerouslySetInnerHTML'
        ) {
          context.report({
            node: node.name,
            messageId: 'noUnsafeDom',
            data: {name: 'dangerouslySetInnerHTML'},
          })
        }
      },
      Property(node) {
        // `React.createElement('div', {dangerouslySetInnerHTML: ...})`.
        const name =
          !node.computed && node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal'
              ? node.key.value
              : null
        if (name === 'dangerouslySetInnerHTML') {
          context.report({
            node: node.key,
            messageId: 'noUnsafeDom',
            data: {name: 'dangerouslySetInnerHTML'},
          })
        }
      },
      CallExpression(node) {
        const callee = node.callee
        if (callee.type === 'Identifier' && callee.name === 'eval') {
          context.report({
            node: callee,
            messageId: 'noDynamicCode',
            data: {name: 'eval'},
          })
          return
        }
        if (
          callee.type === 'Identifier' &&
          callee.name === 'require' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'Literal'
        ) {
          checkSource(context, node.arguments[0].value, node.arguments[0])
          return
        }
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'document' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'write'
        ) {
          context.report({
            node: callee.property,
            messageId: 'noUnsafeDom',
            data: {name: 'document.write'},
          })
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Function') {
          context.report({
            node: node.callee,
            messageId: 'noDynamicCode',
            data: {name: 'new Function'},
          })
        }
      },
    }
  },
}
