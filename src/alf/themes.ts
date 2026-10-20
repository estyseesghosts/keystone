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
  faint: '#999999',
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
  faint: '#7a7a7a',
  border: '#2b2b2b',
  edge: '#3d3d3d',
  borderStrong: '#ededed',
}

export const themes: Record<ThemeName, Theme> = {
  light: {name: 'light', palette: lightPalette, fontScaleMultiplier: 1},
  dark: {name: 'dark', palette: darkPalette, fontScaleMultiplier: 1},
}
