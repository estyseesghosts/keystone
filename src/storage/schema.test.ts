import {
  STORAGE_VERSION,
  accountKeyFor,
  accountStateSchema,
  defaultAccountState,
  defaultDeviceState,
  deviceStateSchema,
  parseOrFallback,
} from './schema'

describe('parseOrFallback', () => {
  it('parses a valid device payload', () => {
    const raw = JSON.stringify({
      version: STORAGE_VERSION,
      activeSessionId: 'https://a.example u1',
      prefs: {theme: 'dark'},
    })
    expect(parseOrFallback(deviceStateSchema, raw, defaultDeviceState)).toEqual({
      version: STORAGE_VERSION,
      activeSessionId: 'https://a.example u1',
      prefs: {theme: 'dark', emojiStyle: 'openmoji', textScale: 1},
    })
  })

  it('round-trips a stored text scale', () => {
    const raw = JSON.stringify({
      version: STORAGE_VERSION,
      activeSessionId: null,
      prefs: {theme: 'system', textScale: 2},
    })
    expect(parseOrFallback(deviceStateSchema, raw, defaultDeviceState).prefs.textScale).toBe(2)
  })

  it('falls back on an out-of-range text scale', () => {
    const raw = JSON.stringify({
      version: STORAGE_VERSION,
      activeSessionId: null,
      prefs: {theme: 'system', textScale: 42},
    })
    expect(parseOrFallback(deviceStateSchema, raw, defaultDeviceState)).toEqual(
      defaultDeviceState,
    )
  })

  it('round-trips a stored emoji style', () => {
    const raw = JSON.stringify({
      version: STORAGE_VERSION,
      activeSessionId: null,
      prefs: {theme: 'system', emojiStyle: 'twemoji'},
    })
    expect(parseOrFallback(deviceStateSchema, raw, defaultDeviceState).prefs.emojiStyle).toBe(
      'twemoji',
    )
  })

  it('falls back to openmoji on an unknown emoji style', () => {
    const raw = JSON.stringify({
      version: STORAGE_VERSION,
      activeSessionId: null,
      prefs: {theme: 'system', emojiStyle: 'bogus'},
    })
    expect(parseOrFallback(deviceStateSchema, raw, defaultDeviceState)).toEqual(
      defaultDeviceState,
    )
  })

  it('falls back on missing keys', () => {
    expect(parseOrFallback(deviceStateSchema, null, defaultDeviceState)).toEqual(
      defaultDeviceState,
    )
  })

  it('falls back on corrupt JSON', () => {
    expect(parseOrFallback(deviceStateSchema, '{nope', defaultDeviceState)).toEqual(
      defaultDeviceState,
    )
  })

  it('falls back on a wrong version', () => {
    const raw = JSON.stringify({version: 999, activeSessionId: null, prefs: {}})
    expect(parseOrFallback(deviceStateSchema, raw, defaultDeviceState)).toEqual(
      defaultDeviceState,
    )
  })

  it('falls back on garbage shapes', () => {
    const raw = JSON.stringify({version: 1, activeSessionId: 42, prefs: 'dark'})
    expect(parseOrFallback(deviceStateSchema, raw, defaultDeviceState)).toEqual(
      defaultDeviceState,
    )
  })

  it('fills defaults for missing prefs', () => {
    const raw = JSON.stringify({version: STORAGE_VERSION, activeSessionId: null})
    expect(parseOrFallback(deviceStateSchema, raw, defaultDeviceState)).toEqual(
      defaultDeviceState,
    )
  })

  it('falls back on valid JSON of the wrong kind', () => {
    expect(parseOrFallback(deviceStateSchema, '[]', defaultDeviceState)).toEqual(
      defaultDeviceState,
    )
    expect(parseOrFallback(accountStateSchema, '"x"', defaultAccountState)).toEqual(
      defaultAccountState,
    )
  })
})

describe('accountKeyFor', () => {
  it('keys per session id — same user on two origins never aliases', () => {
    const a = accountKeyFor('https://a.example u1')
    const b = accountKeyFor('https://b.example u1')
    expect(a).not.toBe(b)
    expect(a).toContain('https://a.example')
    expect(b).toContain('https://b.example')
  })
})
