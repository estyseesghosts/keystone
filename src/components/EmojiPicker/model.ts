import {
  UNICODE_EMOJI_GROUPS,
  filterCustomEmojis,
  groupCustomByCategory,
  type CustomEmoji as CoreCustomEmoji,
} from '@keystone/fedi'
import {msg} from '@lingui/macro'

import {i18n} from '#/locale/i18n'

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
 * Section order (no query): favourites (when populated — always above
 * pinned groups), recents (when populated), pinned groups in pin order
 * (custom categories before unicode ones on a name clash), unpinned
 * custom groups in server order, unpinned unicode groups in build order.
 * Hidden categories (custom or unicode, by name) never appear; unknown
 * pinned/hidden names are no-ops, never holes. Under a query, favourites
 * and recents hide and only matching groups appear (in the same relative
 * order). Pure.
 */

export function buildPickerSections(opts: {
  custom: CoreCustomEmoji[]
  recents: PickedEmoji[]
  query: string
  /** Favourite emoji (Settings → Reactions): their own section, first
   * (above recents and every pinned group), only without a query and only
   * when populated. Defaults to none. */
  favourites?: PickedEmoji[]
  /** Hidden group categories (custom or unicode, by name — Settings →
   * Reactions): filtered out everywhere. Defaults to none hidden. */
  hiddenGroups?: string[]
  /** Remote-host entries from the session store (`remoteEmojis()`):
   * searched only with a query (never dumped whole) — name or host
   * matching, capped. Keys stay `:name@host:` so picks re-resolve. */
  remote?: RemoteCustomEmoji[]
  /** Pinned group categories (custom or unicode, by name): ordered first
   * as one block, in pin order. Defaults to server/build order. */
  pinnedGroups?: string[]
}): PickerSection[] {
  const q = opts.query.trim().replace(/^:+|:+$/g, '').toLowerCase()
  const sections: PickerSection[] = []
  const toCustom = (e: CoreCustomEmoji): PickedEmoji => ({kind: 'custom', key: customKey(e.name), url: e.url})

  const favourites = opts.favourites ?? []
  if (q === '' && favourites.length > 0) {
    sections.push({id: 'favourites', title: i18n._(msg`Favourites`), items: favourites})
  }

  if (q === '' && opts.recents.length > 0) {
    sections.push({id: 'recents', title: i18n._(msg`Recently used`), items: opts.recents})
  }

  const hidden = new Set(opts.hiddenGroups ?? [])
  const pinned = opts.pinnedGroups ?? []
  const pinnedSet = new Set(pinned)
  const customGroups = groupCustomByCategory(
    filterCustomEmojis(
      opts.custom.map(e => ({name: e.name, url: e.url, category: e.category ?? null, aliases: []})),
      q,
    ),
  ).filter(g => !hidden.has(g.category))
  const uniGroups = UNICODE_EMOJI_GROUPS.filter(g => !hidden.has(g.category))
  const uniItems = (group: (typeof UNICODE_EMOJI_GROUPS)[number]): string[] => {
    const label = titleCase(group.category)
    const items =
      q === ''
        ? group.items
        : label.toLowerCase().includes(q) || group.category.includes(q)
          ? group.items
          : group.items.filter(e => e.includes(q))
    return items.filter(e => e.trim().length > 0)
  }
  const pushCustom = (category: string): void => {
    const group = customGroups.find(g => g.category === category)
    if (group) {
      sections.push({
        id: `custom:${group.category}`,
        title: group.category,
        items: group.items.map(e => toCustom({name: e.name, url: e.url, category: e.category})),
      })
    }
  }
  const pushUnicode = (category: string): void => {
    const group = uniGroups.find(g => g.category === category)
    if (!group) return
    const clean = uniItems(group)
    if (clean.length > 0) {
      sections.push({
        id: `unicode:${group.category}`,
        title: titleCase(group.category),
        items: clean.map(key => ({kind: 'unicode' as const, key})),
      })
    }
  }

  // Pinned block in pin order (custom categories before unicode ones on
  // a name clash; unknown names are no-ops).
  for (const name of pinned) {
    pushCustom(name)
    pushUnicode(name)
  }
  // Unpinned customs in server order, then unpinned unicodes in build order.
  for (const group of customGroups) {
    if (!pinnedSet.has(group.category)) pushCustom(group.category)
  }
  for (const group of uniGroups) {
    if (!pinnedSet.has(group.category)) pushUnicode(group.category)
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
        title: i18n._(msg`Remote`),
        items: hits.map(e => ({kind: 'custom' as const, key: `:${e.name}@${e.host}:`, url: e.url})),
      })
    }
  }

  return sections
}

export type PickerRow =
  | {type: 'header'; id: string; sectionId: string; title: string; count: number}
  | {type: 'items'; id: string; items: PickedEmoji[]}

export function sectionsToRows(
  sections: PickerSection[],
  columns = PICKER_COLUMNS,
  collapsed: ReadonlySet<string> = EMPTY_SET,
): PickerRow[] {
  const rows: PickerRow[] = []
  for (const s of sections) {
    rows.push({type: 'header', id: `h:${s.id}`, sectionId: s.id, title: s.title, count: s.items.length})
    if (collapsed.has(s.id)) continue
    for (let i = 0; i < s.items.length; i += columns) {
      rows.push({type: 'items', id: `r:${s.id}:${i}`, items: s.items.slice(i, i + columns)})
    }
  }
  return rows
}

const EMPTY_SET: ReadonlySet<string> = new Set()
