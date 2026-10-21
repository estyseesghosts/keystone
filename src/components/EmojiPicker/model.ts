import {
  UNICODE_EMOJI_GROUPS,
  filterCustomEmojis,
  groupCustomByCategory,
  type CustomEmoji as CoreCustomEmoji,
} from '@keystone/fedi'

// Pure picker model (slice 4.5): sections for recents, server custom emoji
// (grouped by category) and Unicode categories, with search.

export type PickedEmoji = {kind: 'unicode' | 'custom'; key: string; url?: string}

export type PickerSection = {id: string; title: string; items: PickedEmoji[]}

/** A remote-host custom emoji known to the session store (`:name@host:`). */
export interface RemoteCustomEmoji {
  name: string
  host: string
  url: string
}

export const PICKER_COLUMNS = 8

/** Cap on remote-host search hits (host tables can be thousands deep). */
export const REMOTE_RESULT_CAP = 60

export function customKey(name: string): string {
  return `:${name}:`
}

/** A stored emoji key back to a pickable cell. `:name:` codes are custom
 * (art resolves from the session's custom list when present); anything
 * else is a unicode sequence. Pure. */
export function pickedFromKey(key: string): PickedEmoji {
  return key.length > 2 && key.startsWith(':') && key.endsWith(':')
    ? {kind: 'custom', key}
    : {kind: 'unicode', key}
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

/**
 * Unicode groups with hidden categories removed and pinned categories
 * ordered first (Settings → Reactions). Unknown names are ignored —
 * pinning or hiding a group the build no longer ships is a no-op,
 * never a hole in the list. Pure.
 */
export function orderedUnicodeGroups(pinned: string[], hidden: string[]): typeof UNICODE_EMOJI_GROUPS {
  const hiddenSet = new Set(hidden)
  const visible = UNICODE_EMOJI_GROUPS.filter(g => !hiddenSet.has(g.category))
  if (pinned.length === 0) return visible
  const pinnedSet = new Set(pinned)
  const rank = new Map(pinned.map((c, i) => [c, i] as const))
  const first = visible.filter(g => pinnedSet.has(g.category)).sort((a, b) => rank.get(a.category)! - rank.get(b.category)!)
  return [...first, ...visible.filter(g => !pinnedSet.has(g.category))]
}

export function buildPickerSections(opts: {
  custom: CoreCustomEmoji[]
  recents: PickedEmoji[]
  query: string
  /** Favourite emoji (Settings → Reactions): their own section, first
   * after recents, only without a query. Defaults to none. */
  favourites?: PickedEmoji[]
  /** Hidden unicode group categories (Settings → Reactions): filtered
   * out of the unicode list. Defaults to none hidden. */
  hiddenGroups?: string[]
  /** Remote-host entries from the session store (`remoteEmojis()`):
   * searched only with a query (never dumped whole) — name or host
   * matching, capped. Keys stay `:name@host:` so picks re-resolve. */
  remote?: RemoteCustomEmoji[]
  /** Pinned unicode group categories: ordered first among the unicode
   * groups. Defaults to server order. */
  pinnedGroups?: string[]
}): PickerSection[] {
  const q = opts.query.trim().replace(/^:+|:+$/g, '').toLowerCase()
  const sections: PickerSection[] = []
  const toCustom = (e: CoreCustomEmoji): PickedEmoji => ({kind: 'custom', key: customKey(e.name), url: e.url})

  if (q === '' && opts.recents.length > 0) {
    sections.push({id: 'recents', title: 'Recently used', items: opts.recents})
  }

  const favourites = opts.favourites ?? []
  if (q === '' && favourites.length > 0) {
    sections.push({id: 'favourites', title: 'Favourites', items: favourites})
  }

  const customList = filterCustomEmojis(
    opts.custom.map(e => ({name: e.name, url: e.url, category: e.category ?? null, aliases: []})),
    q,
  )
  for (const group of groupCustomByCategory(customList)) {
    sections.push({
      id: `custom:${group.category}`,
      title: group.category,
      items: group.items.map(e => toCustom({name: e.name, url: e.url, category: e.category})),
    })
  }

  // Remote-host results (WS-C): only under a query, name-or-host
  // match, capped — the store's per-host tables stay out of the
  // default view.
  if (q !== '') {
    const hits = (opts.remote ?? [])
      .filter(e => e.name.toLowerCase().includes(q) || e.host.toLowerCase().includes(q) || `${e.name}@${e.host}`.toLowerCase().includes(q))
      .slice(0, REMOTE_RESULT_CAP)
    if (hits.length > 0) {
      sections.push({
        id: 'remote',
        title: 'Remote',
        items: hits.map(e => ({kind: 'custom' as const, key: `:${e.name}@${e.host}:`, url: e.url})),
      })
    }
  }

  for (const group of orderedUnicodeGroups(opts.pinnedGroups ?? [], opts.hiddenGroups ?? [])) {
    const label = titleCase(group.category)
    const items =
      q === ''
        ? group.items
        : label.toLowerCase().includes(q) || group.category.includes(q)
          ? group.items
          : group.items.filter(e => e.includes(q))
    const clean = items.filter(e => e.trim().length > 0)
    if (clean.length > 0) {
      sections.push({
        id: `unicode:${group.category}`,
        title: label,
        items: clean.map(key => ({kind: 'unicode', key})),
      })
    }
  }
  return sections
}

export type PickerRow =
  | {type: 'header'; id: string; title: string}
  | {type: 'items'; id: string; items: PickedEmoji[]}

export function sectionsToRows(sections: PickerSection[], columns = PICKER_COLUMNS): PickerRow[] {
  const rows: PickerRow[] = []
  for (const s of sections) {
    rows.push({type: 'header', id: `h:${s.id}`, title: s.title})
    for (let i = 0; i < s.items.length; i += columns) {
      rows.push({type: 'items', id: `r:${s.id}:${i}`, items: s.items.slice(i, i + columns)})
    }
  }
  return rows
}
