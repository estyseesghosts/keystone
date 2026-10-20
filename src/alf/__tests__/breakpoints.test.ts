import {
  breakpointsForWidth,
  layoutBreakpointsForWidth,
  shellLayoutForWidth,
} from '#/alf/breakpoints'

// Regression guard for the phone-shows-desktop-shell bug: breakpoints are
// pure width math now, so the cut points are locked here without a renderer
// (the old `react-responsive` media queries were always false on native).
describe('shellLayoutForWidth', () => {
  it('pages on phones at or below 720px', () => {
    expect(shellLayoutForWidth(390)).toBe('mobile')
    expect(shellLayoutForWidth(720)).toBe('mobile')
  })

  it('collapses to an icon rail from 721px through 1000px', () => {
    expect(shellLayoutForWidth(721)).toBe('rail')
    expect(shellLayoutForWidth(900)).toBe('rail')
    expect(shellLayoutForWidth(1000)).toBe('rail')
  })

  it('shows the full sidebar above 1000px', () => {
    expect(shellLayoutForWidth(1001)).toBe('full')
    expect(shellLayoutForWidth(1440)).toBe('full')
  })

  it('treats a missing viewport as a phone', () => {
    expect(shellLayoutForWidth(0)).toBe('mobile')
    expect(shellLayoutForWidth(Number.NaN)).toBe('mobile')
  })
})

describe('breakpointsForWidth', () => {
  it('reports no breakpoint below 500px', () => {
    expect(breakpointsForWidth(390)).toEqual({
      activeBreakpoint: undefined,
      gtPhone: false,
      gtMobile: false,
      gtTablet: false,
    })
  })

  it('reports the highest matching breakpoint', () => {
    expect(breakpointsForWidth(500).activeBreakpoint).toBe('gtPhone')
    expect(breakpointsForWidth(799).activeBreakpoint).toBe('gtPhone')
    expect(breakpointsForWidth(800).activeBreakpoint).toBe('gtMobile')
    expect(breakpointsForWidth(1299).activeBreakpoint).toBe('gtMobile')
    expect(breakpointsForWidth(1300).activeBreakpoint).toBe('gtTablet')
  })

  it('keeps lower breakpoints true as width grows', () => {
    const wide = breakpointsForWidth(1440)
    expect(wide).toEqual({
      activeBreakpoint: 'gtTablet',
      gtPhone: true,
      gtMobile: true,
      gtTablet: true,
    })
  })
})

describe('layoutBreakpointsForWidth', () => {
  it('shows the right rail from 1100px', () => {
    expect(layoutBreakpointsForWidth(1099).rightNavVisible).toBe(false)
    expect(layoutBreakpointsForWidth(1100).rightNavVisible).toBe(true)
  })

  it('offsets the center column only in the two-column band', () => {
    expect(layoutBreakpointsForWidth(1099).centerColumnOffset).toBe(false)
    expect(layoutBreakpointsForWidth(1100).centerColumnOffset).toBe(true)
    expect(layoutBreakpointsForWidth(1300).centerColumnOffset).toBe(true)
    expect(layoutBreakpointsForWidth(1301).centerColumnOffset).toBe(false)
  })

  it('keeps the nav minimal at or below 1300px', () => {
    expect(layoutBreakpointsForWidth(1300).leftNavMinimal).toBe(true)
    expect(layoutBreakpointsForWidth(1301).leftNavMinimal).toBe(false)
  })
})
