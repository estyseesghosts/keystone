/**
 * Test-quality rule (repair X11.2): no NEW `as any` in tests.
 *
 * The suites converted in X11.2 use the typed factories in
 * `src/__tests__/factories` and `packages/fedi/test/factories` instead of
 * casts. This rule ratchets that: in test files (`*.test.*` and anything
 * under a `test/` or `__tests__/` directory) every `x as any` (and
 * `<any>x`) beyond the file's grandfathered allowance is an error.
 *
 * The allowance is the `BASELINE` map below (12 total on the day it was
 * written). A file at or under its allowance passes; a file over it — or
 * any test file not listed — fails on the excess occurrences. To burn the
 * baseline down, convert the file to the factories and lower its number
 * here (never raise one).
 */

const path = require('node:path')

// Grandfathered `as any` counts per test file (X11.2 day-zero: 12 total).
// Paths are repo-relative with forward slashes.
const BASELINE = {
  'src/components/Profile/__tests__/profileFields.test.tsx': 4,
  'src/screens/ProfileEditor.test.tsx': 2,
  'src/screens/FollowRequests.test.tsx': 2,
  'src/state/queries/graph.test.tsx': 1,
  'src/screens/Settings.test.tsx': 1,
  'src/components/Settings/MutesSection.test.tsx': 1,
  'src/components/Settings/AccountSection.test.tsx': 1,
}

function isTestFile(filename) {
  if (typeof filename !== 'string') return false
  const normalized = filename.split(path.sep).join('/')
  return (
    /\.test\.[jt]sx?$/.test(normalized) ||
    /(^|\/)(test|__tests__)(\/|$)/.test(normalized)
  )
}

function relativePozix(filename, cwd) {
  const rel = path.relative(cwd || process.cwd(), filename)
  return rel.split(path.sep).join('/')
}

function isAnyAnnotation(node) {
  // `x as any`: TSAsExpression whose typeAnnotation is TSAnyKeyword
  // directly (@typescript-eslint v8 shape; older/Babel shapes nest it in a
  // TSTypeAnnotation, which is also accepted). `<any>x`: TSTypeAssertion
  // with the type directly on the node.
  if (node.type === 'TSAsExpression') {
    const inner = node.typeAnnotation
    return (
      !!inner &&
      (inner.type === 'TSAnyKeyword' ||
        (inner.type === 'TSTypeAnnotation' &&
          !!inner.typeAnnotation &&
          inner.typeAnnotation.type === 'TSAnyKeyword'))
    )
  }
  if (node.type === 'TSTypeAssertion') {
    return !!node.typeAnnotation && node.typeAnnotation.type === 'TSAnyKeyword'
  }
  return false
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'no new `as any` in tests; use the typed factories (grandfathered baseline per file)',
    },
    messages: {
      noAnyInTests:
        'Unexpected `as any` in a test (allowance {{allowed}} for this file, this is occurrence {{occurrence}}). Use a typed factory from `#/__tests__/factories` or `packages/fedi/test/factories` instead, then lower the baseline entry.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename()
    if (!isTestFile(filename)) return {}
    const key = relativePozix(filename, context.cwd)
    const allowed = Object.hasOwn(BASELINE, key) ? BASELINE[key] : 0
    const hits = []
    return {
      TSAsExpression(node) {
        if (isAnyAnnotation(node)) hits.push(node)
      },
      TSTypeAssertion(node) {
        if (isAnyAnnotation(node)) hits.push(node)
      },
      'Program:exit'() {
        hits.slice(allowed).forEach((node, index) => {
          context.report({
            node,
            messageId: 'noAnyInTests',
            data: {allowed: String(allowed), occurrence: String(allowed + index + 1)},
          })
        })
      },
    }
  },
}
