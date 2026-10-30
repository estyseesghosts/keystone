import {createMemoryStore, ApiError} from '@keystone/fedi'

import {
  createEmojiGroupPrefsStore,
  createFavouritesStore,
  createLikeEmojiStore,
  DEFAULT_LIKE_EMOJI,
  persistLikeEmojiServer,
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

describe('group prefs collapse set', () => {
  it('collapses/expands per section, persisted, deduped', () => {
    const storage = createMemoryStore()
    const store = createEmojiGroupPrefsStore(() => storage)
    expect(store.collapsed()).toEqual([])
    store.collapse('custom:blobs')
    store.collapse('custom:blobs')
    store.collapse('unicode:face')
    expect(store.collapsed()).toEqual(['custom:blobs', 'unicode:face'])
    store.expand('custom:blobs')
    expect(store.collapsed()).toEqual(['unicode:face'])
    const fresh = createEmojiGroupPrefsStore(() => storage)
    expect(fresh.collapsed()).toEqual(['unicode:face'])
  })
})

describe('persistLikeEmojiServer', () => {
  const backend = (over: Record<string, unknown> = {}) => ({
    family: 'misskey',
    updateProfile: jest.fn(async () => undefined),
    ...over,
  })
  it('persists on misskey, reports unsupported/refused honestly', async () => {
    const ok = backend()
    await expect(persistLikeEmojiServer(ok as never, '👍')).resolves.toBeNull()
    expect(ok.updateProfile).toHaveBeenCalledWith({ext: {defaultReaction: '👍'}})
    await expect(persistLikeEmojiServer(null, '👍')).resolves.toBe('unsupported')
    await expect(persistLikeEmojiServer(backend({family: 'mastodon'}) as never, '👍')).resolves.toBe(
      'unsupported',
    )
    const notFound = backend({
      updateProfile: jest.fn(async () => {
        throw new ApiError('nope', 404)
      }),
    })
    await expect(persistLikeEmojiServer(notFound as never, '👍')).resolves.toBe('unsupported')
    const refused = backend({
      updateProfile: jest.fn(async () => {
        throw new ApiError('nope', 403)
      }),
    })
    await expect(persistLikeEmojiServer(refused as never, '👍')).resolves.toBe('refused')
  })
})
