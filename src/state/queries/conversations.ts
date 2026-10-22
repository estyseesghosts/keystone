// Conversations queries (P6.2, clickstone §2.1): react-query state for
// the DM inbox list + one thread, keyed by `conversationsQueryKey` /
// `conversationQueryKey` (sessionId FIRST — switching accounts switches
// keys, never data).
//
// - `useConversationsQuery` pages `Backend.conversations.list`.
// - `useConversationQuery` reads `Backend.conversations.get` (the
//   terminating inbox scan — neither server has a show route).
// - `useDeleteConversation` / `useMarkConversationRead` run the backend
//   mutation and invalidate this session's inbox queries on success, so
//   rows disappear from the SERVER's answer — the cache is never locally
//   pruned into a lie (mark-read invalidates the inbox; the thread row
//   refetches its own flag).

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
  type Conversation,
  type Cursor,
  type KeyValueStore,
  type Page,
} from '@keystone/fedi'

import {appStorage} from '#/storage'

import {conversationQueryKey, conversationsQueryKey, type AppQueryKey} from './keys'
import {GC_TIME, STALE} from './stale'
import {SIGNED_OUT_SCOPE} from './usePostFeedQuery'

export const CONVERSATIONS_PAGE_LIMIT = 20

export interface ConversationsQueryOptions {
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

function conversationsBackend(
  options: ConversationsQueryOptions,
  sessionId: string | null,
): Backend | null {
  if (options.backend !== undefined) return options.backend
  if (sessionId == null) return null
  return resolveSessionBackend(options.store ?? appStorage(), sessionId)
}

function requireConversations(backend: Backend | null): NonNullable<Backend['conversations']> {
  if (!backend) throw new Error('Sign in to read your messages.')
  if (!backend.conversations) {
    throw new Error('Messages are not available on this server.')
  }
  return backend.conversations
}

/** Flatten infinite inbox pages into one list, deduping by id (newest first wins). */
export function conversationItems(
  data: InfiniteData<Page<Conversation>> | undefined,
): Conversation[] {
  if (!data) return []
  const seen = new Set<string>()
  const out: Conversation[] = []
  for (const item of data.pages.flatMap(page => page.items)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

export function useConversationsQuery(
  sessionId: string | null,
  options: ConversationsQueryOptions = {},
) {
  const limit = options.limit ?? CONVERSATIONS_PAGE_LIMIT
  const backend = conversationsBackend(options, sessionId)
  const queryKey = conversationsQueryKey(sessionId ?? SIGNED_OUT_SCOPE)
  const query = useInfiniteQuery<Page<Conversation>, Error, InfiniteData<Page<Conversation>>, AppQueryKey, Cursor | null>({
    queryKey,
    queryFn: ({pageParam}) => {
      return requireConversations(backend).list({cursor: pageParam, limit})
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

export function useConversationQuery(
  sessionId: string | null,
  conversationId: string | null,
  options: ConversationsQueryOptions = {},
) {
  const backend = conversationsBackend(options, sessionId)
  const queryKey = conversationQueryKey(sessionId ?? SIGNED_OUT_SCOPE, conversationId ?? '')
  const query = useQuery<Conversation, Error, Conversation, AppQueryKey>({
    queryKey,
    queryFn: () => {
      if (!conversationId) throw new Error('No conversation selected.')
      return requireConversations(backend).get(conversationId)
    },
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    enabled: backend != null && conversationId != null,
    retry: options.retry ?? 2,
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

export function useDeleteConversation(
  sessionId: string | null,
  options: ConversationsQueryOptions = {},
) {
  const queryClient = useQueryClient()
  const backend = conversationsBackend(options, sessionId)
  return useMutation<void, Error, string>({
    mutationFn: async (id: string) => {
      await requireConversations(backend).delete(id)
    },
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({queryKey: [sessionId, 'conversations']})
      }
    },
  })
}

export function useMarkConversationRead(
  sessionId: string | null,
  options: ConversationsQueryOptions = {},
) {
  const queryClient = useQueryClient()
  const backend = conversationsBackend(options, sessionId)
  return useMutation<Conversation, Error, string>({
    mutationFn: async (id: string) => {
      return requireConversations(backend).markRead(id)
    },
    onSuccess: (_updated, id) => {
      if (sessionId) {
        void queryClient.invalidateQueries({queryKey: [sessionId, 'conversations']})
        void queryClient.invalidateQueries({queryKey: [sessionId, 'conversation', id]})
      }
    },
  })
}
