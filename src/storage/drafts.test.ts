import {createMemoryStore, type KeyValueStore} from '@keystone/fedi'

import {
  clearOpenDraftId,
  deleteDraft,
  draftsBakKeyFor,
  draftsKeyFor,
  getOpenDraftId,
  listDrafts,
  loadDraft,
  openDraftKeyFor,
  purgeDrafts,
  saveDraft,
  setOpenDraftId,
  type LocalDraft,
} from './drafts'

const A = 'https://a.example acc1'
const B = 'https://b.example acc1'

const draft = (over: Partial<LocalDraft> = {}): LocalDraft => ({
  id: 'd1',
  updatedAt: 1,
  text: 'hello',
  cw: '',
  cwEnabled: false,
  visibilityRaw: 'home',
  visibleUserIds: [],
  localOnly: false,
  replyToId: null,
  quoteId: null,
  pollChoices: null,
  pollMultiple: false,
  pollHideTotals: false,
  pollDurationSeconds: 86400,
  reactionAcceptance: null,
  noQuote: false,
  scheduledAt: null,
  hadMedia: false,
  ...over,
})

describe('local drafts', () => {
  it('round-trips a draft with raw visibility', () => {
    const store = createMemoryStore()
    saveDraft(store, A, draft({replyToId: 'p9', visibilityRaw: 'list:x'}))
    expect(loadDraft(store, A, 'd1')).toEqual(draft({replyToId: 'p9', visibilityRaw: 'list:x'}))
  })

  it('keeps sessions separate', () => {
    const store = createMemoryStore()
    saveDraft(store, A, draft())
    expect(listDrafts(store, B)).toEqual([])
    expect(draftsKeyFor(A)).not.toBe(draftsKeyFor(B))
  })

  it('replaces by id, orders newest first, deletes empties and by id', () => {
    const store = createMemoryStore()
    saveDraft(store, A, draft({id: 'a', updatedAt: 1}))
    saveDraft(store, A, draft({id: 'b', updatedAt: 5}))
    saveDraft(store, A, draft({id: 'a', updatedAt: 9, text: 'edited'}))
    expect(listDrafts(store, A).map(d => d.id)).toEqual(['a', 'b'])
    saveDraft(store, A, draft({id: 'a', text: '  '}))
    expect(listDrafts(store, A).map(d => d.id)).toEqual(['b'])
    deleteDraft(store, A, 'b')
    expect(listDrafts(store, A)).toEqual([])
  })

  it('survives corrupt storage and bad rows', () => {
    const store = createMemoryStore({[draftsKeyFor(A)]: '{nope'})
    expect(listDrafts(store, A)).toEqual([])
    store.setItem(draftsKeyFor(A), JSON.stringify({version: 1, drafts: [{x: 1}, draft()]}))
    expect(listDrafts(store, A)).toHaveLength(1)
  })
})

describe('open-draft pointer (slice 1)', () => {
  it('round-trips, overwrites, and clears', () => {
    const store = createMemoryStore()
    expect(getOpenDraftId(store, A)).toBeNull()
    setOpenDraftId(store, A, 'd1')
    expect(getOpenDraftId(store, A)).toBe('d1')
    setOpenDraftId(store, A, 'd2')
    expect(getOpenDraftId(store, A)).toBe('d2')
    clearOpenDraftId(store, A)
    expect(getOpenDraftId(store, A)).toBeNull()
  })

  it('keys the pointer by session', () => {
    const store = createMemoryStore()
    setOpenDraftId(store, A, 'd1')
    expect(getOpenDraftId(store, B)).toBeNull()
    expect(openDraftKeyFor(A)).not.toBe(openDraftKeyFor(B))
  })

  it('reads a missing or empty row as null', () => {
    const store = createMemoryStore()
    expect(getOpenDraftId(store, A)).toBeNull()
    store.setItem(openDraftKeyFor(A), '')
    expect(getOpenDraftId(store, A)).toBeNull()
  })
})

describe('hadMedia flag (slice 1)', () => {
  it('defaults false for rows saved before the flag existed', () => {
    const store = createMemoryStore()
    const {hadMedia, ...legacy} = draft()
    expect(hadMedia).toBe(false)
    store.setItem(draftsKeyFor(A), JSON.stringify({version: 1, drafts: [legacy]}))
    expect(loadDraft(store, A, 'd1')?.hadMedia).toBe(false)
  })

  it('round-trips true', () => {
    const store = createMemoryStore()
    saveDraft(store, A, draft({hadMedia: true}))
    expect(loadDraft(store, A, 'd1')?.hadMedia).toBe(true)
  })
})

describe('open-draft pointer migration (repair X1.3 S11)', () => {
  const legacyKey = `keystone.drafts.${A}.open`

  it('moves the legacy `.open` row to the `draftopen.` prefix once', () => {
    const store = createMemoryStore()
    store.setItem(legacyKey, 'd1')
    expect(getOpenDraftId(store, A)).toBe('d1')
    expect(store.getItem(openDraftKeyFor(A))).toBe('d1')
    expect(store.getItem(legacyKey)).toBeNull()
    expect(openDraftKeyFor(A)).toBe(`keystone.draftopen.${A}`)
  })

  it('a live pointer wins over the legacy row; an empty legacy row is dropped', () => {
    const store = createMemoryStore()
    setOpenDraftId(store, A, 'new')
    store.setItem(legacyKey, 'old')
    expect(getOpenDraftId(store, A)).toBe('new')
    expect(store.getItem(legacyKey)).toBeNull()
    const empty = createMemoryStore()
    empty.setItem(legacyKey, '')
    expect(getOpenDraftId(empty, A)).toBeNull()
    expect(empty.getItem(legacyKey)).toBeNull()
  })

  it('the new prefix cannot collide with session ids ending in `.open`', () => {
    const tricky = 'https://a.example acc.open'
    const store = createMemoryStore()
    setOpenDraftId(store, tricky, 'd1')
    saveDraft(store, tricky, draft({id: 'd1'}))
    expect(getOpenDraftId(store, tricky)).toBe('d1')
    // The sibling session's list is untouched: different prefix, no suffix.
    expect(store.getItem(draftsKeyFor('https://a.example acc'))).toBeNull()
    expect(store.getItem(`keystone.drafts.${tricky}.open`)).toBeNull()
  })
})

describe('write failures and backups (repair X1.3 S9/S12)', () => {
  it('saveDraft backs up a corrupt list before overwriting and reports true', () => {
    const store = createMemoryStore()
    store.setItem(draftsKeyFor(A), '{corrupt')
    expect(saveDraft(store, A, draft())).toBe(true)
    expect(store.getItem(draftsBakKeyFor(A))).toBe('{corrupt')
    expect(loadDraft(store, A, 'd1')).toEqual(draft())
  })

  it('saveDraft on a throwing store returns false instead of throwing', () => {
    const mem = createMemoryStore()
    const store: KeyValueStore = {
      getItem: key => mem.getItem(key),
      setItem: () => {
        throw new Error('locked')
      },
      removeItem: key => mem.removeItem(key),
    }
    expect(saveDraft(store, A, draft())).toBe(false)
    expect(listDrafts(store, A)).toEqual([])
  })

  it('deleteDraft reports the write result', () => {
    const store = createMemoryStore()
    saveDraft(store, A, draft())
    expect(deleteDraft(store, A, 'd1')).toBe(true)
    expect(listDrafts(store, A)).toEqual([])
  })

  it('purgeDrafts removes the list, both pointer rows, and the backup', () => {
    const store = createMemoryStore()
    saveDraft(store, A, draft())
    setOpenDraftId(store, A, 'd1')
    store.setItem(`keystone.drafts.${A}.open`, 'legacy')
    store.setItem(draftsBakKeyFor(A), 'forensics')
    purgeDrafts(store, A)
    expect(store.getItem(draftsKeyFor(A))).toBeNull()
    expect(store.getItem(openDraftKeyFor(A))).toBeNull()
    expect(store.getItem(`keystone.drafts.${A}.open`)).toBeNull()
    expect(store.getItem(draftsBakKeyFor(A))).toBeNull()
  })
})
