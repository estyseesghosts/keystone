import type {Theme} from '#/alf/themes'

// Visible keyboard-focus ring (repair X10.1, audit a11y 11). One token for
// every focusable: a 2px solid outline in the theme's strongest border tone
// (near-black on light, near-white on dark), so it reads on any surface in
// either theme. Web-only: native touch targets never take keyboard focus,
// and native outline rendering is spotty — callers spread this only when a
// `focused` state is true on web (shared Pressable, composer inputs).
export const FOCUS_RING_WIDTH = 2

export function focusRingStyle(theme: Theme): {
  outlineColor: string
  outlineWidth: number
  outlineStyle: 'solid'
} {
  return {
    outlineColor: theme.palette.borderStrong,
    outlineWidth: FOCUS_RING_WIDTH,
    outlineStyle: 'solid',
  }
}
