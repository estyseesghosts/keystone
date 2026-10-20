import {useMemo} from 'react'
import {useMediaQuery} from 'react-responsive'

import {breakpointPx} from '#/alf/tokens'

export type Breakpoint = 'gtPhone' | 'gtMobile' | 'gtTablet'

/**
 * Width breakpoints. Same cut points as the plan's deck rule: deck
 * layout is wide-breakpoint only (`gtTablet`), phones page instead.
 */
export function useBreakpoints(): Record<Breakpoint, boolean> & {
  activeBreakpoint: Breakpoint | undefined
} {
  const gtPhone = useMediaQuery({minWidth: breakpointPx.gtPhone})
  const gtMobile = useMediaQuery({minWidth: breakpointPx.gtMobile})
  const gtTablet = useMediaQuery({minWidth: breakpointPx.gtTablet})
  return useMemo(() => {
    let active: Breakpoint | undefined
    if (gtTablet) {
      active = 'gtTablet'
    } else if (gtMobile) {
      active = 'gtMobile'
    } else if (gtPhone) {
      active = 'gtPhone'
    }
    return {activeBreakpoint: active, gtPhone, gtMobile, gtTablet}
  }, [gtPhone, gtMobile, gtTablet])
}

/**
 * Shell layout switches: right rail and compact nav (used by slice 1.5).
 */
export function useLayoutBreakpoints() {
  const rightNavVisible = useMediaQuery({minWidth: breakpointPx.layoutTwoCol})
  const centerColumnOffset = useMediaQuery({
    minWidth: breakpointPx.layoutTwoCol,
    maxWidth: breakpointPx.layoutCompactNav,
  })
  const leftNavMinimal = useMediaQuery({
    maxWidth: breakpointPx.layoutCompactNav,
  })
  return {rightNavVisible, centerColumnOffset, leftNavMinimal}
}
