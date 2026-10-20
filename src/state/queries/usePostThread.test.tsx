import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {renderHook, waitFor} from '@testing-library/react-native'
import React from 'react'

import type {Backend, Page, Post} from '@keystone/fedi'

import {makePost} from '#/components/__tests__/fixtures'

import {
  fetchPostThread,
  threadQueryKey,
  threadRepliesQueryKey,
  usePostThreadQuery,
  useThreadRepliesQuery,
} from './usePostThread'

// Thread query tests: session-scoped keys (switching accounts never serves
// the previous account's thread) and honest error states — a failed load
// surfaces the error, never a faked post.

const SESSION_A = 'session-a'
const SESSION_B = 'session-b'

function page<T>(items: T[], end = true): Page<T> {
  return {items, cursor: null, end}
}

function fakeBackend(over: Record<string, unknown> = {}) {
  const ancestor = makePost({id: 'a0', content: {mfm: 'ancestor', plain: 'ancestor'}})
  const focused = makePost({
    id: 'p1',
    replyToId: 'a0',
    content: {mfm: 'focused', plain: 'focused'},
  })
  const reply = makePost({id: 'r1', content: {mfm: 'reply', plain: 'reply'}})
  return {
    ancestor,
    focused,
    reply,
    post: jest.fn(async () => focused),
    thread: jest.fn(async () => ({ancestors: [ancestor], incomplete: false})),
    threadReplies: jest.fn(async () => page([reply])),
    ...over,
  }
}

function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {queries: {retry: false, gcTime: 60_000}},
  })
}

function wrapper(client = testClient()) {
  return function Wrapper({children}: {children: React.ReactNode}) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('fetchPostThread', () => {
  it('loads the post then its ancestors through the same backend', async () => {
    const b = fakeBackend()
    const thread = await fetchPostThread(b as unknown as Backend, 'p1')
    expect(b.post).toHaveBeenCalledWith('p1')
    expect(b.thread).toHaveBeenCalledWith(expect.objectContaining({id: 'p1'}))
    expect(thread.focused.id).toBe('p1')
    expect(thread.ancestors.map(a => a.id)).toEqual(['a0'])
    expect(thread.incomplete).toBe(false)
  })

  it('a pure-renote wrapper resolves to the original as the thread subject', async () => {
    const original = makePost({id: 'orig', content: {mfm: 'o', plain: 'o'}})
    const wrapperPost = makePost({
      id: 'wrap',
      renote: original,
      renoteId: 'orig',
      content: {plain: ''},
    })
    const b = fakeBackend({post: jest.fn(async () => wrapperPost)})
    const thread = await fetchPostThread(b as unknown as Backend, 'wrap')
    expect(thread.post.id).toBe('wrap')
    expect(thread.focused.id).toBe('orig')
    expect(b.thread).toHaveBeenCalledWith(expect.objectContaining({id: 'orig'}))
  })
})

describe('usePostThreadQuery', () => {
  it('keys carry the sessionId first, so accounts never share a thread', () => {
    expect(threadQueryKey(SESSION_A, 'p1')[0]).toBe(SESSION_A)
    expect(threadQueryKey(SESSION_A, 'p1')).not.toEqual(threadQueryKey(SESSION_B, 'p1'))
    expect(threadRepliesQueryKey(SESSION_A, 'p1')[0]).toBe(SESSION_A)
  })

  it('returns post + ancestors on success', async () => {
    const b = fakeBackend()
    const {result} = renderHook(
      () => usePostThreadQuery(SESSION_A, 'p1', {backend: b as unknown as Backend}),
      {wrapper: wrapper()},
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.focused.id).toBe('p1')
    expect(result.current.data?.ancestors.map((a: Post) => a.id)).toEqual(['a0'])
  })

  it('stays disabled without a session and fetches nothing', async () => {
    const b = fakeBackend()
    const {result} = renderHook(
      () => usePostThreadQuery(null, 'p1', {backend: b as unknown as Backend}),
      {wrapper: wrapper()},
    )
    expect(result.current.fetchStatus).toBe('idle')
    expect(b.post).not.toHaveBeenCalled()
  })

  it('a failed load surfaces the error — never a faked post', async () => {
    const b = fakeBackend({post: jest.fn(async () => { throw new Error('gone') })})
    const {result} = renderHook(
      () => usePostThreadQuery(SESSION_A, 'p1', {backend: b as unknown as Backend}),
      {wrapper: wrapper()},
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(result.current.error?.message).toBe('gone')
  })
})

describe('useThreadRepliesQuery', () => {
  it('pages direct replies for one session + parent', async () => {
    const b = fakeBackend()
    const {result} = renderHook(
      () => useThreadRepliesQuery(SESSION_A, 'p1', {backend: b as unknown as Backend}),
      {wrapper: wrapper()},
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.pages.flatMap(p => p.items).map((p: Post) => p.id)).toEqual(['r1'])
    expect(b.threadReplies).toHaveBeenCalledWith('p1', expect.objectContaining({cursor: null}))
  })

  it('a failed replies load surfaces the error, never an empty fake', async () => {
    const b = fakeBackend({
      threadReplies: jest.fn(async () => { throw new Error('nope') }),
    })
    const {result} = renderHook(
      () => useThreadRepliesQuery(SESSION_A, 'p1', {backend: b as unknown as Backend}),
      {wrapper: wrapper()},
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
