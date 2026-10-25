/**
 * i18n rule: no user-visible string literals in `src/`.
 *
 * From X0.2 on, every UI string goes through Lingui (`msg` / `t` / `Trans`
 * / `plural`). This rule pins that (Wave 9 burned the grandfathered
 * baseline down to zero and X9.8 deleted the baseline mechanism, so this
 * is now a plain error): it reports, in `src/**.{ts,tsx}` (excluding
 * tests, `src/locale/locales/**`, and `src/__tests__/**`):
 *
 * - JSX text nodes containing a letter (`\p{L}`), unless inside `<Trans>`.
 *   Whitespace, digits, and pure punctuation/glyph-only text (`·`, `/`,
 *   `|`, `…`, `—`, HTML entities) are allowed. A bare string expression
 *   child (`<Text>{'Hello'}</Text>`) counts as a text node.
 * - String/template literals assigned to JSX props `label`, `title`,
 *   `placeholder`, `accessibilityLabel`, `accessibilityHint`,
 *   `accessibilityValue`, `aria-label`, `alt`, `tooltip`, `disabledReason`,
 *   `emptyText`, `description`, `headerTitle`, `subtitle`, `caption`.
 * - String literals passed as the first argument of `showToast`,
 *   `toastError`, `Alert.alert`, `confirm`.
 *
 * Allowed (never reported): anything inside `` msg`` `` / `` t`` `` /
 * `i18n._()` / `plural()` / `<Trans>`; `testID`; `key`; `style`; URLs;
 * icon names; string enum values compared against identifiers (those are
 * `BinaryExpression`s, never JSX props or flagged call args).
 *
 * Error text that only surfaces through `setError` / `errorText` fallbacks
 * (validation reasons, query-throw messages) is out of this rule's reach
 * by design — those paths are covered by the pseudo-locale smoke test
 * (`src/locale/pseudo-locale-smoke.test.tsx`), which renders screens under
 * the `pseudo` locale and fails on any plain-English text node.
 */

const path = require('node:path')

const LETTER = /\p{L}/u
const ENTITY = /&(?:[a-zA-Z]+|#[0-9]+|#x[0-9a-fA-F]+);/g
const URL_LIKE = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/|#|\?)/

// Speakable UI surfaces. Deliberately NOT here: testID, key, style, name,
// source, uri, color, icon — never user-visible on their own.
const TARGET_PROPS = new Set([
  'label',
  'title',
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
  'accessibilityValue',
  'aria-label',
  'alt',
  'tooltip',
  'disabledReason',
  'emptyText',
  'description',
  'headerTitle',
  'subtitle',
  'caption',
])

const TOAST_FNS = new Set(['showToast', 'toastError', 'confirm'])

function hasLetter(text) {
  return typeof text === 'string' && LETTER.test(text.replace(ENTITY, ''))
}

function templateHasLetter(node) {
  return (
    node.type === 'TemplateLiteral' &&
    node.quasis.some((q) => hasLetter(q.value.cooked ?? q.value.raw))
  )
}

function isUrlLike(value) {
  return typeof value === 'string' && URL_LIKE.test(value.trim())
}

function lintedFilename(context) {
  if (typeof context.filename === 'string') return context.filename
  if (typeof context.getFilename === 'function') return context.getFilename()
  return ''
}

/** Repo-relative posix path; non-absolute names (RuleTester) pass through. */
function repoRel(filename) {
  const normalized = String(filename || '').replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('<')) return normalized
  const noDot = normalized.replace(/^\.\//, '')
  const isAbsolute = noDot.startsWith('/') || /^[A-Za-z]:\//.test(noDot)
  if (!isAbsolute) return noDot
  const rel = path
    .relative(process.cwd().replace(/\\/g, '/'), noDot)
    .replace(/\\/g, '/')
  return rel && !rel.startsWith('..') ? rel : noDot
}

function isExcludedFile(rel) {
  return (
    /\.test\.[cm]?[jt]sx?$/.test(rel) ||
    /\.spec\.[cm]?[jt]sx?$/.test(rel) ||
    /(^|\/)__tests__\//.test(rel) ||
    rel.includes('src/locale/locales/') ||
    rel.startsWith('<')
  )
}

function isTransElement(node) {
  return (
    node.type === 'JSXElement' &&
    node.openingElement.name.type === 'JSXIdentifier' &&
    node.openingElement.name.name === 'Trans'
  )
}

function isI18nTag(node) {
  return (
    node.type === 'TaggedTemplateExpression' &&
    node.tag.type === 'Identifier' &&
    (node.tag.name === 'msg' || node.tag.name === 't')
  )
}

function isI18nCall(node) {
  if (node.type !== 'CallExpression') return false
  const callee = node.callee
  if (callee.type === 'Identifier' && callee.name === 'plural') return true
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'i18n' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === '_'
  )
}

function isToastCall(node) {
  const callee = node.callee
  if (callee.type === 'Identifier') return TOAST_FNS.has(callee.name)
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Alert' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'alert'
  )
}

function firstArgIsLiteral(node) {
  const arg = node.arguments[0]
  if (!arg) return false
  if (arg.type === 'Literal') return hasLetter(arg.value)
  return templateHasLetter(arg)
}

function checkPropLiteral(node, push) {
  if (node.name.type !== 'JSXIdentifier' || !TARGET_PROPS.has(node.name.name)) return
  const value = node.value
  if (!value) return
  if (value.type === 'Literal') {
    if (hasLetter(value.value) && !isUrlLike(value.value)) {
      push(value, 'noLiteralProp', {prop: node.name.name})
    }
    return
  }
  if (value.type === 'JSXExpressionContainer') {
    const expr = value.expression
    if (expr.type === 'Literal' && hasLetter(expr.value) && !isUrlLike(expr.value)) {
      push(expr, 'noLiteralProp', {prop: node.name.name})
    } else if (templateHasLetter(expr)) {
      push(expr, 'noLiteralProp', {prop: node.name.name})
    }
  }
}

function checkExpressionChild(node, push) {
  // `<Text>{'Hello'}</Text>`: a bare string child renders as text content.
  if (node.type === 'Literal' && hasLetter(node.value)) {
    push(node, 'noLiteralJsxText', {})
  } else if (templateHasLetter(node)) {
    push(node, 'noLiteralJsxText', {})
  }
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'src/ must not add user-visible string literals; use Lingui msg/t/Trans/plural',
    },
    messages: {
      noLiteralJsxText:
        'User-visible JSX text must go through Lingui (<Trans> / t / msg), not a literal.',
      noLiteralProp:
        'User-visible JSX prop "{{prop}}" must go through Lingui (t / msg / plural), not a literal.',
      noLiteralCallArg:
        'User-visible toast/alert text must go through Lingui (t / msg), not a literal.',
    },
    schema: [],
  },
  create(context) {
    const rel = repoRel(lintedFilename(context))
    if (isExcludedFile(rel)) return {}
    let suppressed = 0
    const push = (node, messageId, data) => {
      if (suppressed === 0) context.report({node, messageId, data})
    }
    return {
      JSXElement(node) {
        if (isTransElement(node)) suppressed += 1
      },
      'JSXElement:exit'(node) {
        if (isTransElement(node)) suppressed -= 1
      },
      TaggedTemplateExpression(node) {
        if (isI18nTag(node)) suppressed += 1
      },
      'TaggedTemplateExpression:exit'(node) {
        if (isI18nTag(node)) suppressed -= 1
      },
      CallExpression(node) {
        if (isI18nCall(node)) {
          suppressed += 1
          return
        }
        if (suppressed === 0 && isToastCall(node) && firstArgIsLiteral(node)) {
          const name =
            node.callee.type === 'Identifier' ? node.callee.name : 'Alert.alert'
          push(node.arguments[0], 'noLiteralCallArg', {name})
        }
      },
      'CallExpression:exit'(node) {
        if (isI18nCall(node)) suppressed -= 1
      },
      JSXText(node) {
        if (suppressed === 0 && hasLetter(node.value)) {
          push(node, 'noLiteralJsxText', {})
        }
      },
      JSXAttribute(node) {
        if (suppressed === 0) checkPropLiteral(node, push)
      },
      JSXExpressionContainer(node) {
        // Only bare string children of JSX (`<Text>{'Hi'}</Text>`); deeper
        // expressions (`{cond ? 'a' : 'b'}`, `{t`x`}`) are out of scope.
        if (suppressed !== 0) return
        const parent = node.parent
        const inJsx =
          parent &&
          (parent.type === 'JSXElement' || parent.type === 'JSXFragment')
        if (inJsx) checkExpressionChild(node.expression, push)
      },
    }
  },
}

module.exports = rule
