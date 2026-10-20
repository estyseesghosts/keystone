import {useSyncExternalStore} from 'react'

import {
  addFavourite as addFav,
  DEFAULT_LIKE_EMOJI,
  MAX_FAVOURITES,
  parseLikeEmoji,
  parseStoredList,
  removeFavourite as removeFav,
  type KeyValueStore,
} from '@keystone/fedi'

import {appStorage} from '#/storage'

// Reactions prefs (Settings → Reactions, v1 `state/emojiPrefs.tsx` +
// `state/emojiGroupPrefs.ts` parity). Own code, same shape:
//
// - like emoji + favourites are PER SESSION (each signed-in account, and
//   the signed-out "anon" bucket, gets its own storage). List math is the
//   pure fedi `api/emoji` module; this file owns the signals + persistence.
// - pinned/hidden custom-emoji groups are DEVICE-GLOBAL (one choice
//   follows the device, like the colour mode).
//
// The picker (`components/EmojiPicker/model.ts`) reads favourites and the
// group lists; the like emoji is the server default where the backend
// persists it (`i/update { defaultReaction }`) with the device value as
// the fallback.

const FAVOURITES_BASE = 'keystone.emojifavs'
const LIKE_EMOJI_BASE = 'keystone.likeemoji'
const PINNED_GROUPS_KEY = 'keystone.pinnedemojigroups'
const HIDDEN_GROUPS_KEY = 'keystone.hiddenemojigroups'

export const ANON_SCOPE = 'anon'

function scopedKey(base: string, scope: string): string {
  return `${base}.${scope}`
}

function readText(storage: KeyValueStore, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function writeText(storage: KeyValueStore, key: string, value: string): void {
  try {
    storage.setItem(key, value)
  } catch {
    // Storage unavailable: the preference lasts for this session only.
  }
}

function readStringList(storage: KeyValueStore, key: string): string[] {
  const raw = readText(storage, key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export interface LikeEmojiStore {
  get(scope: string): string
  set(scope: string, emoji: string): void
  reset(scope: string): void
  subscribe(fn: () => void): () => void
}

export function createLikeEmojiStore(
  storage: () => KeyValueStore = appStorage,
): LikeEmojiStore {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    get: scope => parseLikeEmoji(readText(storage(), scopedKey(LIKE_EMOJI_BASE, scope))),
    set(scope, emoji) {
      const clean = emoji.trim()
      if (clean.length === 0) return
      writeText(storage(), scopedKey(LIKE_EMOJI_BASE, scope), clean)
      emit()
    },
    reset(scope) {
      writeText(storage(), scopedKey(LIKE_EMOJI_BASE, scope), DEFAULT_LIKE_EMOJI)
      emit()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

export const likeEmojiStore: LikeEmojiStore = createLikeEmojiStore()

export function useLikeEmoji(scope: string, store: LikeEmojiStore = likeEmojiStore): string {
  return useSyncExternalStore(store.subscribe, () => store.get(scope))
}

export interface FavouritesStore {
  list(scope: string): string[]
  toggle(scope: string, emoji: string): void
  remove(scope: string, emoji: string): void
  subscribe(fn: () => void): () => void
}

export function createFavouritesStore(
  storage: () => KeyValueStore = appStorage,
): FavouritesStore {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const read = (scope: string): string[] =>
    parseStoredList(readText(storage(), scopedKey(FAVOURITES_BASE, scope)), MAX_FAVOURITES)
  const cache = new Map<string, string[]>()
  const list = (scope: string): string[] => {
    let v = cache.get(scope)
    if (!v) {
      v = read(scope)
      cache.set(scope, v)
    }
    return v
  }
  const write = (scope: string, next: string[]): void => {
    cache.set(scope, next)
    writeText(storage(), scopedKey(FAVOURITES_BASE, scope), JSON.stringify(next))
    emit()
  }
  return {
    list,
    toggle(scope, emoji) {
      const current = list(scope)
      write(scope, current.includes(emoji) ? removeFav(current, emoji) : addFav(current, emoji))
    },
    remove(scope, emoji) {
      write(scope, removeFav(list(scope), emoji))
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

export const favouritesStore: FavouritesStore = createFavouritesStore()

export function useFavourites(scope: string, store: FavouritesStore = favouritesStore): string[] {
  return useSyncExternalStore(store.subscribe, () => store.list(scope))
}

export interface EmojiGroupPrefsStore {
  pinned(): string[]
  hidden(): string[]
  pin(category: string): void
  unpin(category: string): void
  hide(category: string): void
  unhide(category: string): void
  subscribe(fn: () => void): () => void
}

export function createEmojiGroupPrefsStore(
  storage: () => KeyValueStore = appStorage,
): EmojiGroupPrefsStore {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const read = (key: string): string[] => readStringList(storage(), key)
  const cache = new Map<string, string[]>()
  const cached = (key: string): string[] => {
    let v = cache.get(key)
    if (!v) {
      v = read(key)
      cache.set(key, v)
    }
    return v
  }
  const write = (key: string, list: string[]): void => {
    cache.set(key, list)
    writeText(storage(), key, JSON.stringify(list))
    emit()
  }
  return {
    pinned: () => cached(PINNED_GROUPS_KEY),
    hidden: () => cached(HIDDEN_GROUPS_KEY),
    pin(category) {
      const list = cached(PINNED_GROUPS_KEY)
      if (list.includes(category)) return
      write(PINNED_GROUPS_KEY, [...list, category])
    },
    unpin(category) {
      write(
        PINNED_GROUPS_KEY,
        cached(PINNED_GROUPS_KEY).filter(c => c !== category),
      )
    },
    hide(category) {
      const list = cached(HIDDEN_GROUPS_KEY)
      if (list.includes(category)) return
      write(HIDDEN_GROUPS_KEY, [...list, category])
    },
    unhide(category) {
      write(
        HIDDEN_GROUPS_KEY,
        cached(HIDDEN_GROUPS_KEY).filter(c => c !== category),
      )
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

export const emojiGroupPrefsStore: EmojiGroupPrefsStore = createEmojiGroupPrefsStore()

export function usePinnedGroups(store: EmojiGroupPrefsStore = emojiGroupPrefsStore): string[] {
  return useSyncExternalStore(store.subscribe, store.pinned)
}

export function useHiddenGroups(store: EmojiGroupPrefsStore = emojiGroupPrefsStore): string[] {
  return useSyncExternalStore(store.subscribe, store.hidden)
}

export {DEFAULT_LIKE_EMOJI}
