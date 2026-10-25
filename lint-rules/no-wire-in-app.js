/**
 * Boundary rule: the app (`src/`) sees only `packages/fedi` domain models.
 *
 * Forbids importing server wire modules from `src/`: any `wire` PATH
 * SEGMENT counts, not just a trailing `wire` — `@keystone/fedi/misskey/wire`,
 * `…/mastodon/wire/client`, `./wire`, and deep file imports under a wire
 * dir are all wire seams. ALSO forbids deep package imports
 * (`@keystone/fedi/<subpath>`) into backend internals: anything under
 * `mastodon/` or `misskey/`, `core/http` itself, and any `wire`/`client`/
 * `adapt`/`endpoints` basename. Import domain models from `@keystone/fedi`
 * instead. Applied to `src/**` via `eslint.config.mjs`.
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

// Deep package imports: the barrel (`@keystone/fedi`) is the only public
// surface. Backend family dirs and transport basenames are internals even
// when a file is not literally under a `wire/` dir.
const FEDI_PREFIX = '@keystone/fedi/'
const RESTRICTED_ROOTS = new Set(['mastodon', 'misskey'])
const RESTRICTED_CORE = 'core/http'
const RESTRICTED_BASENAMES = new Set(['wire', 'client', 'adapt', 'endpoints'])

function checkDeepImport(context, value, node) {
  if (typeof value !== 'string' || !value.startsWith(FEDI_PREFIX)) return
  const sub = value.slice(FEDI_PREFIX.length)
  if (sub.length === 0) return
  const segments = sub.split('/')
  const root = segments[0]
  const base = segments[segments.length - 1]
  if (
    RESTRICTED_ROOTS.has(root) ||
    sub === RESTRICTED_CORE ||
    sub.startsWith(`${RESTRICTED_CORE}/`) ||
    RESTRICTED_BASENAMES.has(base)
  ) {
    context.report({node, messageId: 'noDeepImport', data: {source: value}})
  }
}

function checkSource(context, value, node) {
  if (typeof value === 'string' && WIRE_SEGMENT.test(value)) {
    context.report({node, messageId: 'noWireImport', data: {source: value}})
    return
  }
  checkDeepImport(context, value, node)
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
      noDeepImport:
        'src/ cannot deep-import fedi internals "{{source}}"; use domain models from @keystone/fedi.',
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
