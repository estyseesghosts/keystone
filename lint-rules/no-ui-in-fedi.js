/**
 * Boundary rule: `packages/fedi` is pure TypeScript.
 *
 * Forbids UI/framework imports by package-name prefix — `react`/`react-dom`,
 * `react-native` and suffixed variants, `@react-native/` scoped packages,
 * `expo` and suffixed variants, `@expo/` scoped packages, `@tanstack/`
 * scoped packages, and `#/` —
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
 * 2. `SEAM_ALLOWLIST` below grandfathers exactly the modules that ARE the
 *    platform edge: `core/http` owns the single lazy `fetch` default every
 *    other transport falls back to, and the two stream transports construct
 *    sockets from the platform `WebSocket`. Re-plumbing every other
 *    transport through an injected seam (`fetchImpl` threading) is done —
 *    every other fedi file, and every new file, stays banned. Do not extend
 *    this list without that re-plumb.
 *
 * Our own implementation of the plan §1.2 `no-ui-in-fedi` gate.
 * (Patterns from Bluesky's lint setup; code is ours — see ADR-0001.)
 */

const BANNED_IMPORT = [
  // The React runtime itself has no place in the data layer.
  /^react($|[/-])/,
  /^react-dom($|[/-])/,
  // `react-native`, its subpaths, and the `react-native-*` ecosystem
  // (e.g. `react-native-mmkv`).
  /^react-native($|[/-])/,
  // `@react-native/*` and `@react-native-*/*` (e.g.
  // `@react-native-async-storage/async-storage`).
  /^@react-native([/-])/,
  // `expo`, `expo/*`, `expo-*`, and `@expo/*` (e.g. `@expo/vector-icons`).
  /^expo($|[/-])/,
  /^@expo\//,
  // `@tanstack/*` (e.g. `@tanstack/react-query`).
  /^@tanstack\//,
  // The app alias never resolves inside the package.
  /^#\//,
]

const BANNED_GLOBALS = new Set([
  'window',
  'document',
  'localStorage',
  'globalThis',
  'navigator',
  'self',
  'fetch',
])

// The platform edge. `core/http` owns the single lazy `fetch` default
// (`defaultFetchImpl`) every other transport falls back to — the default is
// resolved at call time, never bound at module load, so test doubles keep
// working. The two stream transports construct sockets from the platform
// `WebSocket` (their `wsImpl` / `wsFactory` seams are injected in tests;
// moving the production socket construction out would touch the backend
// factories and live-server behavior — left as the documented remainder).
// Each entry names ONLY the identifier that module may use; anything else
// (e.g. `navigator` in these files) still reports. Suffix-matched against
// the linted filename. Do not extend this list: new code injects a seam.
const SEAM_ALLOWLIST = new Map([
  ['core/http.ts', new Set(['fetch'])],
  ['misskey/stream.ts', new Set(['globalThis'])],
  ['mastodon/stream.ts', new Set(['globalThis'])],
])

function checkSource(context, value, node) {
  if (
    typeof value === 'string' &&
    BANNED_IMPORT.some(re => re.test(value))
  ) {
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
