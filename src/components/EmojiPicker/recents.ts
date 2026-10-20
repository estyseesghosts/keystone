import type {KeyValueStore} from '@keystone/fedi'

import {appStorage} from '#/storage'

import type {PickedEmoji} from './model'

// Recently used emoji, per session, persisted through the app storage
// layer. Custom entries keep their art URL so they render with no lookup.

export const MAX_RECENT_EMOJI = 24
export const recentsKeyFor = (sessionId: string): string => {
  if (!sessionId) throw new Error('recentsKeyFor requires a sessionId')
  return `keystone.emojirecents.${sessionId}`
}

function parse(raw: string | null): PickedEmoji[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(v)) return []
    return v.flatMap((e): PickedEmoji[] =>
      e && typeof e.key === 'string' && e.key && (e.kind === 'unicode' || e.kind === 'custom')
        ? [{kind: e.kind, key: e.key, ...(typeof e.url === 'string' ? {url: e.url} : {})}]
        : [],
    ).slice(0, MAX_RECENT_EMOJI)
  } catch {
    return []
  }
}

export interface EmojiRecentsStore {
  list(sessionId: string): PickedEmoji[]
  touch(sessionId: string, emoji: PickedEmoji): void
  subscribe(fn: () => void): () => void
}

export function createEmojiRecentsStore(storage: () => KeyValueStore = appStorage): EmojiRecentsStore {
  const listeners = new Set<() => void>()
  const cache = new Map<string, PickedEmoji[]>()
  const list = (s: string) => {
    let v = cache.get(s)
    if (!v) {
      v = parse(storage().getItem(recentsKeyFor(s)))
      cache.set(s, v)
    }
    return v
  }
  return {
    list,
    touch(sessionId, emoji) {
      const next = [emoji, ...list(sessionId).filter(e => e.key !== emoji.key)].slice(0, MAX_RECENT_EMOJI)
      cache.set(sessionId, next)
      storage().setItem(recentsKeyFor(sessionId), JSON.stringify(next))
      listeners.forEach(l => l())
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export const emojiRecentsStore: EmojiRecentsStore = createEmojiRecentsStore()
