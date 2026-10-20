import {createMemoryStore, type KeyValueStore} from '@keystone/fedi'

import {readDeviceState, writeDeviceState} from '#/storage'

import {createAppearanceStore, type EmojiStyle} from './appearance'

function setup(raw?: string): {storage: KeyValueStore; store: ReturnType<typeof createAppearanceStore>} {
  const storage = createMemoryStore(raw ? {'keystone.device': raw} : undefined)
  return {storage, store: createAppearanceStore(() => storage)}
}

describe('appearance store (device emoji style)', () => {
  it('defaults to openmoji on a fresh install', () => {
    const {store} = setup()
    expect(store.getEmojiStyle()).toBe('openmoji')
  })

  it('persists the selected style and notifies subscribers', () => {
    const {storage, store} = setup()
    const listener = jest.fn()
    store.subscribe(listener)
    store.setEmojiStyle('twemoji')
    expect(store.getEmojiStyle()).toBe('twemoji')
    expect(readDeviceState(storage).prefs.emojiStyle).toBe('twemoji')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not notify when the style is unchanged', () => {
    const {store} = setup()
    store.setEmojiStyle('twemoji')
    const listener = jest.fn()
    store.subscribe(listener)
    store.setEmojiStyle('twemoji')
    expect(listener).not.toHaveBeenCalled()
  })

  it('validates on write: garbage never persists', () => {
    const {storage, store} = setup()
    store.setEmojiStyle('bogus' as EmojiStyle)
    expect(store.getEmojiStyle()).toBe('openmoji')
    expect(readDeviceState(storage).prefs.emojiStyle).toBe('openmoji')
  })

  it('falls back to openmoji on a corrupt stored value', () => {
    const {store} = setup(JSON.stringify({version: 1, activeSessionId: null, prefs: {emojiStyle: 42}}))
    expect(store.getEmojiStyle()).toBe('openmoji')
  })

  it('preserves the rest of the device state on write', () => {
    const {storage, store} = setup()
    writeDeviceState(storage, {
      ...readDeviceState(storage),
      activeSessionId: 'https://a.example u1',
      prefs: {theme: 'dark', emojiStyle: 'openmoji', textScale: 1},
    })
    store.setEmojiStyle('noto')
    const state = readDeviceState(storage)
    expect(state.activeSessionId).toBe('https://a.example u1')
    expect(state.prefs.theme).toBe('dark')
    expect(state.prefs.emojiStyle).toBe('noto')
  })
})

describe('appearance store (colour mode)', () => {
  it('defaults to system on a fresh install', () => {
    const {store} = setup()
    expect(store.getColorMode()).toBe('system')
  })

  it('persists the selected mode and notifies once', () => {
    const {storage, store} = setup()
    const listener = jest.fn()
    store.subscribe(listener)
    store.setColorMode('dark')
    expect(store.getColorMode()).toBe('dark')
    expect(readDeviceState(storage).prefs.theme).toBe('dark')
    expect(listener).toHaveBeenCalledTimes(1)
    store.setColorMode('dark')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('falls back to system on garbage', () => {
    const {storage, store} = setup()
    store.setColorMode('bogus' as never)
    expect(store.getColorMode()).toBe('system')
    expect(readDeviceState(storage).prefs.theme).toBe('system')
  })
})

describe('appearance store (text scale)', () => {
  it('defaults to 1x on a fresh install', () => {
    const {store} = setup()
    expect(store.getTextScale()).toBe(1)
  })

  it('persists and clamps to the 0.5–4x band', () => {
    const {storage, store} = setup()
    store.setTextScale(2)
    expect(store.getTextScale()).toBe(2)
    expect(readDeviceState(storage).prefs.textScale).toBe(2)
    store.setTextScale(99)
    expect(store.getTextScale()).toBe(4)
    store.setTextScale(0)
    expect(store.getTextScale()).toBe(0.5)
    store.setTextScale(Number.NaN)
    expect(store.getTextScale()).toBe(1)
  })
})
