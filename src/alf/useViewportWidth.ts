import {useWindowDimensions} from 'react-native'

/**
 * Viewport width in density-independent pixels (CSS px on web).
 *
 * Why this exists instead of `react-responsive`: that library matches
 * media queries through `window.matchMedia` when it is available and
 * otherwise falls back to static matching against an empty device, where
 * every query is false. React Native defines a `window` global without
 * `matchMedia`, so on iOS/Android *all* width queries silently reported
 * false and the shell always fell through to its widest layout (phone
 * screens got the desktop sidebar). Width math behaves the same on every
 * platform, re-renders on rotation/resize, and is unit-testable.
 */
export function useViewportWidth(): number {
  return useWindowDimensions().width
}
