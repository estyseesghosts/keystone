// Profile detail-column layout (bio card + field cards): a pure function
// of shell size and content presence, so the split rules are unit-tested
// without a renderer. The component feeds it `desktop =
// useShellLayout() !== 'mobile'`, `hasBio` (the header would render bio
// content today), and `hasFields` (`account.fields.length > 0`).
//
// - `none`: no cards at all (never an empty card).
// - `stack`: one full-width column, bio first, then fields (mobile).
// - `split`: two equal halves, bio left, fields right (desktop, both).
// - `center-bio` / `center-fields`: half-width card centered (desktop,
//   one side only — never an empty half column).

export type ProfileDetailLayout = 'none' | 'stack' | 'split' | 'center-bio' | 'center-fields'

export function profileDetailLayout(opts: {
  desktop: boolean
  hasBio: boolean
  hasFields: boolean
}): ProfileDetailLayout {
  const {desktop, hasBio, hasFields} = opts
  if (!hasBio && !hasFields) return 'none'
  if (!desktop) return 'stack'
  if (hasBio && hasFields) return 'split'
  return hasBio ? 'center-bio' : 'center-fields'
}
