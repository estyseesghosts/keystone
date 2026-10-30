// P6.5 Pages slice 6: preview converter + file collection.

import {draftFileIds, formToPreviewPage} from './PagePreview'
import {makeAccount} from '../__tests__/fixtures'
import type {PageForm} from '#/state/pageEditor'

function form(over: Partial<PageForm> = {}): PageForm {
  return {
    title: 'Hi',
    summary: null,
    name: 'hi',
    font: 'sans-serif',
    alignCenter: false,
    hideTitleWhenPinned: false,
    eyeCatchingImageId: null,
    blocks: [],
    ...over,
  }
}

describe('formToPreviewPage', () => {
  it('builds a publish-shaped page from the draft', () => {
    const author = makeAccount({id: 'alice'})
    const page = formToPreviewPage(form({blocks: [{kind: 'text', id: 'b1', text: 'hi'}]}), author, null, 1000, new Map())
    expect(page.author.id).toBe('alice')
    expect(page.title).toBe('Hi')
    expect(page.blocks).toEqual([{kind: 'text', id: 'b1', text: 'hi'}])
    expect(page.id).toBe('preview')
    expect(page.url).toBe('')
    expect(typeof page.updatedAt).toBe('string')
  })

  it('carries saved identity, counts, and script flag', () => {
    const author = makeAccount({id: 'alice'})
    const saved = {
      id: 'p1',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-02T00:00:00.000Z',
      likedCount: 4,
      isLiked: true,
      hasLegacyScript: true,
      url: 'https://a.example/@alice/pages/hi',
    }
    const page = formToPreviewPage(form(), author, saved as never, 1000, new Map())
    expect(page.id).toBe('p1')
    expect(page.createdAt).toBe('2020-01-01T00:00:00.000Z')
    expect(page.likedCount).toBe(4)
    expect(page.isLiked).toBe(true)
    expect(page.hasLegacyScript).toBe(true)
    expect(page.url).toBe('https://a.example/@alice/pages/hi')
  })

  it('attaches resolved eye-catch + files', () => {
    const author = makeAccount({id: 'alice'})
    const file = {id: 'f1', url: 'https://a.example/f.png'} as never
    const page = formToPreviewPage(
      form({eyeCatchingImageId: 'f1', blocks: [{kind: 'image', id: 'i1', fileId: 'f1'}]}),
      author,
      null,
      1000,
      new Map([['f1', file]]),
    )
    expect(page.eyeCatchingImage).toBe(file)
    expect(page.attachedFiles).toEqual([file])
  })
})

describe('draftFileIds', () => {
  it('collects block + eye-catch ids, deduped, nested included', () => {
    expect(
      draftFileIds(
        form({
          eyeCatchingImageId: 'e1',
          blocks: [
            {kind: 'image', id: 'i1', fileId: 'f1'},
            {kind: 'section', id: 's1', title: '', children: [{kind: 'image', id: 'i2', fileId: 'f1'}]},
            {kind: 'text', id: 't1', text: 'x'},
          ],
        }),
      ),
    ).toEqual(['f1', 'e1'])
  })

  it('skips null file ids', () => {
    expect(draftFileIds(form({blocks: [{kind: 'image', id: 'i1', fileId: null}]}))).toEqual([])
  })
})
