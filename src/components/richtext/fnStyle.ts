// MFM `fn` decoration style policy (D3.5 split from `RichText.tsx`).
// Allow-listed colors, fonts, and arg plumbing for `$[name …]`
// decorations — pure, no imports. Unknown shapes degrade to the children
// at the call site; content is never dropped, never faked.

/** MFM decoration args (v1 `MfmRenderer` parity, real mfm-js 0.27 shapes):
 * `$[name.key=value …]` string values, `$[name.value …]` flag keys
 * (`{value: true}`), then any first string value. Unknown shapes degrade
 * to the children — content is never dropped, never faked. */
export function fnArg(args: Record<string, string | true>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  for (const key of Object.keys(args)) {
    if (args[key] === true && key.length > 0) return key
  }
  for (const value of Object.values(args)) {
    if (typeof value === 'string') return value
  }
  return null
}

export function clampNum(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Allow-listed MFM color: `#rgb`/`#rrggbb` only. Anything else (names,
 * functions, URLs) is rejected — never a raw server string in a style. */
export function safeHexColor(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : null
}

/** Allow-listed MFM font: only families with a safe cross-platform
 * mapping render; the rest degrade to the default. */
export function safeFontFamily(raw: string | null): 'monospace' | 'serif' | null {
  const name = (raw ?? '').trim().toLowerCase()
  if (name === 'monospace') return 'monospace'
  if (name === 'serif') return 'serif'
  return null
}

/** Heading size step over the body size, by level. */
export function headingDelta(level: number): number {
  switch (level) {
    case 1:
      return 6
    case 2:
      return 4
    case 3:
      return 2
    case 4:
      return 1
    case 5:
      return 0
    default:
      return -1
  }
}
