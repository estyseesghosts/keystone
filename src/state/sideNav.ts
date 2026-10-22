// Sidebar collapse mode (P6.4): manual override independent of the
// viewport width. `auto` follows `useShellLayout` (mobile ≤720, rail
// 721–1000, full above); `expanded`/`collapsed` pin full/rail on desktop.
// Mobile is always mobile — the override only applies past the phone
// cut point (see `effectiveSidebarLayout`).
//
// In-memory module state (no disk persistence): the toggle survives
// navigation within a session and resets on restart. Subscription shape
// mirrors the emoji-pref stores (`useSyncExternalStore` + emit).

import {useSyncExternalStore} from 'react'

import type {ShellLayout} from '#/alf/breakpoints'

export type SidebarMode = 'auto' | 'expanded' | 'collapsed'

let mode: SidebarMode = 'auto'
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

export function getSidebarMode(): SidebarMode {
  return mode
}

export function setSidebarMode(next: SidebarMode): void {
  if (next === mode) return
  mode = next
  emit()
}

export function expandSidebar(): void {
  setSidebarMode('expanded')
}

export function collapseSidebar(): void {
  setSidebarMode('collapsed')
}

/** Test seam (also used to reset the shell between renders). */
export function resetSidebarMode(): void {
  setSidebarMode('auto')
}

export function useSidebarMode(): SidebarMode {
  return useSyncExternalStore(subscribe, getSidebarMode)
}

/** Width-derived layout with the manual override applied. Pure — the
 * cut points are tested in `sideNav.test.ts` without a renderer. */
export function effectiveSidebarLayout(auto: ShellLayout, override: SidebarMode): ShellLayout {
  if (auto === 'mobile' || override === 'auto') return auto
  return override === 'expanded' ? 'full' : 'rail'
}
