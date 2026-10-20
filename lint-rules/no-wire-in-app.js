/**
 * Boundary rule: the app (`src/`) sees only `packages/fedi` domain models.
 *
 * Forbids importing server wire modules (paths ending in `wire`) from `src/`.
 * Import domain models from `@keystone/fedi` instead.
 * Applied to `src/**` via `eslint.config.mjs`.
 *
 * Our own implementation of the plan §1.2 `no-wire-in-app` gate.
 * (Patterns from Bluesky's lint setup; code is ours — see ADR-0001.)
 */

const WIRE_MODULE = /(^|\/)wire$/

function checkSource(context, value, node) {
  if (typeof value === 'string' && WIRE_MODULE.test(value)) {
    context.report({node, messageId: 'noWireImport', data: {source: value}})
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'src/ must not import fedi wire modules; use domain models from @keystone/fedi',
    },
    messages: {
      noWireImport:
        'src/ cannot import wire module "{{source}}"; use domain models from @keystone/fedi.',
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
    }
  },
}
