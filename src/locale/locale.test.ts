import {createMemoryStore} from '@keystone/fedi'

import {
  DEFAULT_LOCALE,
  createLocaleStore,
  formatCount,
  isLocaleCode,
  parseLocale,
} from './i18n'

describe('parseLocale', () => {
  it('accepts every supported code (JSON-encoded or bare)', () => {
    expect(parseLocale(JSON.stringify('fr'))).toBe('fr')
    expect(parseLocale(JSON.stringify('yue-HK'))).toBe('yue-HK')
    expect(parseLocale('ja')).toBe('ja')
  })
  it('falls back to en for null, garbage, and unknown codes', () => {
    expect(parseLocale(null)).toBe(DEFAULT_LOCALE)
    expect(parseLocale('not-json{{{')).toBe(DEFAULT_LOCALE)
    expect(parseLocale(JSON.stringify('xx'))).toBe(DEFAULT_LOCALE)
    expect(parseLocale(JSON.stringify(42))).toBe(DEFAULT_LOCALE)
  })
})

describe('isLocaleCode', () => {
  it('validates the 8 carried locales only', () => {
    for (const code of ['en', 'fr', 'de', 'zh-CN', 'zh-TW', 'yue-HK', 'ja', 'hi']) {
      expect(isLocaleCode(code)).toBe(true)
    }
    expect(isLocaleCode('en-US')).toBe(false)
    expect(isLocaleCode('')).toBe(false)
  })
})

describe('createLocaleStore', () => {
  it('reads the stored locale and notifies on change', () => {
    const storage = createMemoryStore()
    const store = createLocaleStore(() => storage)
    expect(store.get()).toBe('en')
    const seen: string[] = []
    const unsub = store.subscribe(() => seen.push(store.get()))
    store.set('de')
    expect(store.get()).toBe('de')
    expect(storage.getItem('keystone.locale')).toBe(JSON.stringify('de'))
    expect(seen).toEqual(['de'])
    unsub()
  })
  it('ignores unknown codes and no-op sets', () => {
    const storage = createMemoryStore()
    const store = createLocaleStore(() => storage)
    let calls = 0
    store.subscribe(() => calls++)
    // @ts-expect-error invalid code on purpose
    store.set('xx')
    expect(store.get()).toBe('en')
    store.set('en')
    expect(calls).toBe(0)
  })
  it('uses its own storage key (never the feedprefs key)', () => {
    const storage = createMemoryStore()
    storage.setItem('keystone.feedprefs', JSON.stringify({showLocal: true}))
    const store = createLocaleStore(() => storage)
    expect(store.get()).toBe('en')
  })
})

describe('formatCount', () => {
  it('formats numerals per locale, raw on failure', () => {
    expect(formatCount('en', 1234)).toBe('1,234')
    expect(typeof formatCount('hi', 1234)).toBe('string')
    expect(formatCount('en', 0)).toBe('0')
  })
})
