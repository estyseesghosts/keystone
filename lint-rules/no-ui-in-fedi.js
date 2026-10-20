/**
 * Boundary rule: `packages/fedi` is pure TypeScript.
 *
 * Forbids UI/framework imports (`react`, `react-native`, `expo*`, `#/`)
 * and browser globals (`window`, `document`, `localStorage`).
 * Applied to `packages/fedi/**` via `eslint.config.mjs`.
 *
 * Our own implementation of the plan §1.2 `no-ui-in-fedi` gate.
 * (Patterns from Bluesky's lint setup; code is ours — see ADR-0001.)
 */

const BANNED_IMPORT =
  /^(react(-dom)?($|\/)|react-native($|\/)|expo($|\/)|expo-|#\/)/

const BANNED_GLOBALS = new Set(['window', 'document', 'localStorage'])

function checkSource(context, value, node) {
  if (typeof value === 'string' && BANNED_IMPORT.test(value)) {
    context.report({node, messageId: 'noUiImport', data: {source: value}})
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'packages/fedi must stay pure TS: no UI/framework imports or browser globals',
    },
    messages: {
      noUiImport:
        'packages/fedi cannot import UI/framework module "{{source}}".',
      noBrowserGlobal:
        'packages/fedi cannot use browser global "{{name}}"; inject a seam instead.',
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
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'Literal'
        ) {
          checkSource(context, node.arguments[0].value, node.arguments[0])
        }
      },
      'Program:exit'(node) {
        const scope = context.sourceCode.getScope(node)
        for (const ref of scope.through) {
          if (BANNED_GLOBALS.has(ref.identifier.name)) {
            context.report({
              node: ref.identifier,
              messageId: 'noBrowserGlobal',
              data: {name: ref.identifier.name},
            })
          }
        }
      },
    }
  },
}
