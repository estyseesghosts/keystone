// Repair X9.5: shared app-locale formatters (+ the no-`toLocale*`
// grep gate). Exact text is asserted only for `en`; every other locale
// asserts shape (non-empty, locale-appropriate separators), since ICU
// output differs across hosts.

import * as fs from 'fs'
import * as path from 'path'

import {i18n} from './i18n'
import {
  formatBytes,
  formatCompactNumber,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRelativeTime,
  resolveAppLocale,
} from './format'

const NOW = Date.parse('2026-10-20T12:00:00.000Z')
const iso = (ms: number): string => new Date(ms).toISOString()

describe('resolveAppLocale', () => {
  it('prefers the explicit arg, else the activated app locale, else en', () => {
    expect(resolveAppLocale('fr')).toBe('fr')
    expect(resolveAppLocale('  ')).toBe(i18n.locale)
    expect(resolveAppLocale(null)).toBe(i18n.locale)
    expect(resolveAppLocale(undefined)).toBe(i18n.locale)
  })
})

describe('formatRelativeTime (shared)', () => {
  it('says now under a minute (en exact)', () => {
    expect(formatRelativeTime(iso(NOW - 30_000), NOW, 'en')).toBe('now')
  })

  it('uses narrow relative minutes and hours (en exact)', () => {
    expect(formatRelativeTime(iso(NOW - 5 * 60_000), NOW, 'en')).toBe('5m ago')
    expect(formatRelativeTime(iso(NOW - 3 * 3600_000), NOW, 'en')).toBe('3h ago')
  })

  it('falls back to the locale date past a day (en exact)', () => {
    expect(formatRelativeTime(iso(NOW - 2 * 86400_000), NOW, 'en')).toBe(
      formatDate(NOW - 2 * 86400_000, 'en'),
    )
  })

  it('echoes invalid input and blanks empty input', () => {
    expect(formatRelativeTime('not-a-date', NOW, 'en')).toBe('not-a-date')
    expect(formatRelativeTime(null, NOW, 'en')).toBe('')
  })

  it.each(['ja', 'hi', 'fr'] as const)('renders a non-empty locale label (%s)', locale => {
    const min = formatRelativeTime(iso(NOW - 5 * 60_000), NOW, locale)
    expect(typeof min).toBe('string')
    expect(min.length).toBeGreaterThan(0)
    const now = formatRelativeTime(iso(NOW - 10_000), NOW, locale)
    expect(typeof now).toBe('string')
    expect(now.length).toBeGreaterThan(0)
  })
})

describe('formatDate / formatDateTime (shared)', () => {
  it('binds the date to the app locale (en exact)', () => {
    expect(formatDate('2026-10-18T12:00:00.000Z', 'en')).toBe('10/18/2026')
  })

  it.each(['ja', 'hi', 'fr'] as const)('renders a non-empty locale date (%s)', locale => {
    const out = formatDate('2026-10-18T12:00:00.000Z', locale)
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
  })

  it('renders the fr date day-first (locale-bound, not device-bound)', () => {
    expect(formatDate('2026-10-18T12:00:00.000Z', 'fr')).toBe('18/10/2026')
  })

  it('echoes invalid input, never a crash', () => {
    expect(formatDate('garbage', 'en')).toBe('garbage')
    expect(formatDateTime('garbage', 'en')).toBe('garbage')
  })

  it('renders date + time for datetimes (en shape)', () => {
    const out = formatDateTime('2026-10-18T12:00:00.000Z', 'en')
    expect(out).toContain('2026')
  })

  it.each(['ja', 'hi', 'fr'] as const)('renders a non-empty locale datetime (%s)', locale => {
    const out = formatDateTime('2026-10-18T12:00:00.000Z', locale)
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
  })
})

describe('formatNumber / formatCompactNumber (shared)', () => {
  it('formats numerals per locale (en exact)', () => {
    expect(formatNumber('en', 1234)).toBe('1,234')
    expect(formatNumber('en', 0)).toBe('0')
  })

  it.each(['ja', 'hi', 'fr'] as const)('formats numerals with locale separators (%s)', locale => {
    expect(formatNumber(locale, 1234)).toMatch(/1[\s\u00a0\u202f,]234/)
    expect(formatNumber(locale, 0)).toMatch(/0/)
  })

  it('honours explicit Intl options', () => {
    expect(formatNumber('en', 0.125, {style: 'percent', maximumFractionDigits: 1})).toBe('12.5%')
  })

  it('compacts per locale (en exact, others shape)', () => {
    expect(formatCompactNumber('en', 5500)).toBe('5.5K')
    for (const locale of ['ja', 'hi', 'fr'] as const) {
      const out = formatCompactNumber(locale, 5500)
      expect(typeof out).toBe('string')
      expect(out.length).toBeGreaterThan(0)
    }
  })
})

describe('formatBytes (shared)', () => {
  it('formats 1024-based sizes with locale numerals (en exact)', () => {
    expect(formatBytes(null, 'en')).toBeNull()
    expect(formatBytes(Number.NaN, 'en')).toBeNull()
    expect(formatBytes(-1, 'en')).toBeNull()
    expect(formatBytes(0, 'en')).toBe('0 B')
    expect(formatBytes(10, 'en')).toBe('10 B')
    expect(formatBytes(1536, 'en')).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5.0 MB')
    expect(formatBytes(10 * 1024 * 1024, 'en')).toBe('10 MB')
    expect(formatBytes(2 * 1024 * 1024 * 1024, 'en')).toBe('2.0 GB')
  })

  it('offers the IEC units the OS tools report (en exact)', () => {
    expect(formatBytes(1536, 'en', {binary: true})).toBe('1.5 KiB')
    expect(formatBytes(16 * 1024 * 1024 * 1024, 'en', {binary: true})).toBe('16 GiB')
  })

  it.each(['ja', 'hi', 'fr'] as const)('renders locale numerals in sizes (%s)', locale => {
    const out = formatBytes(1536, locale)
    expect(typeof out).toBe('string')
    expect(out).toMatch(/1[,\.]5\s?KB/)
  })
})

describe('formatDuration (shared)', () => {
  it('picks the largest whole unit (en exact)', () => {
    expect(formatDuration(300, 'en')).toBe('5 min')
    expect(formatDuration(3600, 'en')).toBe('1 hr')
    expect(formatDuration(86400, 'en')).toBe('1 day')
    expect(formatDuration(604800, 'en')).toBe('7 days')
  })

  it('reads garbage as zero seconds, never blank', () => {
    expect(formatDuration(Number.NaN, 'en').length).toBeGreaterThan(0)
    expect(formatDuration(-5, 'en').length).toBeGreaterThan(0)
  })

  it.each(['ja', 'hi', 'fr'] as const)('renders a non-empty locale duration (%s)', locale => {
    for (const seconds of [300, 3600, 86400]) {
      const out = formatDuration(seconds, locale)
      expect(typeof out).toBe('string')
      expect(out.length).toBeGreaterThan(0)
    }
  })
})

describe('no toLocale* outside the shared formatter (grep gate)', () => {
  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'locales' || entry.name === '__tests__') continue
        out.push(...walk(full))
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        out.push(full)
      }
    }
    return out
  }

  it('no .toLocaleString/.toLocaleDateString/.toLocaleTimeString call remains outside format.ts', () => {
    const shared = path.join(__dirname, 'format.ts')
    const offenders: string[] = []
    for (const file of walk(path.join(__dirname, '..'))) {
      if (file === shared) continue
      const text = fs.readFileSync(file, 'utf8')
      if (/\.toLocale(String|DateString|TimeString)\(/.test(text)) {
        offenders.push(path.relative(path.join(__dirname, '..'), file))
      }
    }
    expect(offenders).toEqual([])
  })
})
