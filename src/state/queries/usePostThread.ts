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
} from '@keystone/fedi'

import {createQueryKey, type AppQueryKey} from './keys'
import {GC_TIME, STALE} from './stale'

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
): Promise<PostThread> {
  const post = await backend.post(postId)
  // A pure-renote wrapper is not the thread subject: ancestors target the
  // original (appearNoteOf semantics, same as the v1 detail route).
  const focused = appearNoteOf(post)
  const thread = await backend.thread(focused)
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
    queryFn: () => {
      if (!backend) throw new Error('usePostThreadQuery: no backend for session')
      return fetchPostThread(backend, postId)
    },
    enabled: sessionId != null && postId.length > 0 && backend != null,
    staleTime: STALE.POST,
    gcTime: GC_TIME.POST,
    retry: options.retry ?? 2,
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
    queryFn: ({pageParam}) => {
      if (!backend) throw new Error('useThreadRepliesQuery: no backend for session')
      return backend.threadReplies(parentId, {cursor: pageParam})
    },
    initialPageParam: null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    enabled: sessionId != null && parentId.length > 0 && backend != null,
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    retry: options.retry ?? 2,
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

function infinitePages<PageT>(
  sessionId: string | null,
  id: string,
  backend: Backend | null,
  queryKey: AppQueryKey,
  fetch: (backend: Backend, cursor: Cursor | null) => Promise<{end: boolean; cursor: Cursor | null} & PageT>,
  stale: number,
  gc: number,
  retry?: number | false,
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({pageParam}: {pageParam: Cursor | null}) => {
      if (!backend) throw new Error('usePostThreadListQuery: no backend for session')
      return fetch(backend, pageParam)
    },
    initialPageParam: null as Cursor | null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    enabled: sessionId != null && id.length > 0 && backend != null,
    staleTime: stale,
    gcTime: gc,
    retry: retry ?? 2,
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
  return infinitePages(
    sessionId,
    postId,
    backend,
    queryKey,
    (b, cursor) => b.reposts(postId, {cursor}),
    STALE.FEED,
    GC_TIME.FEED,
    options.retry,
  )
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
  return infinitePages(
    sessionId,
    postId,
    backend,
    queryKey,
    (b, cursor) => b.noteReactions(postId, {cursor}),
    STALE.FEED,
    GC_TIME.FEED,
    options.retry,
  )
}
