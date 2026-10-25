// Global "one playing at a time" store (repair X7.2, media M5).
//
// Feed gifv loops, inline videos, and audio clips all share one slot:
// starting a player pauses the previous one, so N visible gifv posts never
// hold N decoders. Viewability (FeedView / PostFeed), AppState backgrounding,
// navigation blur, and unmount all funnel through `request` / `release` /
// `suspendAll`; tiles play only while their id is current AND their own
// `active` (viewable), app-foreground, and autoplay-policy gates agree.
//
// Pure process state plus hook glue: the store never touches a player
// object itself — effects in the tiles call `play()` / `pause()` from the
// subscription changes. `AppState` and `NavigationContext` are read only
// inside hooks/subscriptions (never at import time).

import {useContext, useEffect, useSyncExternalStore} from 'react'
import {AppState} from 'react-native'

import {NavigationContext} from '@react-navigation/native'

/** Default ceiling: one decoding player at a time. */
export const DEFAULT_MAX_ACTIVE_PLAYERS = 1

let maxActive = DEFAULT_MAX_ACTIVE_PLAYERS
/** Most-recent-first claim order; only the first `maxActive` ids are live. */
let order: string[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** Configured ceiling (tests raise it to prove the bound is honoured). */
export function getMaxActivePlayers(): number {
  return maxActive
}

export function setMaxActivePlayers(n: number): void {
  const next = Math.floor(n)
  maxActive = Number.isFinite(next) && next >= 1 ? next : DEFAULT_MAX_ACTIVE_PLAYERS
  order = order.slice(0, maxActive)
  emit()
}

/** Currently live player ids (most-recent-first, at most the ceiling). */
export function getActivePlayerIds(): readonly string[] {
  return [...order]
}

export function isPlayerActive(id: string): boolean {
  return order.includes(id)
}

/** Claim the slot for `id`, preempting the oldest claim past the ceiling. */
export function requestPlayerPlay(id: string): void {
  if (!id) return
  order = [id, ...order.filter(current => current !== id)].slice(0, maxActive)
  emit()
}

/** Release `id` (scroll-off, pause, unmount). A no-op for anyone else. */
export function releasePlayer(id: string): void {
  if (!order.includes(id)) return
  order = order.filter(current => current !== id)
  emit()
}

/** Drop every claim (navigation blur, list teardown). Tiles pause after. */
export function suspendAllPlayers(): void {
  if (order.length === 0) return
  order = []
  emit()
}

export function subscribeActivePlayer(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Reactive: true while `id` holds the slot. */
export function useIsPlayerActive(id: string): boolean {
  return useSyncExternalStore(subscribeActivePlayer, () => isPlayerActive(id), () => isPlayerActive(id))
}

/** Test seam: restore the default ceiling and drop every claim. */
export function __resetActivePlayerForTests(): void {
  maxActive = DEFAULT_MAX_ACTIVE_PLAYERS
  order = []
}

// --- Foreground gate (repair X7.2 step 2: pause on backgrounded AppState) ---

/** Pure: only the `active` state means foreground. */
export function isAppActiveState(state: string | null | undefined): boolean {
  return state === 'active'
}

function readAppActive(): boolean {
  try {
    // The native event arg (tracked in `lastAppState`) wins: the jest
    // AppState mock leaves `currentState` a function, and real hosts update
    // both. Anything but a positive background string fails open to
    // foreground so media stays testable on bare trees.
    if (lastAppState != null) return isAppActiveState(lastAppState)
    const raw = (AppState as unknown as {currentState?: unknown} | null | undefined)?.currentState
    const current = typeof raw === 'function' ? (raw as () => unknown).call(AppState) : raw
    if (typeof current !== 'string') return true
    return isAppActiveState(current)
  } catch {
    return true
  }
}

const appListeners = new Set<() => void>()
let appListening = false
/** Last `AppState` change event seen (test-spied transitions drive this;
 * real hosts update `currentState` alongside the event). */
let lastAppState: string | null = null

function ensureAppListening(): void {
  if (appListening) return
  appListening = true
  try {
    AppState?.addEventListener?.('change', (next: unknown) => {
      if (typeof next === 'string') lastAppState = next
      for (const listener of [...appListeners]) {
        try {
          listener()
        } catch {
          // A failing media listener never breaks AppState dispatch.
        }
      }
    })
  } catch {
    // No AppState source: the snapshot default (foreground) stands until
    // a host provides one.
  }
}

function subscribeAppActive(fn: () => void): () => void {
  appListeners.add(fn)
  ensureAppListening()
  return () => {
    appListeners.delete(fn)
  }
}

/** Reactive: false while the app is backgrounded/inactive. */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppActive, readAppActive, readAppActive)
}

/** Test seam: drop listeners and allow re-subscribing, so suites that
 * spy on `AppState.addEventListener` observe a fresh subscription. */
export function __resetAppActiveForTests(): void {
  appListeners.clear()
  appListening = false
  lastAppState = null
}

// --- Navigation blur gate (repair X7.2 step 2: pause on blur) ---

type BlurCapableNavigation = {
  addListener?: (event: string, callback: () => void) => () => void
} | null

/**
 * Suspend every player when the host screen blurs (tab switch, push).
 * Reads `NavigationContext` directly instead of `useFocusEffect` so trees
 * with no navigator (unit tests, previews) render untouched — a missing
 * context is a no-op, never a throw. Unmount still releases per-tile.
 */
export function useSuspendOnBlur(): void {
  const navigation = useContext(NavigationContext) as unknown as BlurCapableNavigation
  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== 'function') return
    let off: (() => void) | null = null
    try {
      off = navigation.addListener('blur', () => suspendAllPlayers())
    } catch {
      return
    }
    return () => {
      try {
        off?.()
      } catch {
        // Teardown is best-effort.
      }
    }
  }, [navigation])
}
