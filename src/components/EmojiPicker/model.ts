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

export const PICKER_COLUMNS = 8

export function customKey(name: string): string {
  return `:${name}:`
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

export function buildPickerSections(opts: {
  custom: CoreCustomEmoji[]
  recents: PickedEmoji[]
  query: string
}): PickerSection[] {
  const q = opts.query.trim().replace(/^:+|:+$/g, '').toLowerCase()
  const sections: PickerSection[] = []
  const toCustom = (e: CoreCustomEmoji): PickedEmoji => ({kind: 'custom', key: customKey(e.name), url: e.url})

  if (q === '' && opts.recents.length > 0) {
    sections.push({id: 'recents', title: 'Recently used', items: opts.recents})
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

  for (const group of UNICODE_EMOJI_GROUPS) {
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
