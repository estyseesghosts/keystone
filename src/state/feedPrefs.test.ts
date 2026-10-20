import {createMemoryStore} from '@keystone/fedi'

import {createFeedPrefsStore, DEFAULT_FEED_PREFS, parseFeedPrefs} from './feedPrefs'

describe('parseFeedPrefs', () => {
  it('defaults on missing/corrupt/non-object payloads', () => {
    expect(parseFeedPrefs(null)).toEqual(DEFAULT_FEED_PREFS)
    expect(parseFeedPrefs('')).toEqual(DEFAULT_FEED_PREFS)
    expect(parseFeedPrefs('{bad')).toEqual(DEFAULT_FEED_PREFS)
    expect(parseFeedPrefs('[]')).toEqual(DEFAULT_FEED_PREFS)
    expect(parseFeedPrefs(JSON.stringify({showLocal: 'yes'}))).toEqual(DEFAULT_FEED_PREFS)
  })

  it('keeps valid fields, defaults the rest', () => {
    expect(parseFeedPrefs(JSON.stringify({showLocal: true}))).toEqual({
      showLocal: true,
      showFederated: true,
    })
  })
})

describe('feed prefs store', () => {
  it('defaults, persists patches, notifies once per change', () => {
    const storage = createMemoryStore()
    const store = createFeedPrefsStore(() => storage)
    expect(store.get()).toEqual(DEFAULT_FEED_PREFS)
    const listener = jest.fn()
    store.subscribe(listener)
    store.set({showLocal: true})
    expect(store.get()).toEqual({showLocal: true, showFederated: true})
    expect(JSON.parse(storage.getItem('keystone.feedprefs')!)).toEqual({
      showLocal: true,
      showFederated: true,
    })
    expect(listener).toHaveBeenCalledTimes(1)
    store.set({showLocal: true})
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('isolates instances only by storage (device-global)', () => {
    const storage = createMemoryStore()
    const a = createFeedPrefsStore(() => storage)
    a.set({showFederated: false})
    expect(createFeedPrefsStore(() => storage).get().showFederated).toBe(false)
  })
})
