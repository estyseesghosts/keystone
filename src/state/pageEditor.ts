// Page editor draft state (P6.5 Pages, slice 4): pure reducer over the
// editable form. Holds `{saved, form}`, computes `dirty` and the
// update/create payloads (PG-4: update sends only changed fields).
// Block moves follow PG-6 (up/down/into-section/out; no drag-drop).
// Unknown blocks are preserved verbatim and move/delete like the rest.

import {
  defaultPageName,
  isValidPageName,
  type PageBlock,
  type PageDraft,
  type PageFont,
  type PageModel,
  type PagePatch,
} from '@keystone/fedi'

/** Editable page fields (mirrors the Settings panel). */
export interface PageForm {
  title: string
  summary: string | null
  name: string
  font: PageFont
  alignCenter: boolean
  hideTitleWhenPinned: boolean
  eyeCatchingImageId: string | null
  blocks: PageBlock[]
}

export interface PageEditorState {
  /** Server version (null = new page). */
  saved: PageModel | null
  form: PageForm
  /** Last removed block for the 5-second Undo toast (null when consumed). */
  lastRemoved: {block: PageBlock; parentId: string | null; index: number} | null
}

export type PageBlockKind = PageBlock['kind']

export type PageEditorAction =
  | {type: 'init'; saved: PageModel | null; now?: number}
  | {type: 'setSettings'; patch: Partial<Omit<PageForm, 'blocks'>>}
  | {type: 'replaceForm'; form: PageForm}
  | {type: 'addBlock'; kind: PageBlockKind; parentId?: string | null; id?: string}
  | {type: 'updateBlock'; id: string; patch: Partial<PageBlock>}
  | {type: 'removeBlock'; id: string}
  | {type: 'restoreRemoved'}
  | {type: 'moveBlock'; id: string; dir: 'up' | 'down'}
  | {type: 'moveIntoSection'; id: string}
  | {type: 'moveOutOfSection'; id: string}

function blankForm(now: number): PageForm {
  return {
    title: '',
    summary: null,
    name: defaultPageName(now),
    font: 'sans-serif',
    alignCenter: false,
    hideTitleWhenPinned: false,
    eyeCatchingImageId: null,
    blocks: [],
  }
}

function formOf(saved: PageModel): PageForm {
  return {
    title: saved.title,
    summary: saved.summary,
    name: saved.name,
    font: saved.font,
    alignCenter: saved.alignCenter,
    hideTitleWhenPinned: saved.hideTitleWhenPinned,
    eyeCatchingImageId: saved.eyeCatchingImageId,
    blocks: saved.blocks,
  }
}

export function initPageEditor(saved: PageModel | null, now: number = Date.now()): PageEditorState {
  return {saved, form: saved ? formOf(saved) : blankForm(now), lastRemoved: null}
}

/** Fresh block skeleton for the Add menu (ids assigned by the caller in
 * tests, `crypto.randomUUID()` in the UI). */
export function newPageBlock(kind: PageBlockKind, id: string): PageBlock {
  switch (kind) {
    case 'text':
      return {kind, id, text: ''}
    case 'section':
      return {kind, id, title: '', children: []}
    case 'image':
      return {kind, id, fileId: null}
    case 'note':
      return {kind, id, noteId: null, detailed: false}
    case 'unknown':
      return {kind, id, type: 'unknown', raw: {id, type: 'unknown'}}
  }
}

function blockId(): string {
  return crypto.randomUUID()
}

interface Located {
  /** The list directly containing the block. */
  list: PageBlock[]
  /** Section block owning `list` (null = top level). */
  parent: PageBlock | null
  /** Id of the owning section (null = top level). */
  parentId: string | null
  index: number
  block: PageBlock
}

/** Deep-find a block with its owning list. Null when absent. */
function locate(blocks: PageBlock[], id: string, parent: PageBlock | null, parentId: string | null): Located | null {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    if (block.id === id) return {list: blocks, parent, parentId, index: i, block}
    if (block.kind === 'section') {
      const found = locate(block.children, id, block, block.id)
      if (found) return found
    }
  }
  return null
}

/** Deep-map: replace the block with `id` by `next` (structural share). */
function replace(blocks: PageBlock[], id: string, next: PageBlock): PageBlock[] {
  return blocks.map(b => {
    if (b.id === id) return next
    if (b.kind === 'section') {
      const children = replace(b.children, id, next)
      if (children !== b.children) return {...b, children}
    }
    return b
  })
}

/** Deep-remove: returns the new tree plus the removal site (for Undo). */
function remove(
  blocks: PageBlock[],
  id: string,
  parentId: string | null,
): {blocks: PageBlock[]; removed: Located | null} {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    if (block.id === id) {
      return {
        blocks: [...blocks.slice(0, i), ...blocks.slice(i + 1)],
        removed: {list: blocks, parent: null, parentId, index: i, block},
      }
    }
    if (block.kind === 'section') {
      const inner = remove(block.children, id, block.id)
      if (inner.removed) {
        return {
          blocks: replace(blocks, block.id, {...block, children: inner.blocks}),
          removed: inner.removed,
        }
      }
    }
  }
  return {blocks, removed: null}
}

function withForm(state: PageEditorState, form: PageForm): PageEditorState {
  return {...state, form, lastRemoved: state.lastRemoved}
}

export function pageEditorReducer(state: PageEditorState, action: PageEditorAction): PageEditorState {
  switch (action.type) {
    case 'init':
      return initPageEditor(action.saved, action.now)
    case 'setSettings':
      return withForm(state, {...state.form, ...action.patch})
    case 'replaceForm':
      return {...state, form: action.form, lastRemoved: null}
    case 'addBlock': {
      const block = newPageBlock(action.kind, action.id ?? blockId())
      if (action.parentId == null) {
        return withForm(state, {...state.form, blocks: [...state.form.blocks, block]})
      }
      const at = locate(state.form.blocks, action.parentId, null, null)
      if (!at || at.block.kind !== 'section') return state
      return withForm(state, {
        ...state.form,
        blocks: replace(state.form.blocks, at.block.id, {
          ...at.block,
          children: [...at.block.children, block],
        }),
      })
    }
    case 'updateBlock': {
      const at = locate(state.form.blocks, action.id, null, null)
      if (!at) return state
      return withForm(state, {
        ...state.form,
        blocks: replace(state.form.blocks, action.id, {...at.block, ...action.patch} as PageBlock),
      })
    }
    case 'removeBlock': {
      const {blocks, removed} = remove(state.form.blocks, action.id, null)
      if (!removed) return state
      return {
        ...state,
        form: {...state.form, blocks},
        lastRemoved: {block: removed.block, parentId: removed.parentId, index: removed.index},
      }
    }
    case 'restoreRemoved': {
      const gone = state.lastRemoved
      if (!gone) return state
      if (locate(state.form.blocks, gone.block.id, null, null)) {
        return {...state, lastRemoved: null}
      }
      if (gone.parentId == null) {
        const blocks = [...state.form.blocks]
        blocks.splice(Math.min(gone.index, blocks.length), 0, gone.block)
        return {...state, form: {...state.form, blocks}, lastRemoved: null}
      }
      const at = locate(state.form.blocks, gone.parentId, null, null)
      if (!at || at.block.kind !== 'section') return {...state, lastRemoved: null}
      const children = [...at.block.children]
      children.splice(Math.min(gone.index, children.length), 0, gone.block)
      return {
        ...state,
        form: {...state.form, blocks: replace(state.form.blocks, at.block.id, {...at.block, children})},
        lastRemoved: null,
      }
    }
    case 'moveBlock': {
      const at = locate(state.form.blocks, action.id, null, null)
      if (!at) return state
      const to = action.dir === 'up' ? at.index - 1 : at.index + 1
      if (to < 0 || to >= at.list.length) return state
      const list = [...at.list]
      const [item] = list.splice(at.index, 1)
      list.splice(to, 0, item!)
      if (at.parentId == null) return withForm(state, {...state.form, blocks: list})
      if (!at.parent || at.parent.kind !== 'section') return state
      return withForm(state, {
        ...state.form,
        blocks: replace(state.form.blocks, at.parent.id, {...at.parent, children: list}),
      })
    }
    case 'moveIntoSection': {
      // Into the nearest preceding sibling section (same list).
      const at = locate(state.form.blocks, action.id, null, null)
      if (!at || at.index === 0) return state
      const above = at.list[at.index - 1]!
      if (above.kind !== 'section') return state
      const list = [...at.list]
      const [item] = list.splice(at.index, 1)
      const section = {...above, children: [...above.children, item!]}
      list[at.index - 1] = section
      if (at.parentId == null) return withForm(state, {...state.form, blocks: list})
      if (!at.parent || at.parent.kind !== 'section') return state
      return withForm(state, {
        ...state.form,
        blocks: replace(state.form.blocks, at.parent.id, {...at.parent, children: list}),
      })
    }
    case 'moveOutOfSection': {
      // Out to the parent list, directly after the owning section.
      const at = locate(state.form.blocks, action.id, null, null)
      if (!at || at.parentId == null || !at.parent || at.parent.kind !== 'section') return state
      const inner = [...at.list]
      const [item] = inner.splice(at.index, 1)
      const sectionId = at.parent.id
      const without = replace(state.form.blocks, sectionId, {...at.parent, children: inner})
      const outer = locate(without, sectionId, null, null)
      if (!outer) return state
      const list = [...outer.list]
      list.splice(outer.index + 1, 0, item!)
      if (outer.parentId == null) return withForm(state, {...state.form, blocks: list})
      if (!outer.parent || outer.parent.kind !== 'section') return state
      return withForm(state, {
        ...state.form,
        blocks: replace(without, outer.parent.id, {...outer.parent, children: list}),
      })
    }
  }
}

/** Structural equality for blocks (unknown blocks + `extra` compare too). */
function blocksEqual(a: PageBlock[], b: PageBlock[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** True when the form differs from blank (new) or from `saved`. */
export function isPageDirty(state: PageEditorState): boolean {
  const {form, saved} = state
  if (!saved) {
    return (
      form.title !== '' ||
      (form.summary != null && form.summary !== '') ||
      form.eyeCatchingImageId != null ||
      form.blocks.length > 0
    )
  }
  return pagePatch(state) !== null
}

/** Update patch: only changed fields (PG-4). Null when nothing changed. */
export function pagePatch(state: PageEditorState): PagePatch | null {
  const {form, saved} = state
  if (!saved) return null
  const patch: PagePatch = {}
  if (form.title !== saved.title) patch.title = form.title
  if (form.name !== saved.name) patch.name = form.name
  if ((form.summary ?? null) !== (saved.summary ?? null)) patch.summary = form.summary
  if (form.font !== saved.font) patch.font = form.font
  if (form.alignCenter !== saved.alignCenter) patch.alignCenter = form.alignCenter
  if (form.hideTitleWhenPinned !== saved.hideTitleWhenPinned) {
    patch.hideTitleWhenPinned = form.hideTitleWhenPinned
  }
  if ((form.eyeCatchingImageId ?? null) !== (saved.eyeCatchingImageId ?? null)) {
    patch.eyeCatchingImageId = form.eyeCatchingImageId
  }
  if (!blocksEqual(form.blocks, saved.blocks)) patch.content = form.blocks
  return Object.keys(patch).length > 0 ? patch : null
}

/** Create payload for a new page (PG-4: `script: ''` + `variables: []`). */
export function pageDraft(state: PageEditorState): PageDraft | null {
  if (state.saved || !isPageDirty(state)) return null
  const {form} = state
  return {
    title: form.title,
    name: form.name,
    content: form.blocks,
    variables: [],
    summary: form.summary,
    eyeCatchingImageId: form.eyeCatchingImageId,
    font: form.font,
    alignCenter: form.alignCenter,
    hideTitleWhenPinned: form.hideTitleWhenPinned,
  }
}

/** Client-side validation (inline errors under the fields). Null = valid. */
export function validatePageForm(form: PageForm): {title?: string; name?: string; summary?: string} | null {
  const errors: {title?: string; name?: string; summary?: string} = {}
  if (form.title.trim().length === 0) {
    errors.title = 'Title is required.'
  } else if (form.title.length > 256) {
    errors.title = 'Title must be 256 characters or fewer.'
  }
  if (form.name.length === 0 || form.name.length > 256) {
    errors.name = 'Slug must be 1–256 characters.'
  } else if (!isValidPageName(form.name)) {
    errors.name = 'Slug may not contain spaces or : / ? # [ ] @ ! $ & \' ( ) * + , ; = % \\.'
  }
  if (form.summary != null && form.summary.length > 256) {
    errors.summary = 'Summary must be 256 characters or fewer.'
  }
  return Object.keys(errors).length > 0 ? errors : null
}

/** Duplicate payload: same content, `"{title} (copy)"` + caller-supplied slug. */
export function duplicatePageDraft(saved: PageModel, name: string): PageDraft {
  return {
    title: `${saved.title} (copy)`,
    name,
    content: saved.blocks,
    variables: [],
    summary: saved.summary,
    eyeCatchingImageId: saved.eyeCatchingImageId,
    font: saved.font,
    alignCenter: saved.alignCenter,
    hideTitleWhenPinned: saved.hideTitleWhenPinned,
  }
}
