import {createMemoryStore} from '@keystone/fedi'

import {
  createEmojiGroupPrefsStore,
  createFavouritesStore,
  createLikeEmojiStore,
  DEFAULT_LIKE_EMOJI,
} from './emojiPrefs'

const S1 = 'https://a.example u1'
const S2 = 'https://b.example u2'

describe('like emoji store', () => {
  it('defaults to the heart per scope, persists, resets', () => {
    const storage = createMemoryStore()
    const store = createLikeEmojiStore(() => storage)
    expect(store.get(S1)).toBe(DEFAULT_LIKE_EMOJI)
    store.set(S1, '🍮')
    expect(store.get(S1)).toBe('🍮')
    expect(store.get(S2)).toBe(DEFAULT_LIKE_EMOJI)
    store.set(S1, '   ')
    expect(store.get(S1)).toBe('🍮')
    store.reset(S1)
    expect(store.get(S1)).toBe(DEFAULT_LIKE_EMOJI)
    // A fresh store over the same storage sees the persisted value.
    store.set(S1, '🍮')
    expect(createLikeEmojiStore(() => storage).get(S1)).toBe('🍮')
  })

  it('notifies subscribers on change', () => {
    const store = createLikeEmojiStore(() => createMemoryStore())
    const listener = jest.fn()
    store.subscribe(listener)
    store.set(S1, '👍')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('favourites store', () => {
  it('toggles and removes per scope, persisted', () => {
    const storage = createMemoryStore()
    const store = createFavouritesStore(() => storage)
    expect(store.list(S1)).toEqual([])
    store.toggle(S1, '👍')
    store.toggle(S1, '🎉')
    expect(store.list(S1)).toEqual(['👍', '🎉'])
    expect(store.list(S2)).toEqual([])
    store.toggle(S1, '👍')
    expect(store.list(S1)).toEqual(['🎉'])
    store.remove(S1, '🎉')
    expect(store.list(S1)).toEqual([])
    expect(createFavouritesStore(() => storage).list(S1)).toEqual([])
  })

  it('survives corrupt storage', () => {
    const storage = createMemoryStore({[`keystone.emojifavs.${S1}`]: '{bad'})
    expect(createFavouritesStore(() => storage).list(S1)).toEqual([])
  })
})

describe('emoji group prefs store', () => {
  it('pins/hides device-globally, persisted, deduped', () => {
    const storage = createMemoryStore()
    const store = createEmojiGroupPrefsStore(() => storage)
    expect(store.pinned()).toEqual([])
    expect(store.hidden()).toEqual([])
    store.pin('cats')
    store.pin('cats')
    store.hide('dogs')
    expect(store.pinned()).toEqual(['cats'])
    expect(store.hidden()).toEqual(['dogs'])
    store.unpin('cats')
    store.unhide('dogs')
    expect(store.pinned()).toEqual([])
    expect(store.hidden()).toEqual([])
    store.hide('dogs')
    const fresh = createEmojiGroupPrefsStore(() => storage)
    expect(fresh.hidden()).toEqual(['dogs'])
  })
})
