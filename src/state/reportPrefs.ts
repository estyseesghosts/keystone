import {useSyncExternalStore} from 'react'

import {REPORT_CATEGORIES, type KeyValueStore, type ReportCategory} from '@keystone/fedi'

import {appStorage} from '#/storage'

// Report chooser prefs (clickstone §1.5): the category the reader picked
// last time. Device-local (like colour mode / feed tabs), NOT per account —
// it is a convenience default, and a reporter switching accounts still gets
// their own last choice. Malformed storage falls back to "no last choice"
// (the chooser then starts on `other`, the server's own default).

const LAST_CATEGORY_KEY = 'keystone.lastreportcategory'

/** Pure: a stored string is a valid category or nothing (never a guess). */
export function parseLastReportCategory(raw: string | null): ReportCategory | null {
  if (!raw) return null
  return (REPORT_CATEGORIES as readonly string[]).includes(raw) ? (raw as ReportCategory) : null
}

export interface ReportPrefsStore {
  get(): ReportCategory | null
  set(category: ReportCategory): void
  subscribe(fn: () => void): () => void
}

export function createReportPrefsStore(
  storage: () => KeyValueStore = appStorage,
): ReportPrefsStore {
  const listeners = new Set<() => void>()
  const read = (): ReportCategory | null => {
    try {
      return parseLastReportCategory(storage().getItem(LAST_CATEGORY_KEY))
    } catch {
      return null
    }
  }
  let cached: ReportCategory | null = null
  let loaded = false
  const get = (): ReportCategory | null => {
    if (!loaded) {
      cached = read()
      loaded = true
    }
    return cached
  }
  return {
    get,
    set(category: ReportCategory): void {
      if (get() === category) return
      cached = category
      loaded = true
      try {
        storage().setItem(LAST_CATEGORY_KEY, category)
      } catch {
        // Storage unavailable: the choice lasts for this session only.
      }
      for (const listener of [...listeners]) listener()
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

export const reportPrefsStore: ReportPrefsStore = createReportPrefsStore()

export function useLastReportCategory(
  store: ReportPrefsStore = reportPrefsStore,
): ReportCategory | null {
  return useSyncExternalStore(store.subscribe, store.get)
}
