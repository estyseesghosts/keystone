import {useSyncExternalStore} from 'react'

import type {KeyValueStore} from '@keystone/fedi'

import {appStorage} from '#/storage'

// My Network tab preferences (Settings → Feeds, v1
// `frontend/src/state/feedPrefs.ts` parity). Device-local display
// preference (like colour mode), NOT per account: tab *availability* is
// already per session (Social needs the Misskey family + a credential),
// this only records the reader's overrides.
//
// - showLocal: show the Local tab even while Social is available.
//   Default false: Social already contains local posts, so Local hides by
//   default — but Local is ALWAYS shown when Social is unavailable
//   (signed out, Mastodon family), whatever this says.
// - showFederated: show the Federated tab. Default true.

export interface FeedPrefs {
  showLocal: boolean
  showFederated: boolean
}

export const DEFAULT_FEED_PREFS: FeedPrefs = {
  showLocal: false,
  showFederated: true,
}

const FEED_PREFS_KEY = 'keystone.feedprefs'

/** Validated parse of stored prefs: anything malformed is the default. Pure. */
export function parseFeedPrefs(raw: string | null): FeedPrefs {
  if (!raw) return {...DEFAULT_FEED_PREFS}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {...DEFAULT_FEED_PREFS}
  }
  if (!data || typeof data !== 'object') return {...DEFAULT_FEED_PREFS}
  const d = data as Record<string, unknown>
  return {
    showLocal: typeof d.showLocal === 'boolean' ? d.showLocal : DEFAULT_FEED_PREFS.showLocal,
    showFederated:
      typeof d.showFederated === 'boolean' ? d.showFederated : DEFAULT_FEED_PREFS.showFederated,
  }
}

export interface FeedPrefsStore {
  get(): FeedPrefs
  set(patch: Partial<FeedPrefs>): void
  subscribe(fn: () => void): () => void
}

export function createFeedPrefsStore(
  storage: () => KeyValueStore = appStorage,
): FeedPrefsStore {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const read = (): FeedPrefs => {
    try {
      return parseFeedPrefs(storage().getItem(FEED_PREFS_KEY))
    } catch {
      return {...DEFAULT_FEED_PREFS}
    }
  }
  // Cached by reference: `useSyncExternalStore` needs a stable snapshot
  // (a fresh object every read would re-render forever).
  let cached: FeedPrefs | null = null
  const get = (): FeedPrefs => {
    if (!cached) cached = read()
    return cached
  }
  return {
    get,
    set(patch: Partial<FeedPrefs>): void {
      const next = {...get(), ...patch}
      if (next.showLocal === cached!.showLocal && next.showFederated === cached!.showFederated) {
        return
      }
      cached = next
      try {
        storage().setItem(FEED_PREFS_KEY, JSON.stringify(next))
      } catch {
        // Storage unavailable: the preference lasts for this session only.
      }
      emit()
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

export const feedPrefsStore: FeedPrefsStore = createFeedPrefsStore()

export function useFeedPrefs(store: FeedPrefsStore = feedPrefsStore): FeedPrefs {
  return useSyncExternalStore(store.subscribe, store.get)
}
