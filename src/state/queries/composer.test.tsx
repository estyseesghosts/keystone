import {QueryClient} from '@tanstack/react-query'

import type {Backend, Post} from '@keystone/fedi'

import {feedQueryKey} from './keys'
import {insertCreatedPost, submitPost, uploadAll, type UploadItem} from './composer'

const post = (id: string, over: Partial<Post> = {}): Post =>
  ({
    id,
    author: {id: 'me'},
    counts: {replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0},
    content: {},
    ...over,
  }) as unknown as Post

const feed = (items: Post[]) => ({pages: [{items, cursor: null, end: true}], pageParams: [null]})

describe('insertCreatedPost', () => {
  it('prepends to this session only and bumps parent reply count', () => {
    const qc = new QueryClient()
    const A = 'https://a.example me'
    const B = 'https://b.example me'
    qc.setQueryData(feedQueryKey(A, 'timeline|home'), feed([post('p1')]))
    qc.setQueryData(feedQueryKey(B, 'timeline|home'), feed([post('p1')]))
    const written = insertCreatedPost(qc, A, post('new'), 'p1')
    expect(written).toEqual(['timeline|home'])
    const a = qc.getQueryData<ReturnType<typeof feed>>(feedQueryKey(A, 'timeline|home'))!
    const b = qc.getQueryData<ReturnType<typeof feed>>(feedQueryKey(B, 'timeline|home'))!
    expect(a.pages[0].items.map(p => p.id)).toEqual(['new', 'p1'])
    expect(a.pages[0].items[1].counts.replies).toBe(1)
    expect(b.pages[0].items.map(p => p.id)).toEqual(['p1'])
    expect(b.pages[0].items[0].counts.replies).toBe(0)
  })

  it('does not duplicate an already-present post', () => {
    const qc = new QueryClient()
    qc.setQueryData(feedQueryKey('s', 'timeline|home'), feed([post('new')]))
    expect(insertCreatedPost(qc, 's', post('new'))).toEqual([])
  })
})

describe('submitPost', () => {
  it('posts now via createPost, or schedules via the sub-module only', async () => {
    const createPost = jest.fn().mockResolvedValue(post('x'))
    const create = jest.fn().mockResolvedValue({id: 's1', scheduledAt: 't', post: null})
    const backend = {createPost, scheduled: {create}} as unknown as Backend
    expect((await submitPost(backend, {draft: {text: 'a'}})).kind).toBe('posted')
    expect((await submitPost(backend, {draft: {text: 'a'}, scheduledAt: 't'})).kind).toBe('scheduled')
    expect(create).toHaveBeenCalledWith({text: 'a', scheduledAt: 't'})
    await expect(
      submitPost({createPost} as unknown as Backend, {draft: {text: 'a'}, scheduledAt: 't'}),
    ).rejects.toThrow(/schedul/i)
  })
})

describe('uploadAll', () => {
  const item = (key: string, over: Partial<UploadItem> = {}): UploadItem => ({
    key,
    name: key,
    previewUri: null,
    status: 'staged',
    mediaId: null,
    alt: '',
    error: null,
    ...over,
  })

  it('uploads with alt as comment, skips done items, reports status', async () => {
    const uploadMedia = jest.fn().mockImplementation(async () => ({id: 'm-new'}))
    const backend = {uploadMedia} as unknown as Backend
    const files = new Map([['a', new File(['x'], 'a.png')], ['b', new File(['y'], 'b.png')]])
    const events: Array<[string, string | undefined]> = []
    const ids = await uploadAll(
      backend,
      [item('a', {alt: 'a cat'}), item('b', {status: 'done', mediaId: 'm-old'})],
      files,
      (k, p) => events.push([k, p.status]),
    )
    expect(ids).toEqual(['m-new', 'm-old'])
    expect(uploadMedia).toHaveBeenCalledTimes(1)
    expect(uploadMedia.mock.calls[0][1]).toEqual({comment: 'a cat'})
    expect(events).toEqual([['a', 'uploading'], ['a', 'done']])
  })

  it('returns null and marks the failed item, keeping others', async () => {
    const uploadMedia = jest
      .fn()
      .mockResolvedValueOnce({id: 'm1'})
      .mockRejectedValueOnce(new Error('too big'))
    const files = new Map([['a', new File(['x'], 'a')], ['b', new File(['y'], 'b')]])
    const patches: Record<string, Partial<UploadItem>> = {}
    const ids = await uploadAll(
      {uploadMedia} as unknown as Backend,
      [item('a'), item('b')],
      files,
      (k, p) => (patches[k] = {...patches[k], ...p}),
    )
    expect(ids).toBeNull()
    expect(patches.a.status).toBe('done')
    expect(patches.b).toMatchObject({status: 'error', error: 'too big'})
  })
})
