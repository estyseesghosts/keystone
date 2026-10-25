// Locale-aware formatting (repair X9.5): the ONE place `Intl.*` is
// bound in `src/`. Every formatter reads the APP locale — an explicit
// argument, else `i18n.locale` after activation — never the device
// locale, with an `en` fallback. Pure functions; callers in components
// pass `useI18n().locale` (reactive) or `useLocale()` so a locale switch
// re-renders with fresh strings.
//
// Relative times use `Intl.RelativeTimeFormat` (no literals): past ages
// read narrow ("5m ago"), the first minute reads the locale's "now".
// Counts reuse `formatCount`/`formatCompactCount` from `./i18n` (never
// duplicated here). Unknown/absent sizes return `null` — the caller owns
// the honest unknown label, never a fabricated zero.

import {
  formatCompactCount,
  formatCount,
  i18n,
  isLocaleCode,
  type LocaleCode,
} from './i18n'

/** App locale tag for `Intl.*`: explicit arg wins, else the activated
 * app locale, else `en`. Pure. BCP-47 passes straight through (`yue-HK`
 * included); anything `Intl` rejects falls back per call site. */
export function resolveAppLocale(explicit?: string | null): string {
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit
  try {
    const active: unknown = (i18n as {locale?: unknown} | null | undefined)?.locale
    if (typeof active === 'string' && active.trim() !== '') return active
  } catch {
    // No activated locale (bare import order): fall through to English.
  }
  return 'en'
}

/** Past-facing relative age (Keystone v1 `time.ts` behavior): `<60s` is
 * the locale's "now", under an hour/day narrow `Intl.RelativeTimeFormat`,
 * older the locale date. Futures clamp to "now" (polls own the
 * future-facing labels). Invalid input echoes back, empty stays empty —
 * never a crash, never blank. Pure. */
export function formatRelativeTime(
  createdAt: string | null,
  nowMs: number = Date.now(),
  locale?: string | null,
): string {
  if (!createdAt) return ''
  const then = Date.parse(createdAt)
  if (Number.isNaN(then)) return createdAt
  const tag = resolveAppLocale(locale)
  const diffSec = Math.max(0, (nowMs - then) / 1000)
  if (diffSec < 60) {
    try {
      return new Intl.RelativeTimeFormat(tag, {numeric: 'auto'}).format(0, 'second')
    } catch {
      return 'now'
    }
  }
  const min = Math.floor(diffSec / 60)
  if (min < 60) {
    try {
      return new Intl.RelativeTimeFormat(tag, {style: 'narrow'}).format(-min, 'minute')
    } catch {
      return `${min}m`
    }
  }
  const hours = Math.floor(min / 60)
  if (hours < 24) {
    try {
      return new Intl.RelativeTimeFormat(tag, {style: 'narrow'}).format(-hours, 'hour')
    } catch {
      return `${hours}h`
    }
  }
  return formatDate(then, tag)
}

/** Locale date (`toLocaleDateString` equivalent, app-locale-bound).
 * Invalid input echoes back, never a crash. Pure. */
export function formatDate(
  when: string | number | Date,
  locale?: string | null,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const tag = resolveAppLocale(locale)
  const date = when instanceof Date ? when : new Date(when)
  if (Number.isNaN(date.getTime())) return typeof when === 'string' ? when : String(when)
  try {
    return new Intl.DateTimeFormat(tag, opts).format(date)
  } catch {
    try {
      return date.toISOString().slice(0, 10)
    } catch {
      return typeof when === 'string' ? when : String(when)
    }
  }
}

/** Locale date + time (`toLocaleString` equivalent, app-locale-bound).
 * The MFM `unixtime` node renders through here. Invalid input echoes
 * back, never a crash. Pure. */
export function formatDateTime(
  when: string | number | Date,
  locale?: string | null,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const tag = resolveAppLocale(locale)
  const date = when instanceof Date ? when : new Date(when)
  if (Number.isNaN(date.getTime())) return typeof when === 'string' ? when : String(when)
  try {
    return new Intl.DateTimeFormat(tag, opts).format(date)
  } catch {
    try {
      return date.toISOString()
    } catch {
      return typeof when === 'string' ? when : String(when)
    }
  }
}

/** Locale-aware number; raw numerals on any failure. Pure. Without
 * options this reuses `formatCount` (never duplicated). */
export function formatNumber(
  locale: string | null | undefined,
  n: number,
  opts?: Intl.NumberFormatOptions,
): string {
  const tag = resolveAppLocale(locale)
  try {
    if (opts === undefined && isLocaleCode(tag)) return formatCount(tag as LocaleCode, n)
    return new Intl.NumberFormat(tag, opts).format(n)
  } catch {
    return String(n)
  }
}

/** Locale-aware compact number (`5.5K`); raw numerals on any failure.
 * Pure. Without options this reuses `formatCompactCount` (never
 * duplicated). */
export function formatCompactNumber(locale: string | null | undefined, n: number): string {
  const tag = resolveAppLocale(locale)
  try {
    if (isLocaleCode(tag)) return formatCompactCount(tag as LocaleCode, n)
    return new Intl.NumberFormat(tag, {notation: 'compact', maximumFractionDigits: 1}).format(n)
  } catch {
    return String(n)
  }
}

/** Human byte size, 1024-based with locale numerals (`1.5 KB`); `null`
 * for null/non-finite/negative input (honestly unknown — the caller owns
 * the label). `binary` selects the IEC units the OS tools report
 * (`KiB`/`MiB`/`GiB`, Misskey hardware snapshot); default is the SI-ish
 * `KB`/`MB`/`GB` file sizes. Pure. */
export function formatBytes(
  size: number | null,
  locale?: string | null,
  opts?: {binary?: boolean},
): string | null {
  if (size === null || size === undefined || !Number.isFinite(size) || size < 0) return null
  const tag = resolveAppLocale(locale)
  const units = opts?.binary ? ['B', 'KiB', 'MiB', 'GiB', 'TiB'] : ['B', 'KB', 'MB', 'GB', 'TB']
  const num = (value: number, fractionDigits: number): string => {
    try {
      return new Intl.NumberFormat(tag, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value)
    } catch {
      return value.toFixed(fractionDigits)
    }
  }
  if (size < 1024) return `${num(size, 0)} ${units[0]}`
  let value = size / 1024
  let unit = 1
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${num(value, value < 10 ? 1 : 0)} ${units[unit]}`
}

const DURATION_UNITS: Array<{unit: 'day' | 'hour' | 'minute' | 'second'; seconds: number}> = [
  {unit: 'day', seconds: 86400},
  {unit: 'hour', seconds: 3600},
  {unit: 'minute', seconds: 60},
  {unit: 'second', seconds: 1},
]

/** Whole-unit locale duration (`5 min`, `1 day`): the largest unit with
 * a non-zero whole value wins, formatted short in the app locale.
 * Non-finite/negative input reads as zero seconds, never blank. Pure. */
export function formatDuration(seconds: number, locale?: string | null): string {
  const tag = resolveAppLocale(locale)
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const picked = DURATION_UNITS.find(u => total >= u.seconds) ?? DURATION_UNITS[DURATION_UNITS.length - 1]
  const value = Math.floor(total / picked.seconds)
  try {
    return new Intl.NumberFormat(tag, {
      style: 'unit',
      unit: picked.unit,
      unitDisplay: 'short',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${value} ${picked.unit}${value === 1 ? '' : 's'}`
  }
}
