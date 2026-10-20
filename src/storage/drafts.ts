import {z} from 'zod'

import type {KeyValueStore} from '@keystone/fedi'

import {parseOrFallback} from './schema'

// Local composer drafts (slice 4.3). One list per session id, persisted
// through the app KeyValueStore (MMKV). Keyed by the session id (which
// embeds the origin), so one account's drafts never surface for another.
// Attachments are NOT stored: server media ids belong to a server-side
// upload that may expire, so a restored draft re-attaches explicitly.

export const DRAFTS_VERSION = 1 as const
export const MAX_LOCAL_DRAFTS = 25

export const localDraftSchema = z.object({
  id: z.string().min(1),
  updatedAt: z.number(),
  text: z.string(),
  cw: z.string().default(''),
  cwEnabled: z.boolean().default(false),
  visibilityRaw: z.string().default('public'),
  localOnly: z.boolean().default(false),
  replyToId: z.string().nullable().default(null),
  quoteId: z.string().nullable().default(null),
  pollChoices: z.array(z.string()).nullable().default(null),
  pollMultiple: z.boolean().default(false),
  pollDurationSeconds: z.number().default(86400),
  reactionAcceptance: z.string().nullable().default(null),
  scheduledAt: z.string().nullable().default(null),
})

export type LocalDraft = z.infer<typeof localDraftSchema>

const listSchema = z.object({
  version: z.literal(DRAFTS_VERSION),
  drafts: z.array(z.unknown()),
})

export function draftsKeyFor(sessionId: string): string {
  if (!sessionId) throw new Error('draftsKeyFor requires a sessionId')
  return `keystone.drafts.${sessionId}`
}

/** Newest first. Rows failing validation are dropped, never thrown on. */
export function listDrafts(store: KeyValueStore, sessionId: string): LocalDraft[] {
  const parsed = parseOrFallback(
    listSchema,
    store.getItem(draftsKeyFor(sessionId)),
    {version: DRAFTS_VERSION, drafts: []},
  )
  const out: LocalDraft[] = []
  for (const row of parsed.drafts) {
    const r = localDraftSchema.safeParse(row)
    if (r.success) out.push(r.data)
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

function write(store: KeyValueStore, sessionId: string, drafts: LocalDraft[]): void {
  store.setItem(
    draftsKeyFor(sessionId),
    JSON.stringify({version: DRAFTS_VERSION, drafts: drafts.slice(0, MAX_LOCAL_DRAFTS)}),
  )
}

/** True when there is nothing worth saving. */
export function isDraftEmpty(d: Pick<LocalDraft, 'text' | 'cw' | 'pollChoices'>): boolean {
  return (
    d.text.trim() === '' &&
    d.cw.trim() === '' &&
    !(d.pollChoices ?? []).some(c => c.trim() !== '')
  )
}

/** Insert or replace by id. Empty drafts delete the row instead. */
export function saveDraft(store: KeyValueStore, sessionId: string, draft: LocalDraft): void {
  const rest = listDrafts(store, sessionId).filter(d => d.id !== draft.id)
  write(store, sessionId, isDraftEmpty(draft) ? rest : [draft, ...rest])
}

export function loadDraft(
  store: KeyValueStore,
  sessionId: string,
  id: string,
): LocalDraft | null {
  return listDrafts(store, sessionId).find(d => d.id === id) ?? null
}

export function deleteDraft(store: KeyValueStore, sessionId: string, id: string): void {
  write(
    store,
    sessionId,
    listDrafts(store, sessionId).filter(d => d.id !== id),
  )
}

export function newDraftId(now: number = Date.now()): string {
  return `d${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
