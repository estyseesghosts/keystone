// Page editor local drafts (P6.5 Pages, slice 4; PG-8). One draft per
// session + page (`pageId` or `'new'` for unsaved pages), MMKV account
// scope like `drafts.ts`. The editor debounces writes (1 s); on open, a
// draft newer than `saved.updatedAt` offers Restore / Discard; a
// successful save clears the row. Blocks validate loosely (known kinds
// with string ids survive; anything else is dropped, never a crash).

import {z} from 'zod'

import type {KeyValueStore, PageBlock, PageFont} from '@keystone/fedi'

import type {PageForm} from '#/state/pageEditor'

export const PAGE_DRAFTS_VERSION = 1 as const

const blockSchema = z
  .object({id: z.string(), kind: z.string()})
  .passthrough()
  .refine(
    b => b.kind === 'text' || b.kind === 'section' || b.kind === 'image' || b.kind === 'note' || b.kind === 'unknown',
    {message: 'unknown page block kind'},
  )

const formSchema = z.object({
  title: z.string(),
  summary: z.string().nullable(),
  name: z.string(),
  font: z.enum(['sans-serif', 'serif']),
  alignCenter: z.boolean(),
  hideTitleWhenPinned: z.boolean(),
  eyeCatchingImageId: z.string().nullable(),
  blocks: z.array(z.unknown()),
})

const rowSchema = z.object({
  version: z.literal(PAGE_DRAFTS_VERSION),
  updatedAt: z.number(),
  form: formSchema,
})

export type PageDraftRow = {
  version: typeof PAGE_DRAFTS_VERSION
  updatedAt: number
  form: PageForm
}

export function pageDraftKeyFor(sessionId: string, key: string): string {
  if (!sessionId) throw new Error('pageDraftKeyFor requires a sessionId')
  if (!key) throw new Error('pageDraftKeyFor requires a key')
  return `keystone.pagedraft.${sessionId}.${key}`
}

/** Blocks that survive the loose guard (known kind + string id). Pure. */
export function sanitizePageBlocks(blocks: unknown[]): PageBlock[] {
  const out: PageBlock[] = []
  for (const raw of blocks) {
    const parsed = blockSchema.safeParse(raw)
    if (parsed.success) out.push(parsed.data as unknown as PageBlock)
  }
  return out
}

export function savePageDraft(
  store: KeyValueStore,
  sessionId: string,
  key: string,
  form: PageForm,
  now: number = Date.now(),
): boolean {
  try {
    store.setItem(pageDraftKeyFor(sessionId, key), JSON.stringify({version: PAGE_DRAFTS_VERSION, updatedAt: now, form}))
    return true
  } catch {
    return false
  }
}

export function loadPageDraft(
  store: KeyValueStore,
  sessionId: string,
  key: string,
): PageDraftRow | null {
  let raw: string | null = null
  try {
    raw = store.getItem(pageDraftKeyFor(sessionId, key))
  } catch {
    return null
  }
  if (raw == null) return null
  try {
    const parsed = rowSchema.parse(JSON.parse(raw))
    return {
      version: parsed.version,
      updatedAt: parsed.updatedAt,
      form: {
        title: parsed.form.title,
        summary: parsed.form.summary,
        name: parsed.form.name,
        font: parsed.form.font as PageFont,
        alignCenter: parsed.form.alignCenter,
        hideTitleWhenPinned: parsed.form.hideTitleWhenPinned,
        eyeCatchingImageId: parsed.form.eyeCatchingImageId,
        blocks: sanitizePageBlocks(parsed.form.blocks),
      },
    }
  } catch {
    return null
  }
}

export function clearPageDraft(store: KeyValueStore, sessionId: string, key: string): void {
  try {
    store.removeItem(pageDraftKeyFor(sessionId, key))
  } catch {
    // Best-effort (sign-out/save-complete cleanup).
  }
}
