// Relative timestamps for post headers. Pure.
export function formatRelativeTime(createdAt: string | null, nowMs = Date.now()): string {
  if (!createdAt) return ''
  const then = Date.parse(createdAt)
  if (Number.isNaN(then)) return ''
  const diff = Math.max(0, nowMs - then)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const date = new Date(then)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
