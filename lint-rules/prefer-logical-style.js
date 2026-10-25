/**
 * RTL readiness rule (X9.6): `src/` must use logical style props.
 *
 * Physical direction props (`marginLeft`, `paddingRight`, `borderLeftWidth`,
 * `borderRightColor`, …) pin layout to LTR. Their logical equivalents
 * (`marginStart`, `paddingEnd`, `borderStartWidth`, `borderEndColor`, …)
 * are pixel-identical in LTR and mirror for free under an RTL layout
 * direction, so every convertible site in `src/` was switched and this
 * rule pins it. Reports the physical key with an autofix to the logical
 * name.
 *
 * Deliberately NOT flagged: bare `left`/`right` — those are physical
 * viewport geometry (anchored-popup / hover-card measurement math),
 * the `EdgeInsets` system type (safe-area insets are physical by API),
 * and `hitSlop` (which has no logical keys). Caret-diamond border drawing
 * uses the logical border props too (a symmetric diamond mirrors to
 * itself), so it stays clean.
 */

const PHYSICAL_TO_LOGICAL = {
  marginLeft: 'marginStart',
  marginRight: 'marginEnd',
  paddingLeft: 'paddingStart',
  paddingRight: 'paddingEnd',
  borderLeftWidth: 'borderStartWidth',
  borderRightWidth: 'borderEndWidth',
  borderLeftColor: 'borderStartColor',
  borderRightColor: 'borderEndColor',
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'src/ must use logical (start/end) style props, not physical (left/right) ones, for RTL readiness',
    },
    fixable: 'code',
    messages: {
      preferLogical:
        'Physical style prop "{{physical}}" — use logical "{{logical}}" (identical in LTR, mirrors in RTL).',
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        if (node.computed) return
        if (node.key.type !== 'Identifier') return
        const logical = PHYSICAL_TO_LOGICAL[node.key.name]
        if (!logical) return
        context.report({
          node: node.key,
          messageId: 'preferLogical',
          data: {physical: node.key.name, logical},
          fix(fixer) {
            return fixer.replaceText(node.key, logical)
          },
        })
      },
    }
  },
}
