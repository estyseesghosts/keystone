import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, renderHook, waitFor} from '@testing-library/react-native'
import React from 'react'

import type {Backend, Post, ScheduledNote, ServerDraft, Session} from '@keystone/fedi'

import {feedQueryKey} from './keys'
import {
  MAX_MEDIA_BYTES,
  attachmentSizeError,
  insertCreatedPost,
  scheduledPostsKey,
  serverDraftsKey,
  submitPost,
  uploadAll,
  uploadOne,
  useCancelScheduled,
  useDeleteServerDraft,
  useEditPost,
  useSaveServerDraft,
  useScheduledPosts,
  useServerDrafts,
  useUploads,
  type UploadItem,
} from './composer'

const post = (id: string, over: Partial<Post> = {}): Post =>
  ({
    id,
    author: {id: 'me'},
    counts: {replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0},
    content: {},
    ...over,
  }) as unknown as Post

const visPost = (id: string, kind: 'public' | 'quiet' | 'followers' | 'direct'): Post =>
  post(id, {visibility: {kind, localOnly: false, raw: kind}} as unknown as Partial<Post>)

const feed = (items: Post[]) => ({pages: [{items, cursor: null, end: true}], pageParams: [null]})

describe('insertCreatedPost', () => {
  it('prepends public posts to this session only and bumps parent reply count', () => {
    const qc = new QueryClient()
    const A = 'https://a.example me'
    const B = 'https://b.example me'
    for (const d of ['timeline|home', 'timeline|social', 'user|me|posts']) {
      qc.setQueryData(feedQueryKey(A, d), feed([post('p1')]))
      qc.setQueryData(feedQueryKey(B, d), feed([post('p1')]))
    }
    const written = insertCreatedPost(qc, A, visPost('new', 'public'), null)
    expect(written).toEqual(['timeline|home', 'timeline|social', 'user|me|posts'])
    const a = qc.getQueryData<ReturnType<typeof feed>>(feedQueryKey(A, 'timeline|home'))!
    const b = qc.getQueryData<ReturnType<typeof feed>>(feedQueryKey(B, 'timeline|home'))!
    expect(a.pages[0].items.map(p => p.id)).toEqual(['new', 'p1'])
    expect(b.pages[0].items.map(p => p.id)).toEqual(['p1'])
  })

  it.each([
    // [kind, replyToId, expected descriptors written]
    ['public', null, ['timeline|home', 'timeline|social', 'user|me|posts']],
    ['quiet', null, ['timeline|home', 'user|me|posts']],
    ['followers', null, ['user|me|posts']],
    ['direct', null, ['user|me|posts']],
    ['public', 'p1', ['user|me|replies']],
    ['direct', 'p1', ['user|me|replies']],
  ] as Array<['public' | 'quiet' | 'followers' | 'direct', string | null, string[]]>)(
    'routes %s posts (reply=%p) without leaking timelines',
    (kind, replyToId, expected) => {
      const qc = new QueryClient()
      for (const d of ['timeline|home', 'timeline|social', 'user|me|posts', 'user|me|replies']) {
        qc.setQueryData(feedQueryKey('s', d), feed([post('p1')]))
      }
      const written = insertCreatedPost(qc, 's', visPost('new', kind), replyToId)
      expect(written).toEqual(expected)
      const home = qc.getQueryData<ReturnType<typeof feed>>(feedQueryKey('s', 'timeline|home'))!
      const ids = home.pages[0].items.map(p => p.id)
      if (expected.includes('timeline|home')) expect(ids[0]).toBe('new')
      else expect(ids).not.toContain('new')
      if (replyToId) {
        const profile = qc.getQueryData<ReturnType<typeof feed>>(
          feedQueryKey('s', 'user|me|replies'),
        )!
        expect(profile.pages[0].items.map(p => p.id)).toContain('new')
        expect(home.pages[0].items[0].counts.replies).toBe(1)
      }
    },
  )

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
    sensitive: false,
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

  it('carries the Drive folder target (folderId/force) and keeps root by default', async () => {
    const uploadMedia = jest.fn().mockImplementation(async () => ({id: 'm-new'}))
    const files = new Map([['a', new File(['x'], 'a.png')]])
    await uploadAll(
      {uploadMedia} as unknown as Backend,
      [item('a', {alt: 'a cat'})],
      files,
      () => {},
      {folderId: 'folder-1', force: true},
    )
    expect(uploadMedia.mock.calls[0][1]).toEqual({
      comment: 'a cat',
      folderId: 'folder-1',
      force: true,
    })

    // Root: no folderId/force reaches the backend (never an empty field).
    uploadMedia.mockClear()
    await uploadAll(
      {uploadMedia} as unknown as Backend,
      [item('a')],
      files,
      () => {},
      {folderId: null},
    )
    expect(uploadMedia.mock.calls[0][1]).toEqual({})
  })

  it('carries the per-file sensitive flag at upload time, omitting it when off', async () => {
    const uploadMedia = jest.fn().mockImplementation(async () => ({id: 'm-new'}))
    const files = new Map([
      ['a', new File(['x'], 'a.png')],
      ['b', new File(['y'], 'b.png')],
    ])
    await uploadAll(
      {uploadMedia} as unknown as Backend,
      [item('a', {alt: 'a cat', sensitive: true}), item('b', {alt: 'b cat'})],
      files,
      () => {},
    )
    // Only the marked attachment sends `isSensitive`; the default upload
    // never sends a false field (Sharkey rejects unknown/empty shape).
    expect(uploadMedia.mock.calls[0][1]).toEqual({comment: 'a cat', isSensitive: true})
    expect(uploadMedia.mock.calls[1][1]).toEqual({comment: 'b cat'})
  })

  it('refuses an over-cap File before upload starts (never calls upload)', async () => {
    const uploadMedia = jest.fn().mockResolvedValue({id: 'm-new'})
    const big = {size: MAX_MEDIA_BYTES + 1, name: 'big.png'} as unknown as File
    const files = new Map([['a', big]])
    const patches: Record<string, Partial<UploadItem>> = {}
    const ids = await uploadAll(
      {uploadMedia} as unknown as Backend,
      [item('a')],
      files,
      (k, p) => (patches[k] = {...patches[k], ...p}),
    )
    // Honest error on the item, no transport touched.
    expect(ids).toBeNull()
    expect(uploadMedia).not.toHaveBeenCalled()
    expect(patches.a).toMatchObject({status: 'error'})
    expect(patches.a.error).toMatch(/too large/)
  })

  it('enforces per-kind server caps with the real number in the message', async () => {
    const uploadMedia = jest.fn().mockResolvedValue({id: 'm-new'})
    const image = {size: 20 * 1024 * 1024, name: 'photo.png', type: 'image/png'} as unknown as File
    const video = {size: 20 * 1024 * 1024, name: 'clip.mp4', type: 'video/mp4'} as unknown as File
    const caps = {imageBytes: 16 * 1024 * 1024, videoBytes: 99 * 1024 * 1024}
    const patches: Record<string, Partial<UploadItem>> = {}
    // Same 20 MB: over the 16 MB image cap, under the 99 MB video cap.
    const ids = await uploadAll(
      {uploadMedia} as unknown as Backend,
      [item('a'), item('b')],
      new Map([
        ['a', image],
        ['b', video],
      ]),
      (k, p) => (patches[k] = {...patches[k], ...p}),
      {},
      caps,
    )
    expect(ids).toBeNull()
    expect(patches.a).toMatchObject({status: 'error'})
    expect(patches.a.error).toMatch(/16/)
    expect(uploadMedia).toHaveBeenCalledTimes(1)
  })

  it('falls back to the heap bound when the server reported nothing', async () => {
    const uploadMedia = jest.fn().mockResolvedValue({id: 'm-new'})
    const big = {size: MAX_MEDIA_BYTES + 1, name: 'big.bin', type: ''} as unknown as File
    const ids = await uploadAll(
      {uploadMedia} as unknown as Backend,
      [item('a')],
      new Map([['a', big]]),
      () => {},
      {},
      {imageBytes: null, videoBytes: null},
    )
    expect(ids).toBeNull()
    expect(uploadMedia).not.toHaveBeenCalled()
  })

  it('uploadOne passes small files straight through', async () => {
    const uploadMedia = jest.fn().mockResolvedValue({id: 'm-1'})
    await uploadOne({uploadMedia} as unknown as Backend, new File(['x'], 'ok.png'))
    expect(uploadMedia).toHaveBeenCalledTimes(1)
  })
  it('skips keys removed mid-submit and never attaches a removed id', async () => {
    // Repair X6.1 F3: file 2 was removed during the submit (its key left
    // `files` while the stale `items` snapshot still lists it). The
    // removed done id must not ride the post, and the removed pending
    // row must not fail the submit.
    const uploadMedia = jest.fn().mockResolvedValue({id: 'm-new'})
    const backend = {uploadMedia} as unknown as Backend
    const files = new Map([['a', new File(['x'], 'a.png')]])
    const patches: Array<[string, Partial<UploadItem>]> = []
    const ids = await uploadAll(
      backend,
      [
        item('a', {status: 'done', mediaId: 'm-keep'}),
        item('b', {status: 'done', mediaId: 'm-removed'}),
        item('c', {status: 'staged'}),
      ],
      files,
      (k, p) => patches.push([k, p]),
    )
    // Only the still-present done id survives; no upload attempted for
    // the removed rows, no error recorded on a gone row, no failure.
    expect(ids).toEqual(['m-keep'])
    expect(uploadMedia).not.toHaveBeenCalled()
    expect(patches).toEqual([])
  })
})

describe('attachmentSizeError', () => {
  it('null under/at the cap, honest message over, server decides unknown sizes', () => {
    expect(attachmentSizeError('a.png', 100)).toBeNull()
    expect(attachmentSizeError('a.png', MAX_MEDIA_BYTES)).toBeNull()
    expect(attachmentSizeError('big.png', MAX_MEDIA_BYTES + 1)).toMatch(/too large/)
    expect(attachmentSizeError('mystery.png', 0)).toBeNull()
    expect(attachmentSizeError('mystery.png', NaN)).toBeNull()
  })
})

describe('useUploads size guard', () => {
  it('refuses over-cap Files before staging and reports name + limit', () => {
    const {result} = renderHook(() => useUploads(null))
    const ok = new File(['x'], 'ok.png')
    const big = {size: MAX_MEDIA_BYTES + 1, name: 'big.png'} as unknown as File
    let refused: Array<{name: string; limit: number}> = []
    act(() => {
      refused = result.current.add([
        {file: ok, name: 'ok.png', previewUri: null},
        {file: big, name: 'big.png', previewUri: null},
      ])
    })
    expect(refused).toEqual([{name: 'big.png', limit: MAX_MEDIA_BYTES}])
    expect(result.current.items.map(i => i.name)).toEqual(['ok.png'])
  })

  it('uses the per-kind server cap from the limits', () => {
    const video = {size: 20 * 1024 * 1024, name: 'clip.mp4', type: 'video/mp4'} as unknown as File
    const caps = {imageBytes: 16 * 1024 * 1024, videoBytes: 99 * 1024 * 1024}
    const {result} = renderHook(() => useUploads(null, {}, caps))
    let refused: Array<{name: string; limit: number}> = []
    act(() => {
      refused = result.current.add([{file: video, name: 'clip.mp4', previewUri: null}])
    })
    // 20 MB video fits the 99 MB server cap: staged, nothing refused.
    expect(refused).toEqual([])
    expect(result.current.items.map(i => i.name)).toEqual(['clip.mp4'])
  })
})

const SESS = {id: 's1', origin: 'https://x.example', family: 'misskey'} as unknown as Session

function testClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

function wrapper(client: QueryClient) {
  return function Wrapper({children}: {children: React.ReactNode}) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useEditPost (C7)', () => {
  it('keys session-scoped edit: calls through and patches the cached copy', async () => {
    const updated = post('p1', {content: {edited: true}} as unknown as Partial<Post>)
    const editPost = jest.fn().mockResolvedValue(updated)
    const backend = {editPost} as unknown as Backend
    const client = testClient()
    client.setQueryData(feedQueryKey(SESS.id, 'timeline|home'), feed([post('p1')]))
    const {result} = renderHook(() => useEditPost(SESS, backend), {wrapper: wrapper(client)})
    await result.current.mutateAsync({id: 'p1', draft: {text: 'new'}})
    expect(editPost).toHaveBeenCalledWith('p1', {text: 'new'})
    const data = client.getQueryData<ReturnType<typeof feed>>(feedQueryKey(SESS.id, 'timeline|home'))!
    expect(data.pages[0].items[0].content).toEqual({edited: true})
  })

  it('throws Sign in when session/backend missing', async () => {
    const backend = {editPost: jest.fn()} as unknown as Backend
    const client = testClient()
    const {result} = renderHook(() => useEditPost(null, backend), {wrapper: wrapper(client)})
    await expect(result.current.mutateAsync({id: 'p1', draft: {}})).rejects.toThrow(/sign in/i)
    expect(backend.editPost as jest.Mock).not.toHaveBeenCalled()
  })
})

describe('scheduled hooks (C8b)', () => {
  const sched = (id: string): ScheduledNote => ({id, scheduledAt: '2030-01-01T00:00:00Z', post: null, draft: null})

  it('scheduledPostsKey is session-first; list query calls backend.scheduled.list', async () => {
    expect(scheduledPostsKey('s1')[0]).toBe('s1')
    expect(scheduledPostsKey('s1')).not.toEqual(scheduledPostsKey('s2'))
    const list = jest.fn().mockResolvedValue([sched('a')])
    const backend = {scheduled: {list}} as unknown as Backend
    const {result} = renderHook(() => useScheduledPosts(SESS, backend), {wrapper: wrapper(testClient())})
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(list).toHaveBeenCalled()
    expect(result.current.data?.map(s => s.id)).toEqual(['a'])
  })

  it('list stays disabled without the sub-module and fetches nothing', () => {
    const backend = {} as unknown as Backend
    const {result} = renderHook(() => useScheduledPosts(SESS, backend), {wrapper: wrapper(testClient())})
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('cancel calls delete and invalidates the scheduled list key', async () => {
    const del = jest.fn().mockResolvedValue(undefined)
    const backend = {scheduled: {delete: del}} as unknown as Backend
    const client = testClient()
    client.setQueryData(scheduledPostsKey(SESS.id), [sched('a')])
    const {result} = renderHook(() => useCancelScheduled(SESS, backend), {wrapper: wrapper(client)})
    await result.current.mutateAsync('a')
    expect(del).toHaveBeenCalledWith('a')
    expect(client.getQueryState(scheduledPostsKey(SESS.id))?.isInvalidated).toBe(true)
  })

  it('cancel throws Sign in when signed out, honest error without the sub-module', async () => {
    const client = testClient()
    const {result} = renderHook(() => useCancelScheduled(null, null), {wrapper: wrapper(client)})
    await expect(result.current.mutateAsync('a')).rejects.toThrow(/sign in/i)
    const noMod = renderHook(() => useCancelScheduled(SESS, {} as unknown as Backend), {
      wrapper: wrapper(testClient()),
    })
    await expect(noMod.result.current.mutateAsync('a')).rejects.toThrow(/schedul/i)
  })
})

describe('server draft hooks (C9/MK5)', () => {
  const draft = (id: string): ServerDraft => ({id, text: 'hi'})

  it('serverDraftsKey is session-first; list query calls backend.serverDrafts.list', async () => {
    expect(serverDraftsKey('s1')[0]).toBe('s1')
    expect(serverDraftsKey('s1')).not.toEqual(serverDraftsKey('s2'))
    const list = jest.fn().mockResolvedValue([draft('d1')])
    const backend = {serverDrafts: {list}} as unknown as Backend
    const {result} = renderHook(() => useServerDrafts(SESS, backend), {wrapper: wrapper(testClient())})
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.map(d => d.id)).toEqual(['d1'])
  })

  it('list stays disabled without the sub-module (e.g. Mastodon) and fetches nothing', () => {
    const backend = {} as unknown as Backend
    const {result} = renderHook(() => useServerDrafts(SESS, backend), {wrapper: wrapper(testClient())})
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('save creates without id, updates with id, and invalidates the drafts key', async () => {
    const create = jest.fn().mockResolvedValue(draft('new'))
    const update = jest.fn().mockResolvedValue(draft('d1'))
    const backend = {serverDrafts: {create, update}} as unknown as Backend
    const client = testClient()
    client.setQueryData(serverDraftsKey(SESS.id), [draft('d1')])
    const {result} = renderHook(() => useSaveServerDraft(SESS, backend), {wrapper: wrapper(client)})
    await result.current.mutateAsync({draft: {text: 'fresh'}})
    expect(create).toHaveBeenCalledWith({text: 'fresh'})
    await result.current.mutateAsync({id: 'd1', draft: {text: 'edited'}})
    expect(update).toHaveBeenCalledWith('d1', {text: 'edited'})
    expect(client.getQueryState(serverDraftsKey(SESS.id))?.isInvalidated).toBe(true)
  })

  it('delete calls through and invalidates; missing session/module throw honestly', async () => {
    const del = jest.fn().mockResolvedValue(undefined)
    const backend = {serverDrafts: {delete: del}} as unknown as Backend
    const client = testClient()
    client.setQueryData(serverDraftsKey(SESS.id), [draft('d1')])
    const {result} = renderHook(() => useDeleteServerDraft(SESS, backend), {wrapper: wrapper(client)})
    await result.current.mutateAsync('d1')
    expect(del).toHaveBeenCalledWith('d1')
    expect(client.getQueryState(serverDraftsKey(SESS.id))?.isInvalidated).toBe(true)
    const signedOut = renderHook(() => useDeleteServerDraft(null, null), {wrapper: wrapper(testClient())})
    await expect(signedOut.result.current.mutateAsync('d1')).rejects.toThrow(/sign in/i)
    const noMod = renderHook(() => useDeleteServerDraft(SESS, {} as unknown as Backend), {
      wrapper: wrapper(testClient()),
    })
    await expect(noMod.result.current.mutateAsync('d1')).rejects.toThrow(/draft/i)
  })
})
