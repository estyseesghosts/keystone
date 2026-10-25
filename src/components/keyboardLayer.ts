import {useEffect, useRef} from 'react'
import {Platform} from 'react-native'

// Single keyboard layer stack (repair X10.1, audit a11y 7). Dialog, Menu,
// AnchoredPopup, and the recommendations overlay used to own one document
// `keydown` listener each; `stopPropagation` on a document listener does not
// stop sibling document listeners, so one Escape closed every open layer at
// once (a Menu inside a Dialog closed both). Now exactly one document
// listener exists and only the TOP layer receives the event: the first
// Escape closes the Menu, the second closes the Dialog.
//
// Layers push on open and pop on close/unmount. Non-Escape keys go to the
// top layer too, so a Menu keeps its arrow/Enter navigation while a Dialog
// sits underneath. Native never installs the document listener (backdrop
// tap + `onRequestClose` own dismissal there); the stack still tracks so
// push/pop stay balanced on every target.
//
// (Lightbox keeps its own trap from X7.1 — it is not a layer here.)

export type KeyboardLayerHandler = (e: KeyboardEvent) => void

const stack: KeyboardLayerHandler[] = []
let listening = false
let listenedDoc: object | null = null

function top(): KeyboardLayerHandler | undefined {
  return stack[stack.length - 1]
}

function onKeyDown(e: KeyboardEvent) {
  // Exclusively the top layer: lower layers must not fire (the Escape
  // ordering test pins Menu-in-Dialog).
  top()?.(e)
}

function ensureListening() {
  if (listening) return
  if (Platform.OS !== 'web' || typeof document === 'undefined') return
  const doc = document as unknown as {
    addEventListener: (type: string, fn: (e: KeyboardEvent) => void) => void
  }
  if (typeof doc.addEventListener !== 'function') return
  doc.addEventListener('keydown', onKeyDown)
  listening = true
  listenedDoc = doc as unknown as object
}

function releaseListening() {
  if (!listening || stack.length > 0) return
  try {
    ;(listenedDoc as unknown as {
      removeEventListener?: (type: string, fn: (e: KeyboardEvent) => void) => void
    } | null)?.removeEventListener?.('keydown', onKeyDown)
  } catch {
    // A torn-down document (test harness swap): nothing to detach from.
  }
  listening = false
  listenedDoc = null
}

/** Push a layer; returns the pop function (idempotent). */
export function pushKeyboardLayer(handler: KeyboardLayerHandler): () => void {
  stack.push(handler)
  ensureListening()
  let popped = false
  return () => {
    if (popped) return
    popped = true
    const idx = stack.lastIndexOf(handler)
    if (idx !== -1) stack.splice(idx, 1)
    releaseListening()
  }
}

/** Depth probe for tests (never read in production). */
export function keyboardLayerDepth(): number {
  return stack.length
}

/**
 * Route this component's key handling through the shared stack while
 * `active`. The handler identity is mirrored in a ref, so it always sees
 * fresh state while the layer pushes exactly once per active period —
 * no stale closures, no re-push churn.
 */
export function useKeyboardLayer(active: boolean, handler: KeyboardLayerHandler): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    return pushKeyboardLayer(e => ref.current(e))
  }, [active])
}
