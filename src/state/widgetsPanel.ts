// Widgets panel visibility (polish/2-shell): manual override independent
// of the left sidebar mode and of the viewport width. `auto` mounts the
// panel only when the full three-region shell fits (see
// `autoWidgetsPanelVisible`); `hidden` pins it hidden, with a restore
// affordance in the shell. Narrow viewports (mobile, rail, intermediate)
// never mount the panel — there is no drawer pattern yet, so hiding is
// the compliant option (`docs/visual-polish.md` Deliverable 2).
//
// In-memory module state (no disk persistence), mirroring
// `#/state/sideNav`: the toggle survives navigation within a session and
// resets on restart. Visibility state stays separate from widget
// configuration — slices 3–4 persist instances/layouts; this module only
// tracks shown/hidden. Subscription shape mirrors the emoji-pref stores
// (`useSyncExternalStore` + emit).

import {useSyncExternalStore} from 'react'

import {butterflyPx} from '#/alf/tokens'

export type WidgetsPanelMode = 'auto' | 'hidden'

let mode: WidgetsPanelMode = 'auto'
const listeners = new Set<() => void>()

function emit() {
  for (const listener of [...listeners]) listener()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getWidgetsPanelMode(): WidgetsPanelMode {
  return mode
}

export function setWidgetsPanelMode(next: WidgetsPanelMode): void {
  if (next === mode) return
  mode = next
  emit()
}

export function hideWidgetsPanel(): void {
  setWidgetsPanelMode('hidden')
}

export function showWidgetsPanel(): void {
  setWidgetsPanelMode('auto')
}

export function toggleWidgetsPanel(): void {
  setWidgetsPanelMode(mode === 'hidden' ? 'auto' : 'hidden')
}

/** Test seam (also used to reset the shell between renders). */
export function resetWidgetsPanelMode(): void {
  setWidgetsPanelMode('auto')
}

export function useWidgetsPanelMode(): WidgetsPanelMode {
  return useSyncExternalStore(subscribe, getWidgetsPanelMode)
}

/** Viewport width at which the full three-region shell fits without
 * squeezing the feed below its designed max: full sidebar + full feed +
 * widgets panel. Deliberately a fixed sum of tokens (not a live function
 * of the sidebar layout): collapsing the left sidebar must never flip
 * the panel, and vice versa. Pure — tested without a renderer. */
export function widgetsPanelAutoMinWidth(): number {
  return butterflyPx.sidebarMin + butterflyPx.mainColMax + butterflyPx.widgetsPanelWidth
}

/** Auto visibility: pure width math. Mobile, rail, and intermediate
 * widths all fall below the three-region fit, so the panel stays hidden
 * there and the mobile nav model is preserved. */
export function autoWidgetsPanelVisible(width: number): boolean {
  if (!Number.isFinite(width) || width <= 0) return false
  return width >= widgetsPanelAutoMinWidth()
}

/** Effective visibility: the manual `hidden` pin wins; otherwise the
 * width rule decides. Pure — the cut points are tested in
 * `widgetsPanel.test.ts` without a renderer. */
export function shouldShowWidgetsPanel(width: number, override: WidgetsPanelMode): boolean {
  if (override === 'hidden') return false
  return autoWidgetsPanelVisible(width)
}
