import {useMemo} from 'react'
import {useMediaQuery} from 'react-responsive'

import {breakpointPx, butterflyPx} from '#/alf/tokens'

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
 * Butterfly shell layout (Keystone v1 cut points, any platform):
 * `mobile` at or below 720px, icon `rail` 721–1000px, full sidebar above.
 */
export type ShellLayout = 'mobile' | 'rail' | 'full'

export function useShellLayout(): ShellLayout {
  const isMobile = useMediaQuery({maxWidth: butterflyPx.mobileMax})
  const isRail = useMediaQuery({
    minWidth: butterflyPx.mobileMax + 1,
    maxWidth: butterflyPx.railMax,
  })
  if (isMobile) return 'mobile'
  if (isRail) return 'rail'
  return 'full'
}

/**
 * Shell layout switches: right rail and compact nav (used by slice 1.5).
 * Kept for the tarantula deck plan; butterfly uses `useShellLayout`.
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
