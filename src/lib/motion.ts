import {useSyncExternalStore} from 'react'
import {AccessibilityInfo} from 'react-native'

// Reduced-motion setting (P9). Reads the OS "reduce motion" preference
// once (async) and re-reads on every `reduceMotionChanged` event, so
// popups, dialogs and the lightbox can skip their entrance animation.
// Default is full motion: the OS is the only source of truth, and a bare
// tree (tests, no native bridge) must never claim the user asked for less.

let cached: boolean | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function pull(): void {
  const get = AccessibilityInfo.isReduceMotionEnabled
  if (typeof get !== 'function') {
    if (cached !== false) {
      cached = false
      emit()
    }
    return
  }
  void get()
    .then(value => {
      const next = value === true
      if (cached !== next) {
        cached = next
        emit()
      }
    })
    .catch(() => {
      // Best effort: an unreadable setting keeps the current value.
    })
}

let subscribed = false
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  if (!subscribed) {
    subscribed = true
    pull()
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => {
      const next = value === true
      if (cached !== next) {
        cached = next
        emit()
      }
    })
    if (sub && typeof sub.remove === 'function') {
      // Kept for the process lifetime; the OS setting outlives any screen.
      void sub
    }
  }
  return () => {
    listeners.delete(fn)
  }
}

function getSnapshot(): boolean {
  return cached ?? false
}

/** True when the OS asks for reduced motion. Reactive; safe on bare trees. */
export function useReducedMotionSetting(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Test seam: reset the module cache between suites. */
export function __resetReducedMotionForTests(): void {
  cached = null
  subscribed = false
  listeners.clear()
}
