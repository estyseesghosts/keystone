// Font selection. Scaffold: system stack everywhere.
// User font override lands with Appearance settings (plan 6.x);
// bundled-font loading for native lands with it.

export type FontFamily = 'system'

export function getFontFamily(): FontFamily {
  return 'system'
}

/**
 * Prose scale multiplier. Fixed at 1 until the Appearance text-size
 * setting lands — chrome never zooms, only scaled prose does.
 */
export function getFontScaleMultiplier(): 1 {
  return 1
}
