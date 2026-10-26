// Page-hide flush targets (composer slice 1, web reload path).
//
// A full page reload never runs React unmount cleanups, so the debounced
// autosave plus the unmount flush lose the last <400 ms of typing (and the
// open-draft pointer when nothing was ever autosaved). The composer flushes
// synchronously on the page-hide signals that fire reliably around a
// reload — `pagehide` (reload, navigation, tab close; bfcache-friendly,
// unlike `beforeunload`) plus `visibilitychange` while hidden (mobile-web
// app switch). The store seam is synchronous (MMKV; the web shim is sync
// localStorage), so the write lands before the page goes away.
//
// Targets are injectable (same pattern as the query lifecycle sources): the
// controller defaults to the real browser globals — absent off-web, where
// the subscription no-ops — and tests drive fake `EventTarget`s.

/** The event-target surface the subscription needs (a subset — fakes welcome). */
export interface PageHideTarget {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  readonly hidden?: boolean
}

export interface PageHideTargets {
  win?: PageHideTarget
  doc?: PageHideTarget
}

/** Real browser targets. Either side is undefined off-web (or when the
 * host exposes no event API) so the subscriber no-ops instead of throwing. */
export function realPageHideTargets(): PageHideTargets {
  const win =
    typeof window !== 'undefined' && typeof window.addEventListener === 'function'
      ? (window as unknown as PageHideTarget)
      : undefined
  const doc =
    typeof document !== 'undefined' && typeof document.addEventListener === 'function'
      ? (document as unknown as PageHideTarget)
      : undefined
  return {win, doc}
}

/** Subscribe a synchronous `onHide` flush to the page-hide signals on the
 * given targets. Returns the cleanup. A missing window target subscribes
 * nothing (native); a missing document target subscribes `pagehide` only.
 * Listener identity is stable per call, so the cleanup detaches exactly
 * what was attached. */
export function subscribePageHideFlush(
  onHide: () => void,
  win: PageHideTarget | undefined,
  doc: PageHideTarget | undefined,
): () => void {
  if (!win || typeof win.addEventListener !== 'function') return () => {}
  const onVisibility = () => {
    if (doc != null && doc.hidden) onHide()
  }
  win.addEventListener('pagehide', onHide)
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', onVisibility)
  }
  return () => {
    if (typeof win.removeEventListener === 'function') {
      win.removeEventListener('pagehide', onHide)
    }
    if (doc && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', onVisibility)
    }
  }
}
