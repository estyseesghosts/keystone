// WS-A device quote policy: the `onlyAuthorizedQuotes` device pref
// (default OFF — show everything) and its schema round-trip.
import {createMemoryStore, type KeyValueStore} from '@keystone/fedi'

import {migrateDeviceState} from '#/storage/schema'
import {readDeviceState} from '#/storage'

import {createAppearanceStore} from './appearance'

function setup(raw?: string): {storage: KeyValueStore; store: ReturnType<typeof createAppearanceStore>} {
  const storage = createMemoryStore(raw ? {'keystone.device': raw} : undefined)
  return {storage, store: createAppearanceStore(() => storage)}
}

describe('appearance store (quote policy)', () => {
  it('defaults to showing every quote on a fresh install', () => {
    const {store} = setup()
    expect(store.getOnlyAuthorizedQuotes()).toBe(false)
  })

  it('persists the opt-in and notifies once', () => {
    const {storage, store} = setup()
    const listener = jest.fn()
    store.subscribe(listener)
    store.setOnlyAuthorizedQuotes(true)
    expect(store.getOnlyAuthorizedQuotes()).toBe(true)
    expect(readDeviceState(storage).prefs.onlyAuthorizedQuotes).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    store.setOnlyAuthorizedQuotes(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('coerces non-boolean writes to a real boolean', () => {
    const {store} = setup()
    store.setOnlyAuthorizedQuotes('yes' as never)
    expect(store.getOnlyAuthorizedQuotes()).toBe(false)
  })
})

describe('device schema (quote policy)', () => {
  it('defaults old payloads without the pref to showing everything', () => {
    const raw = JSON.stringify({version: 2, activeSessionId: null, prefs: {theme: 'dark'}})
    expect(migrateDeviceState(raw).prefs.onlyAuthorizedQuotes).toBe(false)
  })

  it('round-trips an opted-in payload', () => {
    const raw = JSON.stringify({version: 2, activeSessionId: null, prefs: {onlyAuthorizedQuotes: true}})
    expect(migrateDeviceState(raw).prefs.onlyAuthorizedQuotes).toBe(true)
  })
})
