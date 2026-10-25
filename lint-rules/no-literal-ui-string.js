/**
 * i18n ratchet rule: no NEW user-visible string literals in `src/`.
 *
 * From X0.2 on, every UI string goes through Lingui (`msg` / `t` / `Trans`
 * / `plural`). This rule pins that so the Wave 9 sweep (which removes the
 * existing literals) cannot regress: it reports, in `src/**.{ts,tsx}`
 * (excluding tests, `src/locale/locales/**`, and `src/__tests__/**`):
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
 * Ratchet: `lint-rules/baselines/no-literal-ui-string.json` maps each file
 * (repo-relative, posix) to its grandfathered violation count, produced by
 * running this rule on the tree before Wave 9. A file at or below its
 * baseline passes silently; a file above its baseline (or a new file with
 * any violation) reports every violation. `pnpm lint:i18n-baseline`
 * rewrites the baseline downward only and refuses to raise it.
 *
 * Tests MUST pass `options: [{baseline: {}}]` so fixtures exercise the raw
 * detector instead of the checked-in baseline.
 */

const fs = require('node:fs')
const path = require('node:path')

const BASELINE_PATH = path.join(__dirname, 'baselines', 'no-literal-ui-string.json')

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

let cachedBaseline = null

function loadBaseline(override) {
  if (override !== undefined) return override && typeof override === 'object' ? override : {}
  if (cachedBaseline) return cachedBaseline
  try {
    cachedBaseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    cachedBaseline = {}
  }
  return cachedBaseline
}

function allowedFor(baseline, rel) {
  if (!Object.prototype.hasOwnProperty.call(baseline, rel)) return 0
  const n = Math.floor(Number(baseline[rel]))
  return Number.isFinite(n) && n > 0 ? n : 0
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
    schema: [
      {
        type: 'object',
        properties: {baseline: {type: 'object'}},
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const rel = repoRel(lintedFilename(context))
    if (isExcludedFile(rel)) return {}
    const baseline = loadBaseline(context.options && context.options[0] && context.options[0].baseline)
    const allowed = allowedFor(baseline, rel)
    const pending = []
    let suppressed = 0
    const push = (node, messageId, data) => {
      if (suppressed === 0) pending.push({node, messageId, data})
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
      'Program:exit'() {
        if (pending.length > allowed) {
          for (const v of pending) {
            context.report({node: v.node, messageId: v.messageId, data: v.data})
          }
        }
      },
    }
  },
}

// --- Baseline maintenance (`pnpm lint:i18n-baseline`) -----------------------

const SRC_ROOT = path.join(__dirname, '..', 'src')

function walkSourceFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkSourceFiles(abs, out)
    } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
      const rel = path
        .relative(process.cwd().replace(/\\/g, '/'), abs.replace(/\\/g, '/'))
        .replace(/\\/g, '/')
      if (!isExcludedFile(rel)) out.push({abs, rel})
    }
  }
  return out
}

function rawCountForFile(code, rel) {
  const {Linter} = require('eslint')
  const tsParser = require('@typescript-eslint/parser')
  const linter = new Linter()
  const messages = linter.verify(
    code,
    {
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: {
        parser: tsParser,
        parserOptions: {ecmaFeatures: {jsx: true}},
      },
      plugins: {keystone: {rules: {'no-literal-ui-string': rule}}},
      rules: {'keystone/no-literal-ui-string': ['error', {baseline: {}}]},
    },
    rel,
  )
  return messages.filter((m) => m.ruleId === 'keystone/no-literal-ui-string').length
}

function readBaselineFile() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return null
  }
}

function writeBaselineFile(entries) {
  const sorted = Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  fs.mkdirSync(path.dirname(BASELINE_PATH), {recursive: true})
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
}

/**
 * Rewrite the baseline downward only (never raises it). New files are never
 * added (any violation there must fail lint); files at zero or gone from
 * the tree are dropped. Exits non-zero when a file rose above its baseline
 * (the baseline keeps the old, lower count) so the rise stays visible.
 */
function rebuildBaseline() {
  const files = walkSourceFiles(SRC_ROOT, [])
  const current = {}
  for (const {abs, rel} of files) {
    const count = rawCountForFile(fs.readFileSync(abs, 'utf8'), rel)
    if (count > 0) current[rel] = count
  }
  const old = readBaselineFile()
  if (old === null) {
    writeBaselineFile(current)
    const total = Object.values(current).length
      ? Object.values(current).reduce((a, b) => a + b, 0)
      : 0
    console.log(
      `baseline created: ${Object.keys(current).length} files, ${total} violations`,
    )
    return {raised: [], total}
  }
  const next = {}
  const raised = []
  for (const [file, oldCount] of Object.entries(old)) {
    const now = current[file] ?? 0
    if (now === 0) continue // fixed or deleted: drop the entry
    if (now > oldCount) {
      next[file] = oldCount // refuse to raise
      raised.push({file, old: oldCount, now})
    } else {
      next[file] = now
    }
  }
  writeBaselineFile(next)
  const total = Object.values(next).length
    ? Object.values(next).reduce((a, b) => a + b, 0)
    : 0
  console.log(`baseline: ${Object.keys(next).length} files, ${total} violations`)
  for (const r of raised) {
    console.error(`refused to raise ${r.file}: baseline ${r.old}, current ${r.now}`)
  }
  if (raised.length > 0) {
    console.error('baseline kept the lower counts; fix the new literals first')
    process.exitCode = 1
  }
  return {raised, total}
}

module.exports = rule
module.exports.rebuildBaseline = rebuildBaseline
module.exports.rawCountForFile = rawCountForFile
