// Post-detail thread queries: the focused post plus its ancestor chain and
// the branch replies below it. Thread ownership stays in `@keystone/fedi`
// (`backend.post` / `backend.thread` / `backend.threadReplies`); these hooks
// only scope the calls to one session's backend and key the cache by
// sessionId first, so account B can never read account A's thread.

import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import {
  appearNoteOf,
  type Backend,
  type Cursor,
  type Page,
  type Post,
  type PostRevision,
} from '@keystone/fedi'

import {createQueryKey, type AppQueryKey} from './keys'
import {GC_TIME, STALE} from './stale'
import {retryPolicy, throwIfAborted} from './retry'

/** Key for one session's loaded thread (post + ancestors). */
export function threadQueryKey(sessionId: string, postId: string): AppQueryKey {
  return createQueryKey(sessionId, 'post-thread', postId)
}

/** Key for one session's direct-reply pages under a parent post. */
export function threadRepliesQueryKey(
  sessionId: string,
  parentId: string,
): AppQueryKey {
  return createQueryKey(sessionId, 'thread-replies', parentId)
}

export interface PostThread {
  /** The post as opened (may be a pure-renote wrapper). */
  post: Post
  /** The displayed subject: `appearNoteOf(post)`. All reply queries target this. */
  focused: Post
  /** Ancestors oldest-first. */
  ancestors: Post[]
  /** True when the chain above is known to be cut off. */
  incomplete: boolean
}

/**
 * Load a post plus its ancestor chain through the owning session's backend.
 * Separated from React for tests.
 */
export async function fetchPostThread(
  backend: Backend,
  postId: string,
  signal?: AbortSignal,
): Promise<PostThread> {
  const post = await backend.post(postId, {signal})
  // A pure-renote wrapper is not the thread subject: ancestors target the
  // original (appearNoteOf semantics, same as the v1 detail route).
  const focused = appearNoteOf(post)
  const thread = await backend.thread(focused, {signal})
  return {post, focused, ancestors: thread.ancestors, incomplete: thread.incomplete}
}

export interface PostThreadQueryOptions {
  backend?: Backend | null
  retry?: number | false
}

/**
 * Thread query for one session + post. Disabled (no fetch, no data) when
 * signed out, the post id is empty, or the backend is unknown.
 */
export function usePostThreadQuery(
  sessionId: string | null,
  postId: string,
  options: PostThreadQueryOptions = {},
): UseQueryResult<PostThread, Error> & {queryKey: AppQueryKey} {
  const backend = options.backend ?? null
  const queryKey = threadQueryKey(sessionId ?? 'signed-out', postId)
  const query = useQuery<PostThread, Error, PostThread, AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      if (!backend) throw new Error('usePostThreadQuery: no backend for session')
      return fetchPostThread(backend, postId, signal)
    },
    enabled: sessionId != null && postId.length > 0 && backend != null,
    staleTime: STALE.POST,
    gcTime: GC_TIME.POST,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

/**
 * Direct-reply pages under one parent post for one session. Newest behavior
 * matches the feed query: cursor paging, session-scoped key, never enabled
 * without a backend.
 */
export function useThreadRepliesQuery(
  sessionId: string | null,
  parentId: string,
  options: PostThreadQueryOptions = {},
): UseInfiniteQueryResult<InfiniteData<Page<Post>>, Error> & {
  queryKey: AppQueryKey
} {
  const backend = options.backend ?? null
  const queryKey = threadRepliesQueryKey(sessionId ?? 'signed-out', parentId)
  const query = useInfiniteQuery<
    Page<Post>,
    Error,
    InfiniteData<Page<Post>>,
    AppQueryKey,
    Cursor | null
  >({
    queryKey,
    queryFn: ({pageParam, signal}) => {
      if (!backend) throw new Error('useThreadRepliesQuery: no backend for session')
      return backend.threadReplies(parentId, {cursor: pageParam, ...(signal ? {signal} : {})})
    },
    initialPageParam: null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    enabled: sessionId != null && parentId.length > 0 && backend != null,
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

/** Key for one session's repost-account pages for a post. */
export function repostsQueryKey(sessionId: string, postId: string): AppQueryKey {
  return createQueryKey(sessionId, 'post-reposts', postId)
}

/** Key for one session's reaction rows for a post. */
export function noteReactionsQueryKey(sessionId: string, postId: string): AppQueryKey {
  return createQueryKey(sessionId, 'post-reactions', postId)
}

function useInfinitePages<PageT>(opts: {
  sessionId: string | null
  id: string
  backend: Backend | null
  queryKey: AppQueryKey
  fetch: (backend: Backend, cursor: Cursor | null, signal?: AbortSignal) => Promise<{end: boolean; cursor: Cursor | null} & PageT>
  stale: number
  gc: number
  retry?: number | false
}) {
  const {sessionId, id, backend, queryKey, fetch, stale, gc, retry} = opts
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({pageParam, signal}: {pageParam: Cursor | null; signal: AbortSignal}) => {
      if (!backend) throw new Error('usePostThreadListQuery: no backend for session')
      return fetch(backend, pageParam, signal)
    },
    initialPageParam: null as Cursor | null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    enabled: sessionId != null && id.length > 0 && backend != null,
    staleTime: stale,
    gcTime: gc,
    retry: retryPolicy(retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

/**
 * Accounts that reposted a note, cursor-paged, one session. Disabled
 * (no fetch, no data) when signed out or the backend is unknown.
 */
export function useRepostsQuery(
  sessionId: string | null,
  postId: string,
  options: PostThreadQueryOptions = {},
) {
  const backend = options.backend ?? null
  const queryKey = repostsQueryKey(sessionId ?? 'signed-out', postId)
  return useInfinitePages({
    sessionId,
    id: postId,
    backend,
    queryKey,
    fetch: (b, cursor, signal) => b.reposts(postId, {cursor, ...(signal ? {signal} : {})}),
    stale: STALE.FEED,
    gc: GC_TIME.FEED,
    retry: options.retry,
  })
}

/**
 * Reaction rows for a note, cursor-paged, one session. Backends without
 * a reactor listing (Mastodon-family) reject; the tab renders the honest
 * unavailable state instead of a faked list.
 */
export function useNoteReactionsQuery(
  sessionId: string | null,
  postId: string,
  options: PostThreadQueryOptions = {},
) {
  const backend = options.backend ?? null
  const queryKey = noteReactionsQueryKey(sessionId ?? 'signed-out', postId)
  return useInfinitePages({
    sessionId,
    id: postId,
    backend,
    queryKey,
    fetch: (b, cursor, signal) => b.noteReactions(postId, {cursor, ...(signal ? {signal} : {})}),
    stale: STALE.FEED,
    gc: GC_TIME.FEED,
    retry: options.retry,
  })
}

// --- Edit history (clickstone §1.7) ------------------------------------------

/** Key for one session's edit-history read of a post. */
export function editHistoryQueryKey(sessionId: string, postId: string): AppQueryKey {
  return createQueryKey(sessionId, 'post-history', postId)
}

/**
 * One post's revisions, newest-first, through the owning session's backend.
 * Disabled when the backend has no `editHistory` (the Misskey family): the
 * screen renders an honest "no history on this server" state instead of a
 * fake single revision.
 */
export function useEditHistoryQuery(
  sessionId: string | null,
  postId: string,
  options: PostThreadQueryOptions = {},
): UseQueryResult<PostRevision[], Error> & {queryKey: AppQueryKey} {
  const backend = options.backend ?? null
  const queryKey = editHistoryQueryKey(sessionId ?? 'signed-out', postId)
  const query = useQuery<PostRevision[], Error, PostRevision[], AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      throwIfAborted(signal)
      if (!backend?.editHistory) throw new Error('useEditHistoryQuery: no history endpoint')
      return backend.editHistory(postId)
    },
    enabled:
      sessionId != null && postId.length > 0 && typeof backend?.editHistory === 'function',
    staleTime: STALE.POST,
    gcTime: GC_TIME.POST,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}
