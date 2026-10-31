// P6.5 Pages slice 4: editor reducer — patch computation (PG-4),
// block moves (PG-6), unknown preservation, validation, duplicate.

import {
  duplicatePageDraft,
  firstTextBlockId,
  initPageEditor,
  isPageDirty,
  newPageBlock,
  pageDraft,
  pagePatch,
  pageEditorReducer,
  validatePageForm,
  type PageEditorState,
} from './pageEditor'
import {makeAccount} from '../components/__tests__/fixtures'
import type {PageBlock, PageModel} from '@keystone/fedi'

function saved(over: Partial<PageModel> = {}): PageModel {
  return {
    id: 'p1',
    createdAt: '2026-10-26T12:00:00.000Z',
    updatedAt: '2026-10-26T12:00:00.000Z',
    author: makeAccount(),
    title: 'Hello',
    name: 'hello',
    summary: null,
    font: 'sans-serif',
    alignCenter: false,
    hideTitleWhenPinned: false,
    eyeCatchingImageId: null,
    eyeCatchingImage: null,
    attachedFiles: [],
    blocks: [{kind: 'text', id: 'b1', text: 'hi'}],
    likedCount: 0,
    isLiked: undefined,
    hasLegacyScript: false,
    url: 'https://a.example/@alice/pages/hello',
    ...over,
  }
}

function text(id: string, text: string): PageBlock {
  return {kind: 'text', id, text}
}

function section(id: string, children: PageBlock[], title = ''): PageBlock {
  return {kind: 'section', id, title, children}
}

describe('pageEditorReducer', () => {
  it('init from saved; clean until edited', () => {
    const st = initPageEditor(saved())
    expect(st.form.title).toBe('Hello')
    expect(isPageDirty(st)).toBe(false)
    expect(pagePatch(st)).toBeNull()
  })

  it('new page defaults the slug and starts clean', () => {
    const st = initPageEditor(null, 1234567890)
    expect(st.form.name).toBe('1234567890')
    expect(isPageDirty(st)).toBe(false)
    expect(pageDraft(st)).toBeNull()
  })

  it('patch sends only changed fields', () => {
    let st = initPageEditor(saved())
    st = pageEditorReducer(st, {type: 'setSettings', patch: {title: 'New'}})
    expect(isPageDirty(st)).toBe(true)
    expect(pagePatch(st)).toEqual({title: 'New'})
  })

  it('summary null↔value transitions round-trip', () => {
    let st = initPageEditor(saved({summary: 's'}))
    st = pageEditorReducer(st, {type: 'setSettings', patch: {summary: null}})
    expect(pagePatch(st)).toEqual({summary: null})
    st = pageEditorReducer(st, {type: 'setSettings', patch: {summary: 's'}})
    expect(pagePatch(st)).toBeNull()
  })

  it('block reorder produces a content patch; reorder back clears it', () => {
    const s = saved({blocks: [text('b1', 'a'), text('b2', 'b')]})
    let st = initPageEditor(s)
    st = pageEditorReducer(st, {type: 'moveBlock', id: 'b1', dir: 'down'})
    expect(st.form.blocks.map(b => b.id)).toEqual(['b2', 'b1'])
    expect(pagePatch(st)).toEqual({content: [text('b2', 'b'), text('b1', 'a')]})
    st = pageEditorReducer(st, {type: 'moveBlock', id: 'b1', dir: 'up'})
    expect(pagePatch(st)).toBeNull()
  })

  it('move edge cases are no-ops (first up, last down)', () => {
    const st0 = initPageEditor(saved({blocks: [text('b1', 'a'), text('b2', 'b')]}))
    expect(pageEditorReducer(st0, {type: 'moveBlock', id: 'b1', dir: 'up'}).form.blocks.map(b => b.id)).toEqual(['b1', 'b2'])
    expect(pageEditorReducer(st0, {type: 'moveBlock', id: 'b2', dir: 'down'}).form.blocks.map(b => b.id)).toEqual(['b1', 'b2'])
  })

  it('move into section above; no section above is a no-op', () => {
    const st0 = initPageEditor(saved({blocks: [text('t1', 'x'), section('s1', []), text('t2', 'y')]}))
    const moved = pageEditorReducer(st0, {type: 'moveIntoSection', id: 't2'})
    expect(moved.form.blocks.map(b => b.id)).toEqual(['t1', 's1'])
    expect((moved.form.blocks[1] as {children: PageBlock[]}).children.map(b => b.id)).toEqual(['t2'])
    expect(pageEditorReducer(st0, {type: 'moveIntoSection', id: 't1'}).form.blocks).toHaveLength(3)
  })

  it('move out of section lands after the section; top-level is a no-op', () => {
    const st0 = initPageEditor(saved({blocks: [section('s1', [text('t1', 'x')]), text('t2', 'y')]}))
    const moved = pageEditorReducer(st0, {type: 'moveOutOfSection', id: 't1'})
    expect(moved.form.blocks.map(b => b.id)).toEqual(['s1', 't1', 't2'])
    expect(pageEditorReducer(st0, {type: 'moveOutOfSection', id: 't2'}).form.blocks.map(b => b.id)).toEqual(['s1', 't2'])
  })

  it('nested move: into a section inside a section', () => {
    const st0 = initPageEditor(
      saved({blocks: [section('outer', [section('inner', []), text('t1', 'x')])]}),
    )
    const moved = pageEditorReducer(st0, {type: 'moveIntoSection', id: 't1'})
    const outer = moved.form.blocks[0]
    expect(outer.kind).toBe('section')
    if (outer.kind === 'section') {
      const inner = outer.children[0]
      expect(inner.kind).toBe('section')
      if (inner.kind === 'section') expect(inner.children.map(b => b.id)).toEqual(['t1'])
    }
  })

  it('remove + restore round-trips (Undo)', () => {
    let st = initPageEditor(saved({blocks: [text('b1', 'a'), text('b2', 'b')]}))
    st = pageEditorReducer(st, {type: 'removeBlock', id: 'b1'})
    expect(st.form.blocks.map(b => b.id)).toEqual(['b2'])
    expect(st.lastRemoved?.block.id).toBe('b1')
    st = pageEditorReducer(st, {type: 'restoreRemoved'})
    expect(st.form.blocks.map(b => b.id)).toEqual(['b1', 'b2'])
    expect(st.lastRemoved).toBeNull()
  })

  it('unknown blocks survive edits untouched', () => {
    const legacy = {kind: 'unknown', id: 'u1', type: 'button', raw: {id: 'u1', type: 'button'}} as PageBlock
    let st = initPageEditor(saved({blocks: [text('b1', 'a'), legacy]}))
    st = pageEditorReducer(st, {type: 'moveBlock', id: 'u1', dir: 'up'})
    expect(st.form.blocks[0]).toEqual(legacy)
    st = pageEditorReducer(st, {type: 'setSettings', patch: {title: 'T'}})
    expect(pagePatch(st)).toEqual({title: 'T', content: [legacy, text('b1', 'a')]})
  })
})

describe('replaceForm', () => {
  it('replaces the whole form (draft restore)', () => {
    const st0 = initPageEditor(saved())
    const form = {...st0.form, title: 'Restored', blocks: [text('n1', 'new')] as PageBlock[]}
    const st = pageEditorReducer(st0, {type: 'replaceForm', form})
    expect(st.form.title).toBe('Restored')
    expect(st.form.blocks.map(b => b.id)).toEqual(['n1'])
    expect(isPageDirty(st)).toBe(true)
  })
})

describe('newPageBlock', () => {
  it('builds skeletons for the add menu', () => {
    expect(newPageBlock('text', 'x')).toEqual({kind: 'text', id: 'x', text: ''})
    expect(newPageBlock('image', 'x')).toEqual({kind: 'image', id: 'x', fileId: null})
    expect(newPageBlock('note', 'x')).toEqual({kind: 'note', id: 'x', noteId: null, detailed: false})
  })
})

describe('validatePageForm', () => {
  it('requires a title, bounds lengths, rejects bad slugs', () => {
    const base = initPageEditor(null, 1).form
    expect(validatePageForm(base)).toEqual({title: 'Title is required.'})
    expect(validatePageForm({...base, title: 'T'})).toBeNull()
    expect(validatePageForm({...base, title: 'T', name: 'has space'})?.name).toBeTruthy()
    expect(validatePageForm({...base, title: 'T', name: 'a/b'})?.name).toBeTruthy()
    expect(validatePageForm({...base, title: 'x'.repeat(257)})?.title).toBeTruthy()
    expect(validatePageForm({...base, title: 'T', summary: 'x'.repeat(257)})?.summary).toBeTruthy()
  })
})

describe('duplicatePageDraft', () => {
  it('copies content with the (copy) title', () => {
    const d = duplicatePageDraft(saved({title: 'Hi'}), 'hi-copy')
    expect(d.title).toBe('Hi (copy)')
    expect(d.name).toBe('hi-copy')
    expect(d.content).toEqual(saved().blocks)
  })
})

describe('pageDraft', () => {
  it('builds the create payload for a dirty new page', () => {
    let st: PageEditorState = initPageEditor(null, 1)
    st = pageEditorReducer(st, {type: 'setSettings', patch: {title: 'Hi'}})
    const d = pageDraft(st)
    expect(d).toMatchObject({title: 'Hi', name: '1'})
    expect(d?.variables).toEqual([])
    // The seeded starter (one section + two text blocks) is the content.
    expect(d?.content).toHaveLength(1)
    expect(d?.content[0]).toMatchObject({kind: 'section'})
    const seeded = d?.content[0]
    if (seeded?.kind === 'section') {
      expect(seeded.children).toHaveLength(2)
      expect(seeded.children.every(b => b.kind === 'text')).toBe(true)
    }
  })
})

describe('new-page starter', () => {
  it('seeds one untitled section with two text blocks, staying clean', () => {
    const st = initPageEditor(null, 1)
    expect(st.form.blocks).toHaveLength(1)
    const only = st.form.blocks[0]!
    expect(only.kind).toBe('section')
    if (only.kind === 'section') {
      expect(only.title).toBe('')
      expect(only.children).toHaveLength(2)
      expect(only.children.map(c => c.kind)).toEqual(['text', 'text'])
    }
    expect(isPageDirty(st)).toBe(false)
    expect(pageDraft(st)).toBeNull()
  })

  it('becomes dirty once a seeded block is edited', () => {
    let st = initPageEditor(null, 1)
    const first = firstTextBlockId(st.form.blocks)
    expect(first).not.toBeNull()
    st = pageEditorReducer(st, {type: 'updateBlock', id: first!, patch: {text: 'hi'}})
    expect(isPageDirty(st)).toBe(true)
  })

  it('a saved page has no starter baseline', () => {
    const st = initPageEditor(saved())
    expect(st.baseline).toBeNull()
    expect(st.form.blocks).toEqual(saved().blocks)
  })
})
