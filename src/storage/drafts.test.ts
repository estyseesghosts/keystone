import {createMemoryStore} from '@keystone/fedi'

import {
  clearOpenDraftId,
  deleteDraft,
  draftsKeyFor,
  getOpenDraftId,
  listDrafts,
  loadDraft,
  openDraftKeyFor,
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
