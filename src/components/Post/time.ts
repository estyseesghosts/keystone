// Relative timestamps for post headers (Keystone v1 `time.ts` behavior).
// Pure: `<60s -> "now"`; under an hour / a day, the narrow
// `Intl.RelativeTimeFormat` ("5m ago"); older, the locale date. Invalid
// input echoes back (never a crash, never blank). `locale`/`nowMs` are
// injectable for tests; the UI leaves both undefined (device locale).

export function formatRelativeTime(
  createdAt: string | null,
  nowMs = Date.now(),
  locale?: string,
): string {
  if (!createdAt) return ''
  const then = Date.parse(createdAt)
  if (Number.isNaN(then)) return createdAt
  const diffSec = Math.max(0, (nowMs - then) / 1000)
  if (diffSec < 60) return 'now'
  const min = Math.floor(diffSec / 60)
  if (min < 60) {
    try {
      return new Intl.RelativeTimeFormat(locale, {style: 'narrow'}).format(-min, 'minute')
    } catch {
      return `${min}m`
    }
  }
  const hours = Math.floor(min / 60)
  if (hours < 24) {
    try {
      return new Intl.RelativeTimeFormat(locale, {style: 'narrow'}).format(-hours, 'hour')
    } catch {
      return `${hours}h`
    }
  }
  return new Date(then).toLocaleDateString(locale)
}
