// Keystone themes: black/white/grey, no accent colour.
// Values lifted from old Keystone `styles/global.css` `:root`
// (light) and its `prefers-color-scheme: dark` block (dark).

export type ThemeName = 'light' | 'dark'

export type Palette = {
  bg: string
  bgSoft: string
  raise: string
  text: string
  muted: string
  faint: string
  border: string
  edge: string
  borderStrong: string
}

export type Theme = {
  name: ThemeName
  palette: Palette
  /** Prose multiplier. 1 until the Display setting changes it. */
  fontScaleMultiplier: number
}

const lightPalette: Palette = {
  bg: '#ffffff',
  bgSoft: '#f6f6f6',
  raise: '#ececec',
  text: '#111111',
  muted: '#666666',
  // 4.54:1 on bg (WCAG AA normal-text floor is 4.5:1). Non-essential text
  // only (repair X10.2, audit a11y 9); on bgSoft/raise it drops to ~3.8-4.2:1
  // (see the contrast test allowlist) so essential text uses muted or text.
  faint: '#767676',
  border: '#e3e3e3',
  edge: '#d4d4d4',
  borderStrong: '#111111',
}

const darkPalette: Palette = {
  bg: '#111111',
  bgSoft: '#1b1b1b',
  raise: '#262626',
  text: '#ededed',
  muted: '#a8a8a8',
  // 5.47:1 on bg. Same non-essential-only rule as light faint; on raise it
  // is 4.38:1 (allowlisted, still above the 3:1 large-text/icon floor).
  faint: '#8a8a8a',
  border: '#2b2b2b',
  edge: '#3d3d3d',
  borderStrong: '#ededed',
}

export const themes: Record<ThemeName, Theme> = {
  light: {name: 'light', palette: lightPalette, fontScaleMultiplier: 1},
  dark: {name: 'dark', palette: darkPalette, fontScaleMultiplier: 1},
}

// Fixed overlay chrome for surfaces that stay dark in both themes (dialog
// scrims, the fullscreen media viewer): near-white foreground on a
// near-black surface, so the pairing contrasts in either theme. This is the
// only sanctioned home for color literals outside `palette` — everything in
// `src/` must reference `palette` or this constant (lint: no-hardcoded-color).
export const overlayChrome = {
  backdrop: '#000000',
  captionScrim: 'rgba(0,0,0,0.6)',
  fg: '#ffffff',
} as const
