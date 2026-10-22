// Chat queries (P6.2, clickstone §2.2): react-query state for the
// Misskey room list + room/user threads, keyed by `chatRoomsQueryKey` /
// `chatRoomQueryKey` / `chatRoomMessagesQueryKey` /
// `chatUserMessagesQueryKey` (sessionId FIRST — switching accounts
// switches keys, never data).
//
// - `useChatRoomsQuery` pages `Backend.chat.rooms` (memberships, both
//   directions).
// - `useChatRoomQuery` reads `Backend.chat.showRoom`.
// - `useChatRoomMessagesQuery` / `useChatUserMessagesQuery` page the
//   server-paged timelines (fetching marks read server-side, so there is
//   no mark-read mutation — opening the thread IS the mark).
// - `useSendChatMessage` / `useDeleteChatMessage` run the backend
//   mutation and invalidate this session's thread queries on success, so
//   rows come from the SERVER's answer — the cache is never locally
//   pruned into a lie.
// - `useChatRoomLive` / `useChatUserLive` subscribe the session's
//   `chatRoom` / `chatUser` stream channels and merge events into the
//   thread cache (id-deduped prepend; deleted drops the row). Feeds never
//   depend on the socket: paging + refresh work with no subscription.

import {useEffect} from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'

import {
  backendForSession,
  findSession,
  type Backend,
  type ChatMessage,
  type ChatRoom,
  type ChatRoomMembership,
  type Cursor,
  type KeyValueStore,
  type Page,
} from '@keystone/fedi'

import {appStorage} from '#/storage'

import {
  chatRoomMessagesQueryKey,
  chatRoomQueryKey,
  chatRoomsQueryKey,
  chatUserMessagesQueryKey,
  type AppQueryKey,
} from './keys'
import {GC_TIME, STALE} from './stale'
import {SIGNED_OUT_SCOPE} from './usePostFeedQuery'

export const CHAT_PAGE_LIMIT = 20

export interface ChatQueryOptions {
  /** Session seam (tests inject a memory store; defaults to the app MMKV). */
  store?: KeyValueStore
  /** Backend override (screens pass the active backend; defaults to the session's). */
  backend?: Backend | null
  /** Page size. */
  limit?: number
  /** Retry count (tests pass 0 to fail fast). Defaults to 2. */
  retry?: number | false
}

/** Backend for a stored session id, or null when unknown (never a guest backend). */
function resolveSessionBackend(store: KeyValueStore, sessionId: string): Backend | null {
  const session = findSession(store, sessionId)
  return session ? backendForSession(session) : null
}

function chatBackend(options: ChatQueryOptions, sessionId: string | null): Backend | null {
  if (options.backend !== undefined) return options.backend
  if (sessionId == null) return null
  return resolveSessionBackend(options.store ?? appStorage(), sessionId)
}

function requireChat(backend: Backend | null): NonNullable<Backend['chat']> {
  if (!backend) throw new Error('Sign in to read your chats.')
  if (!backend.chat) {
    throw new Error('Chat is not available on this server.')
  }
  return backend.chat
}

/** Flatten infinite thread pages into one list, deduping by id (newest first wins). */
export function chatMessageItems(
  data: InfiniteData<Page<ChatMessage>> | undefined,
): ChatMessage[] {
  if (!data) return []
  const seen = new Set<string>()
  const out: ChatMessage[] = []
  for (const item of data.pages.flatMap(page => page.items)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** Flatten infinite room pages, deduping by membership id. */
export function chatRoomItems(
  data: InfiniteData<Page<ChatRoomMembership>> | undefined,
): ChatRoomMembership[] {
  if (!data) return []
  const seen = new Set<string>()
  const out: ChatRoomMembership[] = []
  for (const item of data.pages.flatMap(page => page.items)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

export function useChatRoomsQuery(sessionId: string | null, options: ChatQueryOptions = {}) {
  const limit = options.limit ?? CHAT_PAGE_LIMIT
  const backend = chatBackend(options, sessionId)
  const queryKey = chatRoomsQueryKey(sessionId ?? SIGNED_OUT_SCOPE)
  const query = useInfiniteQuery<Page<ChatRoomMembership>, Error, InfiniteData<Page<ChatRoomMembership>>, AppQueryKey, Cursor | null>({
    queryKey,
    queryFn: ({pageParam}) => {
      return requireChat(backend).rooms({cursor: pageParam, limit})
    },
    initialPageParam: null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    enabled: backend != null,
    retry: options.retry ?? 2,
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

export function useChatRoomQuery(
  sessionId: string | null,
  roomId: string | null,
  options: ChatQueryOptions = {},
) {
  const backend = chatBackend(options, sessionId)
  const queryKey = chatRoomQueryKey(sessionId ?? SIGNED_OUT_SCOPE, roomId ?? '')
  const query = useQuery<ChatRoom, Error, ChatRoom, AppQueryKey>({
    queryKey,
    queryFn: () => {
      if (!roomId) throw new Error('No room selected.')
      return requireChat(backend).showRoom(roomId)
    },
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    enabled: backend != null && roomId != null,
    retry: options.retry ?? 2,
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

function useChatMessages(
  sessionId: string | null,
  key: AppQueryKey,
  fetchPage: (chat: NonNullable<Backend['chat']>, cursor: Cursor | null, limit: number) => Promise<Page<ChatMessage>>,
  enabled: boolean,
  options: ChatQueryOptions,
) {
  const limit = options.limit ?? CHAT_PAGE_LIMIT
  const backend = chatBackend(options, sessionId)
  const query = useInfiniteQuery<Page<ChatMessage>, Error, InfiniteData<Page<ChatMessage>>, AppQueryKey, Cursor | null>({
    queryKey: key,
    queryFn: ({pageParam}) => {
      return fetchPage(requireChat(backend), pageParam, limit)
    },
    initialPageParam: null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    enabled: backend != null && enabled,
    retry: options.retry ?? 2,
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey: key}
}

export function useChatRoomMessagesQuery(
  sessionId: string | null,
  roomId: string | null,
  options: ChatQueryOptions = {},
) {
  return useChatMessages(
    sessionId,
    chatRoomMessagesQueryKey(sessionId ?? SIGNED_OUT_SCOPE, roomId ?? ''),
    (chat, cursor, limit) => chat.roomMessages(roomId!, {cursor, limit}),
    roomId != null,
    options,
  )
}

export function useChatUserMessagesQuery(
  sessionId: string | null,
  userId: string | null,
  options: ChatQueryOptions = {},
) {
  return useChatMessages(
    sessionId,
    chatUserMessagesQueryKey(sessionId ?? SIGNED_OUT_SCOPE, userId ?? ''),
    (chat, cursor, limit) => chat.userMessages(userId!, {cursor, limit}),
    userId != null,
    options,
  )
}

export type SendChatTarget = {roomId: string} | {userId: string}

export function useSendChatMessage(sessionId: string | null, options: ChatQueryOptions = {}) {
  const queryClient = useQueryClient()
  const backend = chatBackend(options, sessionId)
  return useMutation<ChatMessage, Error, SendChatTarget & {text: string}>({
    mutationFn: async vars => {
      const chat = requireChat(backend)
      if ('roomId' in vars) {
        return chat.sendToRoom(vars.roomId, vars.text)
      }
      return chat.sendToUser(vars.userId, vars.text)
    },
    onSuccess: (_message, target) => {
      if (!sessionId) return
      if ('roomId' in target) {
        void queryClient.invalidateQueries({
          queryKey: chatRoomMessagesQueryKey(sessionId, target.roomId),
        })
      } else {
        void queryClient.invalidateQueries({
          queryKey: chatUserMessagesQueryKey(sessionId, target.userId),
        })
      }
    },
  })
}

export function useDeleteChatMessage(sessionId: string | null, options: ChatQueryOptions = {}) {
  const queryClient = useQueryClient()
  const backend = chatBackend(options, sessionId)
  return useMutation<void, Error, SendChatTarget & {messageId: string}>({
    mutationFn: async ({messageId}) => {
      await requireChat(backend).deleteMessage(messageId)
    },
    onSuccess: (_ignored, target) => {
      if (!sessionId) return
      if ('roomId' in target) {
        void queryClient.invalidateQueries({
          queryKey: chatRoomMessagesQueryKey(sessionId, target.roomId),
        })
      } else {
        void queryClient.invalidateQueries({
          queryKey: chatUserMessagesQueryKey(sessionId, target.userId),
        })
      }
    },
  })
}

export function useReadAllChat(sessionId: string | null, options: ChatQueryOptions = {}) {
  const queryClient = useQueryClient()
  const backend = chatBackend(options, sessionId)
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await requireChat(backend).readAll()
    },
    onSuccess: () => {
      if (!sessionId) return
      void queryClient.invalidateQueries({queryKey: chatRoomsQueryKey(sessionId)})
    },
  })
}

/** Merge one live message into a thread's cached pages (id-deduped
 * prepend into the first page). Pure — exported for tests. */
export function mergeChatMessage(
  data: InfiniteData<Page<ChatMessage>> | undefined,
  message: ChatMessage,
): InfiniteData<Page<ChatMessage>> | undefined {
  if (!data) return data
  if (data.pages.some(page => page.items.some(item => item.id === message.id))) {
    return data
  }
  const [first, ...rest] = data.pages
  if (!first) return data
  return {pages: [{...first, items: [message, ...first.items]}], pageParams: data.pageParams}
}

/** Drop one live-deleted message from a thread's cached pages. Pure. */
export function dropChatMessage(
  data: InfiniteData<Page<ChatMessage>> | undefined,
  id: string,
): InfiniteData<Page<ChatMessage>> | undefined {
  if (!data) return data
  return {
    pages: data.pages.map(page => ({...page, items: page.items.filter(item => item.id !== id)})),
    pageParams: data.pageParams,
  }
}

/** Live subscription for one room thread. Subscribes the session's
 * `chatRoom` channel while mounted and merges events into the thread
 * cache; a backend without the subscription (Mastodon family, old
 * servers) simply never subscribes — paging still works. */
export function useChatRoomLive(
  sessionId: string | null,
  roomId: string | null,
  options: ChatQueryOptions = {},
) {
  const queryClient = useQueryClient()
  const backend = chatBackend(options, sessionId)
  useEffect(() => {
    if (!backend || !sessionId || !roomId) return
    const stream = backend.stream?.()
    const subscribe = stream?.subscribeChatRoom
    if (!stream || !subscribe) return
    const key = chatRoomMessagesQueryKey(sessionId, roomId)
    const dispose = subscribe.call(stream, roomId, {
      onMessage: message => {
        queryClient.setQueryData<InfiniteData<Page<ChatMessage>>>(key, data =>
          mergeChatMessage(data, message),
        )
      },
      onDeleted: id => {
        queryClient.setQueryData<InfiniteData<Page<ChatMessage>>>(key, data =>
          dropChatMessage(data, id),
        )
      },
    })
    return () => {
      dispose()
    }
  }, [backend, sessionId, roomId, queryClient])
}

/** Live subscription for one 1-on-1 thread (`chatUser` channel). Same
 * merge rules and same absence behavior as `useChatRoomLive`. */
export function useChatUserLive(
  sessionId: string | null,
  userId: string | null,
  options: ChatQueryOptions = {},
) {
  const queryClient = useQueryClient()
  const backend = chatBackend(options, sessionId)
  useEffect(() => {
    if (!backend || !sessionId || !userId) return
    const stream = backend.stream?.()
    const subscribe = stream?.subscribeChatUser
    if (!stream || !subscribe) return
    const key = chatUserMessagesQueryKey(sessionId, userId)
    const dispose = subscribe.call(stream, userId, {
      onMessage: message => {
        queryClient.setQueryData<InfiniteData<Page<ChatMessage>>>(key, data =>
          mergeChatMessage(data, message),
        )
      },
      onDeleted: id => {
        queryClient.setQueryData<InfiniteData<Page<ChatMessage>>>(key, data =>
          dropChatMessage(data, id),
        )
      },
    })
    return () => {
      dispose()
    }
  }, [backend, sessionId, userId, queryClient])
}
