// Conversations queries (P6.2): the DM inbox list + one thread, keyed by
// sessionId FIRST (switching accounts never serves the old inbox), with
// delete/mark-read mutations that invalidate the session's inbox rows.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {renderHook, waitFor} from '@testing-library/react-native'

import type {Backend, Conversation, Page} from '@keystone/fedi'

import {
  conversationItems,
  useConversationQuery,
  useConversationsQuery,
  useDeleteConversation,
  useMarkConversationRead,
} from './conversations'
import {conversationQueryKey, conversationsQueryKey} from './keys'

function page<T>(items: T[]): Page<T> {
  return {items, cursor: null, end: true}
}

function conv(id: string, unread = false): Conversation {
  return {id, unread} as Conversation
}

function fakeBackend(over: Record<string, jest.Mock> = {}): Backend {
  const conversations = {
    list: over.list ?? jest.fn(async () => page<Conversation>([])),
    get: over.get ?? jest.fn(async (id: string) => conv(id)),
    delete: over.delete ?? jest.fn(async () => undefined),
    markRead: over.markRead ?? jest.fn(async (id: string) => conv(id, false)),
  }
  return {conversations} as unknown as Backend
}

function testClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

function wrapper(client: QueryClient) {
  return ({children}: {children: React.ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('conversations query keys (session first)', () => {
  it('keys the inbox by sessionId and pages the backend list', async () => {
    const client = testClient()
    const backend = fakeBackend({list: jest.fn(async () => page([conv('c1', true)]))})
    const {result} = renderHook(() => useConversationsQuery('sess-a', {backend}), {
      wrapper: wrapper(client),
    })
    expect(result.current.queryKey[0]).toBe('sess-a')
    expect(result.current.queryKey).toEqual(conversationsQueryKey('sess-a'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(conversationItems(result.current.data).map(c => c.id)).toEqual(['c1'])
    expect(backend.conversations!.list).toHaveBeenCalledWith(
      expect.objectContaining({limit: 20}),
    )
  })

  it('switching accounts switches inbox keys and never serves the old rows', async () => {
    const backendA = fakeBackend({list: jest.fn(async () => page([conv('a1', true)]))})
    const backendB = fakeBackend({list: jest.fn(async () => page([conv('b1')]))})
    const client = testClient()
    const {result, rerender} = renderHook(
      ({sessionId, backend}: {sessionId: string; backend: Backend}) =>
        useConversationsQuery(sessionId, {backend}),
      {initialProps: {sessionId: 'sess-a', backend: backendA}, wrapper: wrapper(client)},
    )
    await waitFor(() => expect(conversationItems(result.current.data).map(c => c.id)).toEqual(['a1']))
    expect(result.current.queryKey[0]).toBe('sess-a')

    rerender({sessionId: 'sess-b', backend: backendB})
    await waitFor(() => expect(conversationItems(result.current.data).map(c => c.id)).toEqual(['b1']))
    expect(result.current.queryKey).toEqual(conversationsQueryKey('sess-b'))
  })

  it('keys one thread by session + conversation id', async () => {
    const client = testClient()
    const backend = fakeBackend({get: jest.fn(async (id: string) => conv(id, true))})
    const {result} = renderHook(() => useConversationQuery('sess-a', 'c1', {backend}), {
      wrapper: wrapper(client),
    })
    expect(result.current.queryKey).toEqual(conversationQueryKey('sess-a', 'c1'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('c1')
    expect(backend.conversations!.get).toHaveBeenCalledWith('c1')
  })

  it('delete removes the row server-side and invalidates the session inbox', async () => {
    const client = testClient()
    const backend = fakeBackend()
    const {result} = renderHook(() => useDeleteConversation('sess-a', {backend}), {
      wrapper: wrapper(client),
    })
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    await result.current.mutateAsync('c1')
    expect(backend.conversations!.delete).toHaveBeenCalledWith('c1')
    expect(invalidate).toHaveBeenCalledWith({queryKey: ['sess-a', 'conversations']})
  })

  it('mark-read returns the updated row and invalidates the session inbox', async () => {
    const client = testClient()
    const backend = fakeBackend()
    const {result} = renderHook(() => useMarkConversationRead('sess-a', {backend}), {
      wrapper: wrapper(client),
    })
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const updated = await result.current.mutateAsync('c1')
    expect(backend.conversations!.markRead).toHaveBeenCalledWith('c1')
    expect(updated.unread).toBe(false)
    expect(invalidate).toHaveBeenCalledWith({queryKey: ['sess-a', 'conversations']})
  })
})
