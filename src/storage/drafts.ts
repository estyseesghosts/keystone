import {z} from 'zod'

import type {KeyValueStore} from '@keystone/fedi'

import {ensureRawBackup, parseOrFallback} from './schema'

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
  /** Specified-visibility recipients (C4); empty unless chosen. */
  visibleUserIds: z.array(z.string()).default([]),
  localOnly: z.boolean().default(false),
  replyToId: z.string().nullable().default(null),
  quoteId: z.string().nullable().default(null),
  pollChoices: z.array(z.string()).nullable().default(null),
  pollMultiple: z.boolean().default(false),
  /** Mastodon `hide_totals` (clickstone §1.6); false keeps the old drafts
   * readable and never sends the field. */
  pollHideTotals: z.boolean().default(false),
  pollDurationSeconds: z.number().default(86400),
  reactionAcceptance: z.string().nullable().default(null),
  /** Per-note quote refusal (clickstone §1.2); account-wide is separate. */
  noQuote: z.boolean().default(false),
  scheduledAt: z.string().nullable().default(null),
  /** True when attachments were staged at autosave time. The files/ids
   * themselves are never stored (server media ids may expire), so a
   * pointer-restored draft with `hadMedia` shows an honest notice instead
   * of silently dropping them (composer slice 1). Additive: old rows
   * without the flag still validate and read as false. */
  hadMedia: z.boolean().default(false),
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

/** Per-session open-draft pointer (composer slice 1 + repair X1.3 S11):
 * the id of the session's in-progress draft. Autosave sets it whenever
 * it saves a non-empty draft and clears it when the save is empty (row
 * deleted) or the draft posts — so reopening the composer after a
 * refresh/crash lands straight back in the in-progress draft, while a
 * deliberate save-and-close (slices 2+3) starts fresh. A separate
 * `keystone.draftopen.` prefix (never the old `.open` suffix: a session
 * id ending in `.open` would collide). The key embeds the session id,
 * so one account's pointer never surfaces for another. */
export function openDraftKeyFor(sessionId: string): string {
  if (!sessionId) throw new Error('openDraftKeyFor requires a sessionId')
  return `keystone.draftopen.${sessionId}`
}

/** Legacy pointer key (`keystone.drafts.<sid>.open`, pre-S11). Read once
 * for migration, then deleted; purged, never written. */
function legacyOpenDraftKeyFor(sessionId: string): string {
  return `keystone.drafts.${sessionId}.open`
}

/** Backup of the last unreadable-but-non-empty draft list. A separate
 * prefix (S11: never a suffix). Purged with the session, never read by
 * the composer. */
export function draftsBakKeyFor(sessionId: string): string {
  if (!sessionId) throw new Error('draftsBakKeyFor requires a sessionId')
  return `keystone.draftbak.${sessionId}`
}

/** One-time move of the legacy `.open` pointer to the `draftopen.`
 * prefix. The live pointer wins over the legacy one; an empty legacy
 * row is dropped. Best-effort and never throws — a failed move keeps
 * the legacy row for next time. */
function migrateOpenDraftPointer(store: KeyValueStore, sessionId: string): void {
  let legacy: string | null = null
  try {
    legacy = store.getItem(legacyOpenDraftKeyFor(sessionId))
  } catch {
    return
  }
  if (legacy == null) return
  try {
    const current = store.getItem(openDraftKeyFor(sessionId))
    if ((current == null || current === '') && legacy !== '') {
      if (!store.setItem(openDraftKeyFor(sessionId), legacy)) return
    }
    store.removeItem(legacyOpenDraftKeyFor(sessionId))
  } catch {
    // Best-effort: the legacy row stays for next time.
  }
}

/** The pointer value, or null when no in-progress draft is recorded.
 * Missing/empty rows read as null, never throw. Migrates the legacy
 * `.open` row on first read. */
export function getOpenDraftId(store: KeyValueStore, sessionId: string): string | null {
  migrateOpenDraftPointer(store, sessionId)
  const raw = store.getItem(openDraftKeyFor(sessionId))
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/** Persist the pointer. Returns false (never throws) when the write failed. */
export function setOpenDraftId(store: KeyValueStore, sessionId: string, id: string): boolean {
  migrateOpenDraftPointer(store, sessionId)
  try {
    return store.setItem(openDraftKeyFor(sessionId), id)
  } catch {
    return false
  }
}

/** Clear the pointer. Returns false (never throws) when the delete failed. */
export function clearOpenDraftId(store: KeyValueStore, sessionId: string): boolean {
  migrateOpenDraftPointer(store, sessionId)
  try {
    store.removeItem(openDraftKeyFor(sessionId))
    return true
  } catch {
    return false
  }
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

/** True when `raw` parses as a draft list. Anything else non-empty
 * must be backed up before overwriting (same rule as S9). */
function isDraftListReadable(raw: string | null): boolean {
  if (!raw) return true
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  return listSchema.safeParse(parsed).success
}

function write(store: KeyValueStore, sessionId: string, drafts: LocalDraft[]): boolean {
  const key = draftsKeyFor(sessionId)
  try {
    const raw = store.getItem(key)
    if (raw && !isDraftListReadable(raw)) {
      // Unreadable-but-non-empty: back the bytes up once, then proceed —
      // the backup (not the failed parse) is what a later read recovers.
      ensureRawBackup(store, key, draftsBakKeyFor(sessionId))
    }
  } catch {
    // A failed read must not block the write.
  }
  try {
    return store.setItem(
      key,
      JSON.stringify({version: DRAFTS_VERSION, drafts: drafts.slice(0, MAX_LOCAL_DRAFTS)}),
    )
  } catch {
    return false
  }
}

/** Remove every draft, the open-draft pointer (live, legacy, and backup
 * rows) for a session (sign-out purge, X1.2). Never throws. */
export function purgeDrafts(store: KeyValueStore, sessionId: string): void {
  if (!sessionId) return
  for (const key of [
    draftsKeyFor(sessionId),
    openDraftKeyFor(sessionId),
    legacyOpenDraftKeyFor(sessionId),
    draftsBakKeyFor(sessionId),
  ]) {
    try {
      store.removeItem(key)
    } catch {
      // Best-effort: local sign-out completes even on storage failure.
    }
  }
}

/** True when there is nothing worth saving. */
export function isDraftEmpty(
  d: Pick<LocalDraft, 'text' | 'cw' | 'pollChoices' | 'visibleUserIds'>,
): boolean {
  return (
    d.text.trim() === '' &&
    d.cw.trim() === '' &&
    !(d.pollChoices ?? []).some(c => c.trim() !== '') &&
    (d.visibleUserIds ?? []).length === 0
  )
}

/** Insert or replace by id. Empty drafts delete the row instead.
 * Returns false (never throws) when the write failed — the autosave
 * effect surfaces that as a non-blocking notice. */
export function saveDraft(store: KeyValueStore, sessionId: string, draft: LocalDraft): boolean {
  const rest = listDrafts(store, sessionId).filter(d => d.id !== draft.id)
  return write(store, sessionId, isDraftEmpty(draft) ? rest : [draft, ...rest])
}

export function loadDraft(
  store: KeyValueStore,
  sessionId: string,
  id: string,
): LocalDraft | null {
  return listDrafts(store, sessionId).find(d => d.id === id) ?? null
}

export function deleteDraft(store: KeyValueStore, sessionId: string, id: string): boolean {
  return write(
    store,
    sessionId,
    listDrafts(store, sessionId).filter(d => d.id !== id),
  )
}

export function newDraftId(now: number = Date.now()): string {
  return `d${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
