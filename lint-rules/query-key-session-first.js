/**
 * Boundary rule: every TanStack query key in `src/` starts with the session id.
 *
 * Multi-account correctness depends on it: keys are `[sessionId, ...]`, so
 * switching accounts can never serve the previous account's cached data
 * (sessions-cache audit). This rule pins the convention:
 *
 * - A `queryKey:` property whose value is an ARRAY LITERAL must start with
 *   a session expression — an identifier, member, call, `??` fallback, or
 *   anything else that is not a hard-coded literal. This covers the keys
 *   passed to `useQuery`/`useInfiniteQuery` (their key arrives via the
 *   options object's `queryKey:` property).
 * - A direct array-literal key passed to `setQueryData` / `invalidateQueries`
 *   must start the same way.
 * - The `'signed-out'` scope is allowed ONLY via `createQueryKey` (or one of
 *   the `*QueryKey` builders, which all funnel through it) — never as a
 *   hand-rolled `['kind', 'signed-out']` literal.
 *
 * Deliberately NOT flagged (left to the builder convention):
 * identifiers, member expressions, builder calls, and conditionals such as
 * `sessionId ? feedQueryKey(sessionId) : [...]`. A conditional is not an
 * array literal, so the rule cannot verify either branch; the `[...]`
 * fallbacks in `reports.ts`/`adminReports.ts` are a known remainder.
 *
 * Test files (`*.test.{ts,tsx}`, `__tests__/`) are exempt: fixtures use
 * fake ids like `'sess-a'`. The ban targets shipped code.
 */

const KEY_METHODS = new Set(['setQueryData', 'invalidateQueries'])

function isTestFile(filename) {
  const normalized = String(filename || '').replace(/\\/g, '/')
  return (
    /\.test\.[cm]?[jt]sx?$/.test(normalized) ||
    normalized.includes('/__tests__/')
  )
}

function lintedFilename(context) {
  if (typeof context.filename === 'string') return context.filename
  if (typeof context.getFilename === 'function') return context.getFilename()
  return ''
}

function checkKeyArray(context, node) {
  const first = node.elements[0]
  // A hole (`[,]`) or an empty key carries no session; a literal-first key
  // (`['post', id]`, `['signed-out', ...]`) is kind-first or hand-rolled.
  // Anything else (identifier, member, call, `??`, spread) names the session
  // at runtime and is left to the builder convention.
  if (!first || first.type === 'Literal') {
    context.report({node: first || node, messageId: 'noUnscopedKey'})
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'src/ query keys must start with the sessionId (or be built by createQueryKey)',
    },
    messages: {
      noUnscopedKey:
        'Query key must start with the sessionId (or call createQueryKey); literal-first keys are unscoped.',
    },
    schema: [],
  },
  create(context) {
    if (isTestFile(lintedFilename(context))) return {}
    return {
      Property(node) {
        const name =
          !node.computed && node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal'
              ? node.key.value
              : null
        if (name !== 'queryKey') return
        if (node.value.type === 'ArrayExpression') {
          checkKeyArray(context, node.value)
        }
      },
      CallExpression(node) {
        const callee = node.callee
        // Bare calls (`setQueryData(...)`) and method calls
        // (`client.setQueryData(...)`, `queryClient.invalidateQueries(...)`).
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier'
              ? callee.property.name
              : null
        if (!name || !KEY_METHODS.has(name)) return
        const key = node.arguments[0]
        if (key && key.type === 'ArrayExpression') {
          checkKeyArray(context, key)
        }
      },
    }
  },
}
