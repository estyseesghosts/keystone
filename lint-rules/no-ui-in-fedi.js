/**
 * Boundary rule: `packages/fedi` is pure TypeScript.
 *
 * Forbids UI/framework imports (`react`, `react-native`, `expo*`, `#/`)
 * and browser globals (`window`, `document`, `localStorage`, plus the
 * `globalThis` / `navigator` / `self` / `fetch` seams a future contributor
 * would reach for instead of injecting a dependency) in shipped fedi code.
 * Applied to `packages/fedi/**` via `eslint.config.mjs`.
 *
 * Two deliberate narrowings (D3.8 — not weakenings, each documented where
 * it applies):
 *
 * 1. `*.test.ts` files are exempt from the GLOBALS check (import checks
 *    still apply). Tests construct the injected seam: `globalThis.fetch`
 *    mocks, `WebSocket` stubs, `DOMException` deletion probes. The ban
 *    targets shipped code.
 * 2. `SEAM_ALLOWLIST` below grandfathers the modules that ARE the
 *    transport today (they call platform `fetch` / read
 *    `globalThis.WebSocket` directly). Re-plumbing them through an
 *    injected seam (`fetchImpl` / `wsFactory` threading) is follow-up
 *    work, not D3.8 — every other fedi file, and every new file, stays
 *    banned. Do not extend this list without that re-plumb.
 *
 * Our own implementation of the plan §1.2 `no-ui-in-fedi` gate.
 * (Patterns from Bluesky's lint setup; code is ours — see ADR-0001.)
 */

const BANNED_IMPORT =
  /^(react(-dom)?($|\/)|react-native($|\/)|expo($|\/)|expo-|#\/)/

const BANNED_GLOBALS = new Set([
  'window',
  'document',
  'localStorage',
  'globalThis',
  'navigator',
  'self',
  'fetch',
])

// Transport modules that predate the ban and call the platform directly.
// Each entry names ONLY the identifier that module may use; anything else
// (e.g. `navigator` in these files) still reports. Suffix-matched against
// the linted filename.
//
// Two shapes, both grandfathered (D3.8):
// - direct platform calls (`http`, `detect`, `config`, the two `client`
//   transports, `external`, `remotepost`, `customEmoji`, the two stream
//   transports): re-plumbing them through an injected seam is follow-up
//   work — the ban keeps every other fedi file, and every new file, off
//   these globals.
// - injectable-seam defaults (`api/composer`, `api/linkpreview`,
//   `core/sessions`): these already take a `fetchImpl` the tests stub;
//   only the production default is the platform global. Same follow-up
//   (make the default flow from one place), same rule: do not extend this
//   list without that re-plumb.
const SEAM_ALLOWLIST = new Map([
  ['core/http.ts', new Set(['fetch'])],
  ['core/detect.ts', new Set(['fetch'])],
  ['core/config.ts', new Set(['fetch'])],
  ['core/sessions.ts', new Set(['fetch'])],
  ['api/composer.ts', new Set(['fetch'])],
  ['api/linkpreview.ts', new Set(['fetch'])],
  ['misskey/client.ts', new Set(['fetch'])],
  ['mastodon/client.ts', new Set(['fetch'])],
  ['misskey/external.ts', new Set(['fetch'])],
  ['misskey/remotepost.ts', new Set(['fetch'])],
  ['misskey/customEmoji.ts', new Set(['fetch'])],
  ['misskey/stream.ts', new Set(['globalThis'])],
  ['mastodon/stream.ts', new Set(['globalThis'])],
])

function checkSource(context, value, node) {
  if (typeof value === 'string' && BANNED_IMPORT.test(value)) {
    context.report({node, messageId: 'noUiImport', data: {source: value}})
  }
}

function lintedFilename(context) {
  if (typeof context.filename === 'string') return context.filename
  if (typeof context.getFilename === 'function') return context.getFilename()
  return ''
}

function isTestFile(filename) {
  return /\.test\.tsx?$/.test(filename)
}

function allowedInFile(name, filename) {
  for (const [suffix, names] of SEAM_ALLOWLIST) {
    if (filename.endsWith(suffix) && names.has(name)) return true
  }
  return false
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
        // Tests build the seam (fetch mocks, WebSocket stubs) — the ban
        // targets shipped code. Import checks above still apply to tests.
        const filename = lintedFilename(context)
        if (isTestFile(filename)) return
        const globalScope = context.sourceCode.getScope(node)
        // Unresolved names land in `through`; names the environment
        // declares (notably `globalThis` in modern parsers) resolve to the
        // global scope's variables instead — collect both, never double:
        // a reference is either resolved or unresolved, not both.
        const refs = [...globalScope.through]
        for (const variable of globalScope.variables) {
          if (BANNED_GLOBALS.has(variable.name)) refs.push(...variable.references)
        }
        for (const ref of refs) {
          if (ref.identifier && BANNED_GLOBALS.has(ref.identifier.name) && !allowedInFile(ref.identifier.name, filename)) {
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
