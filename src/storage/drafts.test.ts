import {createMemoryStore} from '@keystone/fedi'

import {
  deleteDraft,
  draftsKeyFor,
  listDrafts,
  loadDraft,
  saveDraft,
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
