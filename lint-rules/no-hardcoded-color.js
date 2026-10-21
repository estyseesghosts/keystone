/**
 * Contrast-sweep gate: no hardcoded color literals in `src/`.
 *
 * Foreground colors must resolve to `theme.palette` (or the fixed
 * `overlayChrome` pair in `src/alf/themes.ts`) so text contrasts in both
 * themes. Raw hex / black / white / rgb() strings anywhere else regress to
 * black-on-dark or white-on-light.
 *
 * Only `src/alf/themes.ts` (the sanctioned home for literals) and test
 * fixtures may contain color strings. Applied to `src/**` via
 * `eslint.config.mjs`.
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const NAMED = /^(?:black|white)$/i
const FUNCTIONAL = /^\s*(?:rgb|hsl)a?\(/i

function isAllowedFile(filename) {
  const normalized = String(filename || '').replace(/\\/g, '/')
  return (
    normalized.endsWith('src/alf/themes.ts') ||
    normalized.includes('__fixtures__') ||
    /(?:^|\/)fixtures\//.test(normalized)
  )
}

function isHardcodedColor(value) {
  return (
    typeof value === 'string' &&
    (HEX.test(value) || NAMED.test(value) || FUNCTIONAL.test(value))
  )
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'src/ must not contain hardcoded color literals; use theme.palette (or overlayChrome from src/alf/themes.ts)',
    },
    messages: {
      noHardcodedColor:
        'Hardcoded color "{{value}}" — use theme.palette (or overlayChrome from src/alf/themes.ts).',
    },
    schema: [],
  },
  create(context) {
    const filename =
      typeof context.filename === 'string'
        ? context.filename
        : typeof context.getFilename === 'function'
          ? context.getFilename()
          : ''
    if (isAllowedFile(filename)) {
      return {}
    }
    return {
      Literal(node) {
        if (isHardcodedColor(node.value)) {
          context.report({node, messageId: 'noHardcodedColor', data: {value: node.value}})
        }
      },
    }
  },
}
