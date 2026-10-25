import {useEffect, type RefObject} from 'react'
import {Platform} from 'react-native'

// Modal focus in/out (repair X10.1, audit a11y 7). On open (web only),
// focus moves into the dialog — first focusable control, else the container
// itself; on close/unmount it returns to whatever held focus before, so
// keyboard and screen-reader users never lose their place. Best-effort
// throughout: a missing container, a DOM-less renderer, or an unmounted
// opener are silent no-ops, never throws.

type Focusable = {focus?: () => void}

export function useModalFocus(active: boolean, containerRef: RefObject<unknown>): void {
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof document === 'undefined') return
    const doc = document as unknown as {activeElement?: Focusable | null}
    const prev = doc.activeElement ?? null
    const el = containerRef.current as unknown as {
      querySelectorAll?: (sel: string) => ArrayLike<Focusable>
      contains?: (node: unknown) => boolean
      focus?: () => void
    } | null
    try {
      const nodes = el?.querySelectorAll?.(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      const focusables = nodes
        ? Array.prototype.filter.call(
            nodes,
            (n: Focusable) => typeof n.focus === 'function',
          )
        : []
      if (focusables.length > 0) focusables[0].focus?.()
      else el?.focus?.()
    } catch {
      // Bare test renderer refs are opaque mocks: focusing is impossible,
      // and the dialog still works — announcements use props, not focus.
    }
    return () => {
      try {
        prev?.focus?.()
      } catch {
        // The opener unmounted first: nothing to return to.
      }
    }
  }, [active, containerRef])
}
