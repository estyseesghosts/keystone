// Shared minute ticker (repair X9.5): ONE interval for the whole app so
// relative times refresh, never a per-row timer. `useSyncExternalStore`
// over a whole-minute snapshot: subscribers re-render only when the
// minute rolls over. Paused while backgrounded (`AppState` other than
// `active`): no ticks, no re-renders; returning to foreground snaps the
// snapshot forward when the minute changed mid-absence.
//
// Bare-tree safe: a missing `AppState` source fails open to ticking (the
// jest mock leaves `currentState` unusable and spies supply transitions
// through the change event, which is the source of truth here).

import {useSyncExternalStore} from 'react'
import {AppState} from 'react-native'

/** Snapshot granularity: whole minutes since the epoch. */
function readMinute(): number {
  return Math.floor(Date.now() / 60000)
}

let currentMinute: number | null = null
/** Wall-clock ms behind the snapshot: refreshed on subscribe (mount
 * reads like the old per-render `Date.now()`, so exact-boundary ages
 * never flip) and on rollover ticks, monotonically non-decreasing. */
let currentNowMs: number | null = null
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let appListening = false
/** Last `AppState` change event seen (test-spied transitions drive this;
 * real hosts update `currentState` alongside the event). */
let lastAppState: string | null = null

function snapshot(): number {
  if (currentMinute === null) {
    currentMinute = readMinute()
    currentNowMs = Date.now()
  }
  return currentMinute
}

/** Millisecond clock behind the snapshot (initializes on first read so
 * the first paint matches a direct `Date.now()`). */
function snapshotMs(): number {
  if (currentNowMs === null) {
    currentMinute = readMinute()
    currentNowMs = Date.now()
  }
  return currentNowMs
}

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** Pure: only `active` means foreground. Anything else (including an
 * unknown/missing state) pauses the ticker. */
export function isTickerActiveState(state: string | null | undefined): boolean {
  return state === 'active'
}

function tick(): void {
  try {
    if (lastAppState !== null && !isTickerActiveState(lastAppState)) return
    const minute = readMinute()
    if (currentMinute === null || minute !== currentMinute) {
      currentMinute = minute
      currentNowMs = Date.now()
      emit()
    }
  } catch {
    // A clock read never breaks subscribers.
  }
}

function ensureAppListening(): void {
  if (appListening) return
  appListening = true
  try {
    AppState?.addEventListener?.('change', (next: unknown) => {
      if (typeof next === 'string') lastAppState = next
      // Foreground return snaps forward at once (the interval stays
      // paused the whole absence, so without this the row sits stale
      // until the next tick).
      if (next === 'active') tick()
    })
  } catch {
    // No AppState source: the interval alone drives the snapshot.
  }
}

function ensureTimer(): void {
  if (timer !== null) return
  try {
    // Twice per minute: boundary crossings surface within ~30s without
    // waking the app every second. Emission still happens only when the
    // whole-minute snapshot actually changes.
    timer = setInterval(tick, 30_000)
    // A lingering interval must never hold the jest worker open.
    const handle = timer as unknown as {unref?: () => void}
    if (typeof handle.unref === 'function') handle.unref()
  } catch {
    timer = null
  }
}

function subscribeMinuteTick(fn: () => void): () => void {
  // Mount reads like the old per-render `Date.now()`: the cache moves
  // forward to commit time (never backward), so a row mounted just after
  // its fixture timestamp can never age it backward across a floor
  // boundary. Rows mounted in the same minute share the label anyway.
  currentNowMs = Date.now()
  if (currentMinute === null) currentMinute = readMinute()
  listeners.add(fn)
  ensureAppListening()
  ensureTimer()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getMinuteTick(): number {
  return snapshot()
}

function getNowMs(): number {
  return snapshotMs()
}

/** Whole-minute snapshot; re-renders the caller on rollover only. */
export function useMinuteTick(): number {
  return useSyncExternalStore(subscribeMinuteTick, getMinuteTick, getMinuteTick)
}

/** Millisecond clock for `formatRelativeTime` call sites: wall-clock ms
 * as of the last sync (mount, or the rollover tick that re-rendered the
 * row). Minute-exact for every relative label, and monotonic per fixture
 * — the first paint matches a direct `Date.now()`, so mounting never
 * ages a just-created timestamp backward. */
export function useNow(): number {
  return useSyncExternalStore(subscribeMinuteTick, getNowMs, getNowMs)
}

/** Test seam: drop listeners, stop the interval, forget AppState. */
export function __resetMinuteTickerForTests(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
  listeners.clear()
  appListening = false
  lastAppState = null
  currentMinute = null
  currentNowMs = null
}
