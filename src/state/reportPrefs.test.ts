import {createMemoryStore} from '@keystone/fedi'

import {createReportPrefsStore, parseLastReportCategory} from './reportPrefs'

describe('report chooser prefs (clickstone §1.5)', () => {
  it('parses only a known category — malformed storage is no choice', () => {
    expect(parseLastReportCategory('spam')).toBe('spam')
    expect(parseLastReportCategory('violation')).toBe('violation')
    expect(parseLastReportCategory('harassment')).toBeNull()
    expect(parseLastReportCategory('')).toBeNull()
    expect(parseLastReportCategory(null)).toBeNull()
  })

  it('remembers the last used category across store instances', () => {
    const storage = createMemoryStore()
    const first = createReportPrefsStore(() => storage)
    expect(first.get()).toBeNull()
    first.set('legal')
    expect(first.get()).toBe('legal')
    // A fresh store (next launch) reads the persisted value.
    expect(createReportPrefsStore(() => storage).get()).toBe('legal')
  })

  it('notifies subscribers only on a real change', () => {
    const storage = createMemoryStore()
    const store = createReportPrefsStore(() => storage)
    const seen = jest.fn()
    store.subscribe(seen)
    store.set('spam')
    store.set('spam')
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
