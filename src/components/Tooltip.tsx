// Supplement-only native tooltip (polish/5-nav-polish, Deliverable 5).
// Web renders the label in a `title` attribute on an inert,
// layout-neutral wrapper, so hovering an icon-only control names it
// without covering the control or stealing clicks. Native has no hover
// and renders the children alone.
//
// The `title` lookup is DOM-ancestor-based, so `display: contents`
// keeps the wrapper out of flex layout while the tooltip still fires
// over the wrapped control. The wrapper carries no role and no
// handlers: touch and keyboard stay complete through the control's own
// handlers, and the existing accessibility label remains the source of
// truth — tooltips duplicate it, never replace it. There is no tooltip
// primitive elsewhere in `src/components/` (`Popup` is an anchored
// card for menus, not hover text), so this is the shared pattern for
// icon-only nav/chrome from here on.
import type {ReactNode} from 'react'
import {Platform} from 'react-native'

export function Tooltip({
  label,
  children,
  testID,
}: {
  /** Mirrors the wrapped control's accessibility label. */
  label: string
  children: ReactNode
  testID?: string
}) {
  if (Platform.OS !== 'web') return <>{children}</>
  return (
    <span title={label} data-tooltip={testID ?? 'tooltip'} style={{display: 'contents'}}>
      {children}
    </span>
  )
}
