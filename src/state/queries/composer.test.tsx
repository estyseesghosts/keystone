import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, renderHook, waitFor} from '@testing-library/react-native'
import React from 'react'

import {createMemoryStore, type Backend, type Post, type ScheduledNote, type ServerDraft, type Session} from '@keystone/fedi'

import {feedQueryKey} from './keys'
import {
  MAX_MEDIA_BYTES,
  attachmentSizeError,
  dismissVideoNotice,
  insertCreatedPost,
  isWebAssetUri,
  readRemindAltText,
  resetVideoNoticesForTests,
  scheduledPostsKey,
  serverDraftsKey,
  shouldShowVideoNotice,
  strippableMime,
  stripImageForUpload,
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
  webXhrUpload,
  writeRemindAltText,
  type UploadItem,
} from './composer'

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: {JPEG: 'jpeg', PNG: 'png', WEBP: 'webp'},
}))

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(),
}))

const Manip = require('expo-image-manipulator') as {
  manipulateAsync: jest.Mock
  SaveFormat: {JPEG: string}
}
const FS = require('expo-file-system') as {getInfoAsync: jest.Mock}

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

  it('cancels in-flight feed reads for every written timeline before inserting', () => {
    const qc = new QueryClient()
    for (const d of ['timeline|home', 'timeline|social', 'user|me|posts']) {
      qc.setQueryData(feedQueryKey('s', d), feed([post('p1')]))
    }
    const cancel = jest.spyOn(qc, 'cancelQueries')
    insertCreatedPost(qc, 's', visPost('new', 'public'), null)
    for (const d of ['timeline|home', 'timeline|social', 'user|me|posts']) {
      expect(cancel).toHaveBeenCalledWith({queryKey: feedQueryKey('s', d)})
    }
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
    progress: null,
    mimeType: null,
    keepOriginal: false,
    hadGps: null,
    ...over,
  })

  it('uploads with alt as comment, skips done items, reports status', async () => {
    const uploadMedia = jest.fn().mockImplementation(async () => ({id: 'm-new', url: 'https://x.example/m-new.png'}))
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
      .mockResolvedValueOnce({id: 'm1', url: 'https://x.example/m1.png'})
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
    expect(refused).toEqual([{name: 'big.png', limit: MAX_MEDIA_BYTES, reason: 'too-large'}])
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

describe('uploadAll concurrency (X7.4 step 4)', () => {
  const item = (key: string, over: Partial<UploadItem> = {}): UploadItem => ({
    key,
    name: key,
    previewUri: null,
    status: 'staged',
    mediaId: null,
    alt: '',
    sensitive: false,
    error: null,
    progress: null,
    mimeType: null,
    keepOriginal: false,
    hadGps: null,
    ...over,
  })

  it('uploads up to the limit in parallel and returns ids in item order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const uploadMedia: jest.Mock = jest.fn(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      const id = `m-${uploadMedia.mock.calls.length - 1}`
      // One macrotask of "network": the two workers interleave through
      // real timer FIFO order, deterministically.
      await new Promise(resolve => setTimeout(resolve, 0))
      inFlight -= 1
      return {id, url: `https://x.example/${id}.png`}
    })
    const files = new Map(
      ['a', 'b', 'c', 'd', 'e', 'f'].map(k => [k, new File(['x'], `${k}.png`)] as [string, File]),
    )
    const ids = await uploadAll(
      {uploadMedia} as unknown as Backend,
      ['a', 'b', 'c', 'd', 'e', 'f'].map(k => item(k)),
      files,
      () => {},
      {},
      null,
      {concurrency: 2},
    )
    expect(maxInFlight).toBe(2)
    expect(ids).toEqual(['m-0', 'm-1', 'm-2', 'm-3', 'm-4', 'm-5'])
    expect(uploadMedia).toHaveBeenCalledTimes(6)
  })

  it('keeps successes on retry (failed items retry, done items never re-send)', async () => {
    const uploadMedia = jest
      .fn()
      .mockResolvedValueOnce({id: 'm-a', url: 'https://x.example/a.png'})
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({id: 'm-b', url: 'https://x.example/b.png'})
    const files = new Map([
      ['a', new File(['x'], 'a.png')],
      ['b', new File(['y'], 'b.png')],
    ])
    const backend = {uploadMedia} as unknown as Backend
    const patches: Record<string, Partial<UploadItem>> = {}
    const first = await uploadAll(
      backend,
      [item('a'), item('b')],
      files,
      (k, p) => (patches[k] = {...patches[k], ...p}),
    )
    expect(first).toBeNull()
    expect(patches.a.status).toBe('done')
    expect(patches.b.status).toBe('error')
    // Retry with the success recorded: only `b` re-sends.
    uploadMedia.mockClear()
    const second = await uploadAll(
      backend,
      [item('a', {status: 'done', mediaId: 'm-a'}), item('b', {status: 'error'})],
      files,
      () => {},
    )
    expect(uploadMedia).toHaveBeenCalledTimes(1)
    expect(second).toEqual(['m-a', 'm-b'])
  })

  it('maps a caller abort back to staged (explicit Cancel never errors the row)', async () => {
    const signals: AbortSignal[] = []
    const uploadMedia = jest.fn(
      (_file: unknown, opts: {signal?: AbortSignal} = {}) =>
        new Promise((_resolve, reject) => {
          signals.push(opts.signal!)
          opts.signal?.addEventListener('abort', () => {
            const err = new Error('Request was cancelled.') as Error & {kind: string; code: string}
            err.kind = 'aborted'
            err.code = 'errors.network.aborted'
            reject(err)
          })
        }),
    )
    const ctrls = new Map<string, AbortController>()
    const files = new Map([['a', new File(['x'], 'a.png')]])
    const patches: Record<string, Partial<UploadItem>> = {}
    const promise = uploadAll(
      {uploadMedia} as unknown as Backend,
      [item('a')],
      files,
      (k, p) => (patches[k] = {...patches[k], ...p}),
      {},
      null,
      {
        signalFor: key => {
          const c = new AbortController()
          ctrls.set(key, c)
          return c.signal
        },
      },
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(signals).toHaveLength(1)
    ctrls.get('a')!.abort()
    await expect(promise).resolves.toBeNull()
    expect(patches.a.status).toBe('staged')
    expect(patches.a.error).toBeNull()
  })
})

describe('uploadAll processing re-check (X7.4 step 5)', () => {
  const item = (key: string, over: Partial<UploadItem> = {}): UploadItem => ({
    key,
    name: key,
    previewUri: null,
    status: 'staged',
    mediaId: null,
    alt: '',
    sensitive: false,
    error: null,
    progress: null,
    mimeType: null,
    keepOriginal: false,
    hadGps: null,
    ...over,
  })

  it('marks a null-URL upload processing (never done) and still attaches its id', async () => {
    const uploadMedia = jest.fn(async () => ({id: 'm1', url: null}))
    const patches: Record<string, Partial<UploadItem>> = {}
    const ids = await uploadAll(
      {uploadMedia} as unknown as Backend,
      [item('a')],
      new Map([['a', new File(['x'], 'a.png')]]),
      (k, p) => (patches[k] = {...patches[k], ...p}),
    )
    expect(ids).toEqual(['m1'])
    expect(patches.a).toMatchObject({status: 'processing', mediaId: 'm1'})
  })

  it('re-checks processing rows through updateMedia on the next run', async () => {
    const updateMedia = jest.fn(async () => ({id: 'm1', url: 'https://x.example/m1.png'}))
    const patches: Record<string, Partial<UploadItem>> = {}
    const ids = await uploadAll(
      {updateMedia} as unknown as Backend,
      [item('a', {status: 'processing', mediaId: 'm1', alt: 'a cat'})],
      new Map([['a', new File(['x'], 'a.png')]]),
      (k, p) => (patches[k] = {...patches[k], ...p}),
    )
    expect(updateMedia).toHaveBeenCalledWith('m1', {description: 'a cat'})
    expect(patches.a).toMatchObject({status: 'done'})
    expect(ids).toEqual(['m1'])
  })

  it('keeps a still-processing row processing when the re-check finds no URL', async () => {
    const updateMedia = jest.fn(async () => ({id: 'm1', url: null}))
    const patches: Record<string, Partial<UploadItem>> = {}
    const ids = await uploadAll(
      {updateMedia} as unknown as Backend,
      [item('a', {status: 'processing', mediaId: 'm1'})],
      new Map([['a', new File(['x'], 'a.png')]]),
      (k, p) => (patches[k] = {...patches[k], ...p}),
    )
    expect(ids).toEqual(['m1'])
    expect(patches.a?.status).not.toBe('done')
  })
})

describe('useUploads cancel + remove (X7.4 step 1)', () => {
  function file(name = 'a.png') {
    return {file: new File(['x'], name), name, previewUri: null}
  }

  it('remove() aborts the in-flight request', async () => {
    const signals: AbortSignal[] = []
    const uploadMedia = jest.fn(
      (_f: unknown, opts: {signal?: AbortSignal} = {}) =>
        new Promise((_, reject) => {
          signals.push(opts.signal!)
          // Like the real transports (X7.4 step 1): abort rejects the
          // in-flight send so `remove()` can settle the batch.
          opts.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            {once: true},
          )
        }),
    )
    const {result} = renderHook(() => useUploads({uploadMedia} as unknown as Backend))
    act(() => {
      result.current.add([file()])
    })
    const key = result.current.items[0].key
    let pending: Promise<string[] | null> | null = null
    act(() => {
      pending = result.current.ensureUploaded()
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    act(() => {
      result.current.remove(key)
    })
    expect(signals[0].aborted).toBe(true)
    await act(async () => {
      await expect(pending!).resolves.toBeNull()
    })
    expect(result.current.items).toEqual([])
  })

  it('remove() best-effort deletes a stored Misskey file, and drops Mastodon ids silently', async () => {
    const deleteFile = jest.fn(async () => undefined)
    const backend = {
      uploadMedia: jest.fn(async () => ({id: 'm1', url: 'https://x.example/m1.png'})),
      drive: {deleteFile},
    } as unknown as Backend
    const {result} = renderHook(() => useUploads(backend))
    act(() => {
      result.current.add([file()])
    })
    const key = result.current.items[0].key
    await act(async () => {
      await result.current.ensureUploaded()
    })
    expect(result.current.items[0].status).toBe('done')
    act(() => {
      result.current.remove(key)
    })
    expect(deleteFile).toHaveBeenCalledWith('m1')
  })

  it('remove() of a stored row without a drive module just drops it', async () => {
    const backend = {
      uploadMedia: jest.fn(async () => ({id: 'm1', url: null})),
    } as unknown as Backend
    const {result} = renderHook(() => useUploads(backend))
    act(() => {
      result.current.add([file()])
    })
    const key = result.current.items[0].key
    await act(async () => {
      await result.current.ensureUploaded()
    })
    expect(result.current.items[0].status).toBe('processing')
    act(() => {
      result.current.remove(key)
    })
    expect(result.current.items).toEqual([])
  })
})

describe('strip + re-encode (X7.4 step 6, D9)', () => {
  beforeEach(() => {
    Manip.manipulateAsync.mockReset()
    FS.getInfoAsync.mockReset()
  })

  it('strippableMime covers JPEG/HEIC/PNG stills only', () => {
    expect(strippableMime('image/jpeg')).toBe(true)
    expect(strippableMime('image/heic')).toBe(true)
    expect(strippableMime('image/heif')).toBe(true)
    expect(strippableMime('image/png')).toBe(true)
    expect(strippableMime('image/jpeg; charset=binary')).toBe(true)
    expect(strippableMime('image/gif')).toBe(false)
    expect(strippableMime('image/webp')).toBe(false)
    expect(strippableMime('video/mp4')).toBe(false)
    expect(strippableMime(null)).toBe(false)
    expect(strippableMime(undefined)).toBe(false)
  })

  it('isWebAssetUri splits blob/data from native references', () => {
    expect(isWebAssetUri('blob:https://x/1')).toBe(true)
    expect(isWebAssetUri('data:image/png;base64,xx')).toBe(true)
    expect(isWebAssetUri('file:///tmp/a.jpg')).toBe(false)
    expect(isWebAssetUri('ph://ABC')).toBe(false)
    expect(isWebAssetUri('content://media/a')).toBe(false)
  })

  it('uploadOne strips a JPEG by default and sends the re-encoded file', async () => {
    const realCreate = URL.createObjectURL
    const realFetch = globalThis.fetch
    ;(URL as unknown as {createObjectURL: unknown}).createObjectURL = jest.fn(() => 'blob:in')
    Manip.manipulateAsync.mockResolvedValue({uri: 'blob:out'})
    globalThis.fetch = jest.fn(async (url: unknown) => {
      if (url === 'blob:out') return {blob: async () => new Blob(['y'], {type: 'image/jpeg'})}
      return realFetch(url as unknown as RequestInfo)
    }) as unknown as typeof fetch
    try {
      const uploadMedia: jest.Mock = jest.fn(async () => ({id: 'm1', url: 'https://x.example/m1.jpg'}))
      const jpeg = new File(['x'], 'photo.jpg', {type: 'image/jpeg'})
      const {id, processing} = await uploadOne({uploadMedia} as unknown as Backend, jpeg, {
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
      })
      expect(id).toBe('m1')
      expect(processing).toBe(false)
      expect(Manip.manipulateAsync).toHaveBeenCalledWith(
        'blob:in',
        [],
        {compress: 0.92, format: 'jpeg'},
      )
      const sent = uploadMedia.mock.calls[0][0] as File
      expect(sent).toBeInstanceOf(File)
      expect(sent.name).toBe('photo.jpg')
      expect(sent.type).toBe('image/jpeg')
    } finally {
      ;(URL as unknown as {createObjectURL: unknown}).createObjectURL = realCreate
      globalThis.fetch = realFetch
    }
  })

  it('uploadOne keeps the original when keepOriginal is set (no manipulator call)', async () => {
    const uploadMedia: jest.Mock = jest.fn(async () => ({id: 'm1', url: 'https://x.example/m1.jpg'}))
    const jpeg = new File(['x'], 'photo.jpg', {type: 'image/jpeg'})
    await uploadOne({uploadMedia} as unknown as Backend, jpeg, {
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      keepOriginal: true,
    })
    expect(Manip.manipulateAsync).not.toHaveBeenCalled()
    expect(uploadMedia.mock.calls[0][0]).toBe(jpeg)
  })

  it('uploadOne falls back to the original when the manipulator fails', async () => {
    const realCreate = URL.createObjectURL
    ;(URL as unknown as {createObjectURL: unknown}).createObjectURL = jest.fn(() => 'blob:in')
    Manip.manipulateAsync.mockRejectedValue(new Error('no native module'))
    try {
      const uploadMedia: jest.Mock = jest.fn(async () => ({id: 'm1', url: 'https://x.example/m1.jpg'}))
      const jpeg = new File(['x'], 'photo.jpg', {type: 'image/jpeg'})
      await uploadOne({uploadMedia} as unknown as Backend, jpeg, {
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
      })
      expect(uploadMedia.mock.calls[0][0]).toBe(jpeg)
    } finally {
      ;(URL as unknown as {createObjectURL: unknown}).createObjectURL = realCreate
    }
  })

  it('stripImageForUpload re-targets a native reference without reading bytes', async () => {
    Manip.manipulateAsync.mockResolvedValue({uri: 'file:///cache/stripped.jpg'})
    FS.getInfoAsync.mockResolvedValue({exists: true, size: 4321})
    const ref = {uri: 'file:///tmp/orig.heic', name: 'orig.heic', type: 'image/heic', size: 9999}
    const out = await stripImageForUpload(ref, 'orig.heic', 'image/heic')
    expect(out.stripped).toBe(true)
    expect(out.source).toEqual({uri: 'file:///cache/stripped.jpg', name: 'orig.jpg', type: 'image/jpeg', size: 4321})
    expect(FS.getInfoAsync).toHaveBeenCalledWith('file:///cache/stripped.jpg')
  })
})

describe('alt-text reminder pref + video notice (X7.4 steps 6-7)', () => {
  it('readRemindAltText defaults off and round-trips', () => {
    const store = createMemoryStore()
    expect(readRemindAltText(store)).toBe(false)
    writeRemindAltText(store, true)
    expect(readRemindAltText(store)).toBe(true)
    writeRemindAltText(store, false)
    expect(readRemindAltText(store)).toBe(false)
  })

  it('video notice shows once per session until dismissed', () => {
    resetVideoNoticesForTests()
    expect(shouldShowVideoNotice('s1', false)).toBe(false)
    expect(shouldShowVideoNotice('s1', true)).toBe(true)
    dismissVideoNotice('s1')
    expect(shouldShowVideoNotice('s1', true)).toBe(false)
    expect(shouldShowVideoNotice('s2', true)).toBe(true)
    resetVideoNoticesForTests()
    expect(shouldShowVideoNotice('s1', true)).toBe(true)
  })
})

describe('webXhrUpload (X7.4 step 1)', () => {
  const realXhr = (globalThis as unknown as {XMLHttpRequest?: unknown}).XMLHttpRequest

  function fakeXhr(behavior: (xhr: Record<string, unknown>) => void) {
    const instances: Array<Record<string, unknown>> = []
    const Ctor = function (this: Record<string, unknown>) {
      const self: Record<string, unknown> = {
        headers: {},
        upload: {onprogress: null},
        open: jest.fn((method: string, url: string) => {
          self.method = method
          self.url = url
        }),
        setRequestHeader: jest.fn((k: string, v: string) => {
          ;(self.headers as Record<string, string>)[k] = v
        }),
        send: jest.fn((body: unknown) => {
          self.body = body
          behavior(self)
        }),
        abort: jest.fn(() => {
          ;(self.onabort as (() => void) | null)?.()
        }),
      }
      instances.push(self)
      return self
    }
    ;(globalThis as unknown as {XMLHttpRequest?: unknown}).XMLHttpRequest =
      Ctor as unknown as typeof XMLHttpRequest
    return instances
  }

  afterEach(() => {
    ;(globalThis as unknown as {XMLHttpRequest?: unknown}).XMLHttpRequest = realXhr
  })

  it('sends headers + body, forwards byte progress, and resolves the transport shape', async () => {
    const instances = fakeXhr(self => {
      ;(self.upload as {onprogress: ((ev: {loaded: number; total: number}) => void) | null}).onprogress?.({
        loaded: 50,
        total: 100,
      })
      ;(self.upload as {onprogress: ((ev: {loaded: number; total: number}) => void) | null}).onprogress?.({
        loaded: 100,
        total: 0,
      })
      self.status = 200
      self.responseText = '{"id":"m1"}'
      self.responseURL = 'https://s.example/api/v2/media'
      ;(self.onload as () => void)()
    })
    const seen: Array<[number, number | null]> = []
    const out = await webXhrUpload({
      url: 'https://s.example/api/v2/media',
      method: 'POST',
      headers: {Authorization: 'Bearer t'},
      body: new FormData(),
      timeoutMs: 60_000,
      onProgress: (l, t) => seen.push([l, t]),
    })
    expect(out).toEqual({status: 200, bodyText: '{"id":"m1"}', responseUrl: 'https://s.example/api/v2/media'})
    expect(seen).toEqual([
      [50, 100],
      [100, null],
    ])
    expect((instances[0].headers as Record<string, string>).Authorization).toBe('Bearer t')
  })

  it('rejects with an AbortError-named error when the signal fires', async () => {
    fakeXhr(() => {})
    const ctrl = new AbortController()
    const promise = webXhrUpload({
      url: 'https://s.example/api/v2/media',
      method: 'POST',
      headers: {},
      body: new FormData(),
      timeoutMs: 60_000,
      signal: ctrl.signal,
    })
    ctrl.abort()
    await expect(promise).rejects.toMatchObject({name: 'AbortError'})
  })

  it('rejects honestly without an XHR global', async () => {
    ;(globalThis as unknown as {XMLHttpRequest?: unknown}).XMLHttpRequest = undefined
    await expect(
      webXhrUpload({
        url: 'https://s.example/api/v2/media',
        method: 'POST',
        headers: {},
        body: new FormData(),
        timeoutMs: 60_000,
      }),
    ).rejects.toMatchObject({code: 'errors.network.unreachableBare'})
  })
})
