/**
 * Boundary rule: the app (`src/`) sees only `packages/fedi` domain models.
 *
 * Forbids importing server wire modules from `src/`: any `wire` PATH
 * SEGMENT counts, not just a trailing `wire` — `@keystone/fedi/misskey/wire`,
 * `…/mastodon/wire/client`, `./wire`, and deep file imports under a wire
 * dir are all wire seams. Import domain models from `@keystone/fedi` instead.
 * Applied to `src/**` via `eslint.config.mjs`.
 *
 * Our own implementation of the plan §1.2 `no-wire-in-app` gate.
 * (Patterns from Bluesky's lint setup; code is ours — see ADR-0001.)
 */

// `wire` as a full path segment: trailing (`…/wire`), leading into deeper
// files (`wire/client`, `wire/foo/bar`), or the whole specifier (`wire`).
// Deliberately NOT substring matching: `wireless`, `fedi-wire`, `mywire`
// never match (the char after `wire` must be `/` or end-of-string, and the
// char before must be `/` or start-of-string).
const WIRE_SEGMENT = /(^|\/)wire(\/|$)/

function checkSource(context, value, node) {
  if (typeof value === 'string' && WIRE_SEGMENT.test(value)) {
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
