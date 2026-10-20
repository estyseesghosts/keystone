import {createMemoryStore, type KeyValueStore} from '@keystone/fedi'

import {
  __setStorageForTests,
  appStorage,
  appTokenVault,
  readAccountState,
  readDeviceState,
  writeAccountState,
  writeDeviceState,
  defaultDeviceState,
} from './index'

describe('device scope', () => {
  it('reads defaults from an empty store', () => {
    expect(readDeviceState(createMemoryStore())).toEqual(defaultDeviceState)
  })

  it('round-trips write/read', () => {
    const store = createMemoryStore()
    writeDeviceState(store, {
      version: 1,
      activeSessionId: 'https://a.example u1',
      prefs: {theme: 'dark', emojiStyle: 'twemoji', textScale: 1},
    })
    expect(readDeviceState(store)).toEqual({
      version: 1,
      activeSessionId: 'https://a.example u1',
      prefs: {theme: 'dark', emojiStyle: 'twemoji', textScale: 1},
    })
  })

  it('invalid stored data falls back to safe defaults', () => {
    const store = createMemoryStore()
    store.setItem('keystone.device', '{corrupt')
    expect(readDeviceState(store)).toEqual(defaultDeviceState)
    store.setItem('keystone.device', JSON.stringify({version: 2, activeSessionId: 7}))
    expect(readDeviceState(store)).toEqual(defaultDeviceState)
  })
})

describe('per-account scope', () => {
  it('round-trips per session id with isolation', () => {
    const store = createMemoryStore()
    expect(readAccountState(store, 'https://a.example u1').prefs.contentMode).toBe('mfm')
    writeAccountState(store, 'https://a.example u1', {
      version: 1,
      prefs: {contentMode: 'plain'},
    })
    expect(readAccountState(store, 'https://a.example u1').prefs.contentMode).toBe('plain')
    // Another session (even another origin) is untouched.
    expect(readAccountState(store, 'https://b.example u1').prefs.contentMode).toBe('mfm')
  })

  it('invalid stored data falls back to safe defaults', () => {
    const store: KeyValueStore = createMemoryStore()
    store.setItem('keystone.account.https://a.example u1', 'nope{')
    expect(readAccountState(store, 'https://a.example u1').prefs.contentMode).toBe('mfm')
  })
})

describe('app singletons', () => {
  it('appStorage persists through the MMKV mock', () => {
    const store = appStorage()
    store.setItem('probe', '1')
    expect(appStorage().getItem('probe')).toBe('1')
  })

  it('appTokenVault round-trips (expo-secure-store mock)', async () => {
    const vault = appTokenVault()
    await vault.setToken('https://a.example u1', 'https://a.example', 'tok')
    expect(await vault.getToken('https://a.example u1', 'https://a.example')).toBe('tok')
    await vault.removeToken('https://a.example u1', 'https://a.example')
    expect(await vault.getToken('https://a.example u1', 'https://a.example')).toBeNull()
  })

  it('__setStorageForTests swaps the singletons', () => {
    const before = appStorage()
    const mem = createMemoryStore()
    __setStorageForTests({storage: mem})
    expect(appStorage()).toBe(mem)
    __setStorageForTests({storage: before})
    expect(appStorage()).toBe(before)
  })
})
