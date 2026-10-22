import {
  STORAGE_VERSION,
  accountKeyFor,
  accountStateSchema,
  defaultAccountState,
  defaultDeviceState,
  deviceStateSchema,
  migrateDeviceState,
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
      prefs: {theme: 'dark', emojiStyle: 'openmoji', textScale: 1, contentMode: 'auto', onlyAuthorizedQuotes: false, dataSaver: false},
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

describe('migrateDeviceState (v1 → v2)', () => {
  it('migrates a full v1 payload, carrying every pref', () => {
    const raw = JSON.stringify({
      version: 1,
      activeSessionId: 'https://a.example u1',
      prefs: {theme: 'dark', emojiStyle: 'twemoji', textScale: 2},
    })
    expect(migrateDeviceState(raw)).toEqual({
      version: 2,
      activeSessionId: 'https://a.example u1',
      prefs: {theme: 'dark', emojiStyle: 'twemoji', textScale: 2, contentMode: 'auto', onlyAuthorizedQuotes: false, dataSaver: false},
    })
  })

  it('migrates a sparse v1 payload with defaults', () => {
    const raw = JSON.stringify({version: 1, activeSessionId: null})
    expect(migrateDeviceState(raw)).toEqual(defaultDeviceState)
  })

  it('passes a v2 payload through untouched', () => {
    const raw = JSON.stringify({
      version: 2,
      activeSessionId: null,
      prefs: {theme: 'light', emojiStyle: 'noto', textScale: 1.5, contentMode: 'plain', onlyAuthorizedQuotes: true, dataSaver: false},
    })
    expect(migrateDeviceState(raw)).toEqual(JSON.parse(raw))
  })

  it('falls back on corrupt, versioned-junk, or garbage payloads', () => {
    expect(migrateDeviceState(null)).toEqual(defaultDeviceState)
    expect(migrateDeviceState('{nope')).toEqual(defaultDeviceState)
    expect(migrateDeviceState(JSON.stringify({version: 999}))).toEqual(defaultDeviceState)
    expect(migrateDeviceState(JSON.stringify({version: 1, activeSessionId: 42}))).toEqual(
      defaultDeviceState,
    )
  })

  it('falls back on an unknown stored content mode', () => {
    const raw = JSON.stringify({version: 2, activeSessionId: null, prefs: {contentMode: 'mfm'}})
    expect(migrateDeviceState(raw)).toEqual(defaultDeviceState)
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

describe('defaultAccountState (WS-B: contentMode is device-local)', () => {
  it('carries no prefs — the old contentMode default was invalid', () => {
    expect(defaultAccountState).toEqual({version: STORAGE_VERSION, prefs: {}})
  })

  it('strips unknown account prefs keys on read', () => {
    const raw = JSON.stringify({version: 2, prefs: {contentMode: 'mfm'}})
    expect(parseOrFallback(accountStateSchema, raw, defaultAccountState)).toEqual(
      defaultAccountState,
    )
  })
})
