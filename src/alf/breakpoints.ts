import {useMemo} from 'react'

import {breakpointPx, butterflyPx} from '#/alf/tokens'
import {useViewportWidth} from '#/alf/useViewportWidth'

export type Breakpoint = 'gtPhone' | 'gtMobile' | 'gtTablet'

const noBreakpoint = {
  activeBreakpoint: undefined,
  gtPhone: false,
  gtMobile: false,
  gtTablet: false,
} as const

/**
 * Width breakpoints. Same cut points as the plan's deck rule: deck
 * layout is wide-breakpoint only (`gtTablet`), phones page instead.
 *
 * Pure function of the viewport width so the cut points can be tested
 * without a renderer; the hooks below feed it the live width. Do not go
 * back to `react-responsive` media queries — they are inert on native
 * (`window.matchMedia` does not exist), which is what put the desktop
 * shell on phones. See `#/alf/useViewportWidth`.
 */
export function breakpointsForWidth(width: number): Record<Breakpoint, boolean> & {
  activeBreakpoint: Breakpoint | undefined
} {
  if (!Number.isFinite(width) || width <= 0) return {...noBreakpoint}
  const gtPhone = width >= breakpointPx.gtPhone
  const gtMobile = width >= breakpointPx.gtMobile
  const gtTablet = width >= breakpointPx.gtTablet
  let active: Breakpoint | undefined
  if (gtTablet) {
    active = 'gtTablet'
  } else if (gtMobile) {
    active = 'gtMobile'
  } else if (gtPhone) {
    active = 'gtPhone'
  }
  return {activeBreakpoint: active, gtPhone, gtMobile, gtTablet}
}

export function useBreakpoints(): ReturnType<typeof breakpointsForWidth> {
  const width = useViewportWidth()
  return useMemo(() => breakpointsForWidth(width), [width])
}

/**
 * Butterfly shell layout (Keystone v1 cut points, any platform):
 * `mobile` at or below 720px, icon `rail` 721–1000px, full sidebar above.
 */
export type ShellLayout = 'mobile' | 'rail' | 'full'

export function shellLayoutForWidth(width: number): ShellLayout {
  if (!Number.isFinite(width) || width <= 0) return 'mobile'
  if (width <= butterflyPx.mobileMax) return 'mobile'
  if (width <= butterflyPx.railMax) return 'rail'
  return 'full'
}

export function useShellLayout(): ShellLayout {
  return shellLayoutForWidth(useViewportWidth())
}

/**
 * Shell layout switches: right rail and compact nav (used by slice 1.5).
 * Kept for the tarantula deck plan; butterfly uses `useShellLayout`.
 */
export function layoutBreakpointsForWidth(width: number) {
  if (!Number.isFinite(width) || width <= 0) {
    return {rightNavVisible: false, centerColumnOffset: false, leftNavMinimal: true}
  }
  return {
    rightNavVisible: width >= breakpointPx.layoutTwoCol,
    centerColumnOffset:
      width >= breakpointPx.layoutTwoCol && width <= breakpointPx.layoutCompactNav,
    leftNavMinimal: width <= breakpointPx.layoutCompactNav,
  }
}

export function useLayoutBreakpoints(): ReturnType<typeof layoutBreakpointsForWidth> {
  return layoutBreakpointsForWidth(useViewportWidth())
}
