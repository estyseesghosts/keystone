// Design tokens: spacing, radii, type sizes, layout breakpoints.
// Keystone grey system — no accent colours. Our own scale.

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 9999,
} as const

export const borderWidth = {
  hairline: 1,
  strong: 2,
} as const

// Prose sizes. Chrome stays fixed; user text scaling (plan 6.x) will
// multiply these via the theme font-scale multiplier only.
export const typeSize = {
  caption: 12,
  body: 15,
  heading: 20,
  title: 28,
} as const

export const lineHeight = {
  caption: 16,
  body: 20,
  heading: 26,
  title: 34,
} as const

export const breakpointPx = {
  gtPhone: 500,
  gtMobile: 800,
  layoutTwoCol: 1100,
  layoutCompactNav: 1300,
  gtTablet: 1300,
} as const

// Butterfly shell cut points (Keystone v1 parity): phone layout at or below
// 720px on any platform, icon rail 721–1000px, full sidebar above.
export const butterflyPx = {
  mobileMax: 720,
  railMax: 1000,
  sidebarMin: 220,
  railWidth: 68,
  mainColMax: 600,
  // Feed max when the widgets column is hidden: wider than the standard
  // 600 so the freed space goes to content, still capped for readability.
  mainColMaxWide: 720,
  // Widgets panel width (polish/2-shell): 300 content + 16 padding per
  // side — the X8.2-removed RightNav stub's width, kept so the panel
  // remounts at its demonstrated size. Full three-region fit:
  // sidebarMin + mainColMax + widgetsPanelWidth = 1152.
  widgetsPanelWidth: 332,
} as const

// Media width caps (polish/8-media-caps): single still images and link
// preview cards hug at most this wide on wide columns instead of
// stretching full-bleed; `maxWidth: 100%` shrinks them on narrow
// viewports. Video, gifv, multi-image strips, and quote-bleed media keep
// their own sizing.
export const mediaPx = {singleMaxW: 520} as const
