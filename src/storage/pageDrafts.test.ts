// P6.5 Pages slice 4: page draft storage (keyed rows, loose block guard).

import {createMemoryStore} from '@keystone/fedi'

import {
  clearPageDraft,
  loadPageDraft,
  pageDraftKeyFor,
  sanitizePageBlocks,
  savePageDraft,
} from './pageDrafts'
import type {PageForm} from '#/state/pageEditor'

function form(over: Partial<PageForm> = {}): PageForm {
  return {
    title: 'T',
    summary: null,
    name: 't',
    font: 'sans-serif',
    alignCenter: false,
    hideTitleWhenPinned: false,
    eyeCatchingImageId: null,
    blocks: [],
    ...over,
  }
}

describe('pageDraftKeyFor', () => {
  it('scopes by session and page', () => {
    expect(pageDraftKeyFor('s1', 'new')).toBe('keystone.pagedraft.s1.new')
    expect(pageDraftKeyFor('s1', 'p9')).not.toBe(pageDraftKeyFor('s2', 'p9'))
  })

  it('rejects empty parts', () => {
    expect(() => pageDraftKeyFor('', 'new')).toThrow()
    expect(() => pageDraftKeyFor('s1', '')).toThrow()
  })
})

describe('page draft rows', () => {
  it('round-trips a form', () => {
    const store = createMemoryStore()
    expect(savePageDraft(store, 's1', 'new', form({title: 'Hi'}), 1000)).toBe(true)
    const row = loadPageDraft(store, 's1', 'new')
    expect(row?.form.title).toBe('Hi')
    expect(row?.updatedAt).toBe(1000)
  })

  it('missing or corrupt rows read null', () => {
    const store = createMemoryStore()
    expect(loadPageDraft(store, 's1', 'nope')).toBeNull()
    store.setItem(pageDraftKeyFor('s1', 'x'), 'not-json{')
    expect(loadPageDraft(store, 's1', 'x')).toBeNull()
    store.setItem(pageDraftKeyFor('s1', 'x'), JSON.stringify({version: 999, updatedAt: 1, form: form()}))
    expect(loadPageDraft(store, 's1', 'x')).toBeNull()
  })

  it('clear removes the row', () => {
    const store = createMemoryStore()
    savePageDraft(store, 's1', 'p1', form())
    clearPageDraft(store, 's1', 'p1')
    expect(loadPageDraft(store, 's1', 'p1')).toBeNull()
  })

  it('drops blocks of unknown kind, keeps the rest', () => {
    expect(
      sanitizePageBlocks([
        {id: 'a', kind: 'text', text: 'hi'},
        {id: 'b', kind: 'laser'},
        {kind: 'text'},
        null,
      ]),
    ).toEqual([{id: 'a', kind: 'text', text: 'hi'}])
  })
})
