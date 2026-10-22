// Chat queries (P6.2 §2.2): room list + room/user threads, keyed by
// sessionId FIRST (switching accounts never serves the old rooms), with
// send/delete mutations that invalidate the session's thread rows, and
// pure live-merge helpers (id-deduped prepend, deleted drops the row).

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {renderHook, waitFor} from '@testing-library/react-native'

import type {Backend, ChatMessage, ChatRoom, ChatRoomMembership, Page} from '@keystone/fedi'

import {
  chatMessageItems,
  chatRoomItems,
  dropChatMessage,
  mergeChatMessage,
  useChatRoomMessagesQuery,
  useChatRoomQuery,
  useChatRoomsQuery,
  useChatUserMessagesQuery,
  useDeleteChatMessage,
  useReadAllChat,
  useSendChatMessage,
} from './chat'
import {chatRoomMessagesQueryKey, chatRoomsQueryKey, chatUserMessagesQueryKey} from './keys'

function page<T>(items: T[]): Page<T> {
  return {items, cursor: null, end: true}
}

function room(id: string): ChatRoom {
  return {id, name: `room ${id}`, ownerId: 'o1'} as ChatRoom
}

function membership(id: string, roomId: string): ChatRoomMembership {
  return {id, roomId, room: room(roomId)} as ChatRoomMembership
}

function message(id: string, text: string | null = 'hi'): ChatMessage {
  return {id, text, fromAccountId: 'u1'} as ChatMessage
}

function fakeBackend(over: Record<string, jest.Mock> = {}): Backend {
  const chat = {
    rooms: over.rooms ?? jest.fn(async () => page<ChatRoomMembership>([])),
    history: over.history ?? jest.fn(async () => []),
    showRoom: over.showRoom ?? jest.fn(async (roomId: string) => room(roomId)),
    createRoom: over.createRoom ?? jest.fn(async (name: string) => room('new')),
    roomMessages: over.roomMessages ?? jest.fn(async () => page<ChatMessage>([])),
    userMessages: over.userMessages ?? jest.fn(async () => page<ChatMessage>([])),
    showMessage: over.showMessage ?? jest.fn(async (id: string) => message(id)),
    sendToRoom: over.sendToRoom ?? jest.fn(async (roomId: string) => message('sent')),
    sendToUser: over.sendToUser ?? jest.fn(async (userId: string) => message('sent')),
    deleteMessage: over.deleteMessage ?? jest.fn(async () => undefined),
    readAll: over.readAll ?? jest.fn(async () => undefined),
  }
  return {chat} as unknown as Backend
}

function testClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

function wrapper(client: QueryClient) {
  return ({children}: {children: React.ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('chat query keys (session first)', () => {
  it('keys the room list by sessionId and pages the backend rooms', async () => {
    const client = testClient()
    const backend = fakeBackend({rooms: jest.fn(async () => page([membership('m1', 'r1')]))})
    const {result} = renderHook(() => useChatRoomsQuery('sess-a', {backend}), {
      wrapper: wrapper(client),
    })
    expect(result.current.queryKey[0]).toBe('sess-a')
    expect(result.current.queryKey).toEqual(chatRoomsQueryKey('sess-a'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(chatRoomItems(result.current.data).map(m => m.roomId)).toEqual(['r1'])
    expect(backend.chat!.rooms).toHaveBeenCalledWith(expect.objectContaining({limit: 20}))
  })

  it('keys room threads by session + room and pages roomMessages', async () => {
    const client = testClient()
    const backend = fakeBackend({
      roomMessages: jest.fn(async () => page([message('msg1')])),
    })
    const {result} = renderHook(() => useChatRoomMessagesQuery('sess-a', 'r1', {backend}), {
      wrapper: wrapper(client),
    })
    expect(result.current.queryKey).toEqual(chatRoomMessagesQueryKey('sess-a', 'r1'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(chatMessageItems(result.current.data).map(m => m.id)).toEqual(['msg1'])
  })

  it('keys 1-on-1 threads by session + user and pages userMessages', async () => {
    const client = testClient()
    const backend = fakeBackend({
      userMessages: jest.fn(async () => page([message('msg2')])),
    })
    const {result} = renderHook(() => useChatUserMessagesQuery('sess-a', 'u9', {backend}), {
      wrapper: wrapper(client),
    })
    expect(result.current.queryKey).toEqual(chatUserMessagesQueryKey('sess-a', 'u9'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(backend.chat!.userMessages).toHaveBeenCalledWith(
      'u9',
      expect.objectContaining({limit: 20}),
    )
  })

  it('reads one room through showRoom', async () => {
    const client = testClient()
    const backend = fakeBackend()
    const {result} = renderHook(() => useChatRoomQuery('sess-a', 'r1', {backend}), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('r1')
  })

  it('throws the honest error when the backend has no chat module', async () => {
    const client = testClient()
    const backend = {} as Backend
    const {result} = renderHook(() => useChatRoomsQuery('sess-a', {backend, retry: 0}), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(String(result.current.error)).toMatch(/not available on this server/i)
  })
})

describe('chat mutations invalidate the session thread rows', () => {
  it('sendToRoom invalidates the room thread key', async () => {
    const client = testClient()
    const sendToRoom = jest.fn(async () => message('sent'))
    const backend = fakeBackend({sendToRoom})
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const {result} = renderHook(() => useSendChatMessage('sess-a', {backend}), {
      wrapper: wrapper(client),
    })
    await result.current.mutateAsync({roomId: 'r1', text: 'hi'})
    expect(sendToRoom).toHaveBeenCalledWith('r1', 'hi')
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatRoomMessagesQueryKey('sess-a', 'r1'),
    })
  })

  it('sendToUser invalidates the 1-on-1 thread key', async () => {
    const client = testClient()
    const sendToUser = jest.fn(async () => message('sent'))
    const backend = fakeBackend({sendToUser})
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const {result} = renderHook(() => useSendChatMessage('sess-a', {backend}), {
      wrapper: wrapper(client),
    })
    await result.current.mutateAsync({userId: 'u9', text: 'hi'})
    expect(sendToUser).toHaveBeenCalledWith('u9', 'hi')
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatUserMessagesQueryKey('sess-a', 'u9'),
    })
  })

  it('deleteMessage invalidates the thread key', async () => {
    const client = testClient()
    const deleteMessage = jest.fn(async () => undefined)
    const backend = fakeBackend({deleteMessage})
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const {result} = renderHook(() => useDeleteChatMessage('sess-a', {backend}), {
      wrapper: wrapper(client),
    })
    await result.current.mutateAsync({roomId: 'r1', messageId: 'msg1'})
    expect(deleteMessage).toHaveBeenCalledWith('msg1')
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatRoomMessagesQueryKey('sess-a', 'r1'),
    })
  })

  it('readAll invalidates the room list', async () => {
    const client = testClient()
    const readAll = jest.fn(async () => undefined)
    const backend = fakeBackend({readAll})
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const {result} = renderHook(() => useReadAllChat('sess-a', {backend}), {
      wrapper: wrapper(client),
    })
    await result.current.mutateAsync()
    expect(readAll).toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({queryKey: chatRoomsQueryKey('sess-a')})
  })
})

describe('live merge helpers (pure)', () => {
  it('prepends a live message once (id-deduped)', () => {
    const data = {
      pages: [page([message('a'), message('b')])],
      pageParams: [null],
    }
    const merged = mergeChatMessage(data, message('live'))
    expect(merged!.pages[0].items.map(m => m.id)).toEqual(['live', 'a', 'b'])
    // A redelivery of a cached id changes nothing.
    expect(mergeChatMessage(merged, message('a'))).toBe(merged)
  })

  it('drops a live-deleted message', () => {
    const data = {
      pages: [page([message('a'), message('b')])],
      pageParams: [null],
    }
    const dropped = dropChatMessage(data, 'a')
    expect(dropped!.pages[0].items.map(m => m.id)).toEqual(['b'])
  })
})
