// Online + foreground awareness (repair X3.2, networking M3).
//
// React Query's `onlineManager` defaults to "online" forever on native and
// `focusManager` listens to `window` events that never fire there, so
// offline queries burn retries instead of pausing and foregrounding the app
// never refetches. This module wires both managers to the real platform
// sources (NetInfo on native, `navigator.onLine` + window events on web;
// AppState on native, `visibilitychange` on web) and adds ONE targeted
// foreground refetch: feed, notification, and `me` queries only, at most
// once per 60 s per query. Every other query keeps
// `refetchOnWindowFocus: false` — no global flip (X1.4/X1.5 own the
// Provider defaults).
//
// All sources are injectable so tests drive fakes instead of native modules.
// Every setup path is defensive: a missing native module degrades to the
// previous behavior (always-online / no focus events), never a boot crash.

import {AppState, Platform} from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import {focusManager, onlineManager, type Query, type QueryClient} from '@tanstack/react-query'

/** Minimum gap between two foreground refetches of the same query. */
export const FOREGROUND_REFETCH_MIN_GAP_MS = 60_000

/** Query kinds (key[1]) eligible for the foreground refetch. */
const FOREGROUND_REFETCH_KINDS: ReadonlySet<string> = new Set(['post-feed', 'notifications', 'me'])

/**
 * True for feed / notification / `me` keys (sessionId-first). Pure.
 * Everything else (filters, drafts, chat, admin, search, ...) never
 * refetches on focus.
 */
export function isForegroundRefetchKey(key: unknown): boolean {
  if (!Array.isArray(key) || key.length < 2) return false
  const kind = key[1]
  return typeof kind === 'string' && FOREGROUND_REFETCH_KINDS.has(kind)
}

/** Injectable online source (tests pass a fake; defaults use NetInfo/web). */
export interface OnlineSource {
  subscribe(setOnline: (online: boolean) => void): () => void
}

/** Injectable focus source (tests pass a fake; defaults use AppState/web). */
export interface FocusSource {
  subscribe(setFocused: (focused: boolean) => void): () => void
}

function isWeb(): boolean {
  return Platform.OS === 'web'
}

/** Platform online source: NetInfo on native, navigator.onLine on web. */
export function defaultOnlineSource(): OnlineSource {
  if (isWeb()) {
    return {
      subscribe(setOnline) {
        const update = (): void => {
          setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true)
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('online', update)
          window.addEventListener('offline', update)
        }
        update()
        return () => {
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('online', update)
            window.removeEventListener('offline', update)
          }
        }
      },
    }
  }
  return {
    subscribe(setOnline) {
      const sub = NetInfo.addEventListener(state => {
        setOnline(state.isConnected ?? true)
      })
      void NetInfo.fetch()
        .then(state => {
          setOnline(state.isConnected ?? true)
        })
        .catch(() => {
          // An unreadable initial state keeps the default (online); the
          // subscription still reports changes.
        })
      return () => {
        try {
          if (typeof sub === 'function') sub()
        } catch {
          // Detach is best-effort.
        }
      }
    },
  }
}

/** Platform focus source: AppState on native, visibilitychange on web. */
export function defaultFocusSource(): FocusSource {
  if (isWeb()) {
    return {
      subscribe(setFocused) {
        const update = (): void => {
          setFocused(typeof document !== 'undefined' ? !document.hidden : true)
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', update)
        }
        update()
        return () => {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', update)
          }
        }
      },
    }
  }
  return {
    subscribe(setFocused) {
      const sub = AppState.addEventListener('change', state => {
        setFocused(state === 'active')
      })
      setFocused(AppState.currentState === 'active')
      return () => sub.remove()
    },
  }
}

/**
 * Wire `onlineManager` to the platform source. While offline, queries pause
 * instead of failing into retries; coming back online resumes them through
 * the manager's normal reconnect path. Returns a best-effort detach.
 */
export function setupOnlineManager(source: OnlineSource = defaultOnlineSource()): () => void {
  let detach: (() => void) | undefined
  try {
    onlineManager.setEventListener(setOnline => {
      try {
        detach = source.subscribe(online => {
          setOnline(online)
        })
      } catch {
        detach = undefined
        return undefined
      }
      return () => {
        detach = undefined
      }
    })
  } catch {
    // A missing native module (or a host without one) must never break boot:
    // queries keep the default always-online assumption.
  }
  return () => {
    try {
      detach?.()
    } catch {
      // Detach is best-effort.
    }
    detach = undefined
  }
}

export interface ForegroundRefetchOpts {
  /** Clock (tests inject a fake). Defaults to `Date.now`. */
  now?: number
  /** Per-query last-refetch map (owned by `setupFocusManager`). */
  lastRefetch?: Map<string, number>
}

/**
 * Refetch the eligible ACTIVE queries (feed / notifications / `me`), at
 * most once per `FOREGROUND_REFETCH_MIN_GAP_MS` per query key. A query seen
 * for the first time only starts its budget — mounts fetch on their own, so
 * discovering them is never a refetch. Inactive queries refetch on their
 * next mount instead. Returns the fingerprints that were refetched (tests).
 * Never throws; one bad query never blocks the rest.
 */
export function refetchForegroundQueries(
  client: QueryClient,
  opts: ForegroundRefetchOpts = {},
): string[] {
  const refetched: string[] = []
  if (!onlineManager.isOnline()) return refetched
  const now = opts.now ?? Date.now()
  const lastRefetch = opts.lastRefetch ?? new Map<string, number>()
  let queries: Array<Query>
  try {
    queries = client.getQueryCache().findAll({type: 'active'})
  } catch {
    return refetched
  }
  for (const query of queries) {
    const key = query.queryKey
    if (!isForegroundRefetchKey(key)) continue
    let fingerprint: string
    try {
      fingerprint = JSON.stringify(key)
    } catch {
      continue
    }
    const last = lastRefetch.get(fingerprint)
    if (last === undefined) {
      // First sighting: start the budget, do not refetch (the mount that
      // just created this query already fetched it).
      lastRefetch.set(fingerprint, now)
      continue
    }
    if (now - last < FOREGROUND_REFETCH_MIN_GAP_MS) continue
    lastRefetch.set(fingerprint, now)
    refetched.push(fingerprint)
    try {
      void client.refetchQueries({queryKey: key, exact: true})
    } catch {
      // One query never blocks the rest.
    }
  }
  return refetched
}

/**
 * Wire `focusManager` to the platform source and refetch eligible queries
 * on every focus gain (throttled per query — see
 * `refetchForegroundQueries`). The 60 s gap lives here, not in a global
 * `refetchOnWindowFocus` flip. Returns a cleanup for the Provider effect.
 */
export function setupFocusManager(
  client: QueryClient,
  source: FocusSource = defaultFocusSource(),
  now: () => number = Date.now,
): () => void {
  const lastRefetch = new Map<string, number>()
  try {
    focusManager.setEventListener(setFocused => {
      try {
        return source.subscribe(focused => {
          setFocused(focused)
        })
      } catch {
        return undefined
      }
    })
  } catch {
    // A missing native module must never break boot: focus refetch simply
    // never fires.
  }
  let off: (() => void) | undefined
  try {
    off = focusManager.subscribe(focused => {
      if (!focused) return
      let at: number
      try {
        at = now()
      } catch {
        return
      }
      try {
        refetchForegroundQueries(client, {now: at, lastRefetch})
      } catch {
        // A failed foreground pass never breaks focus handling.
      }
    })
  } catch {
    // Subscribing must never break boot either.
  }
  // Seed budgets for queries that are already active: the source's
  // initial push fires before this subscription exists, so without this
  // the first real focus gain would only start budgets (first-sighting
  // rule) instead of refetching. Mounts fetched already, so seeding —
  // not refetching — is the honest start. Queries that mount later are
  // still budgeted on first sighting inside the pass.
  try {
    const at = now()
    for (const query of client.getQueryCache().findAll({type: 'active'})) {
      if (!isForegroundRefetchKey(query.queryKey)) continue
      try {
        lastRefetch.set(JSON.stringify(query.queryKey), at)
      } catch {
        // Unserializable keys simply budget on first sighting instead.
      }
    }
  } catch {
    // Budget seeding is best-effort; the pass still works without it.
  }
  return () => {
    try {
      off?.()
    } catch {
      // Detach is best-effort.
    }
  }
}

export interface QueryLifecycleDeps {
  onlineSource?: OnlineSource
  focusSource?: FocusSource
  /** Clock for the foreground-refetch budget (tests inject a fake). */
  now?: () => number
}

/**
 * Wire both managers for one `QueryClient` (called once by `QueryProvider`).
 * Returns the combined cleanup.
 */
export function setupQueryLifecycle(client: QueryClient, deps: QueryLifecycleDeps = {}): () => void {
  const offOnline = setupOnlineManager(deps.onlineSource ?? defaultOnlineSource())
  const offFocus = setupFocusManager(
    client,
    deps.focusSource ?? defaultFocusSource(),
    deps.now ?? Date.now,
  )
  return () => {
    offOnline()
    offFocus()
  }
}
