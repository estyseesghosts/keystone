// Autocomplete trigger helpers for the Explore search field (v1
// `routes/Explore.tsx` pattern: a trailing `#tag` or `@account` token
// before the caret can be completed). Pure string functions — tested,
// no backend here.

export interface SuggestTrigger {
  kind: 'tag' | 'account'
  /** Query prefix after the #/@. */
  prefix: string
  /** Offset where the trigger token starts. */
  start: number
}

/** The trailing #/@ token before the cursor, if it can be completed. */
export function suggestTrigger(value: string, cursor: number): SuggestTrigger | null {
  const before = value.slice(0, Math.max(0, Math.min(cursor, value.length)))
  const m = /([#@])([^\s#@]+)$/.exec(before)
  if (!m) return null
  return {
    kind: m[1] === '#' ? 'tag' : 'account',
    prefix: m[2],
    start: m.index,
  }
}

/** Splice the completion over the trigger token, leaving one space. */
export function applySuggestion(
  value: string,
  cursor: number,
  trigger: SuggestTrigger,
  insert: string,
): {value: string; cursor: number} {
  const head = `${value.slice(0, trigger.start)}${insert}`
  const tail = value.slice(cursor)
  const spaced = tail.startsWith(' ') ? head : `${head} `
  return {value: `${spaced}${tail}`, cursor: spaced.length}
}
