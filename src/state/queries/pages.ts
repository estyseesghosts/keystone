// P6.5 Pages queries (slices 2–4): reads + like toggle queue + saves.
// Session-scoped like every other query module: keys carry the sessionId
// first, the backend resolves per session (injected in tests), and the
// `pages` module gates availability — Mastodon-family backends leave it
// undefined and the UI hides instead of erroring.

import {useMemo, useState, useSyncExternalStore} from 'react'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import {
  backendForSession,
  copyName,
  type Backend,
  type Cursor,
  type Media,
  type Page,
  type PageDraft,
  type PageModel,
  type PagePatch,
  type Post,
} from '@keystone/fedi'

import {appStorage} from '#/storage'
import {useSessionStore} from '#/state/session/SessionProvider'

import {pageQueryKey, pagesQueryKey, postQueryKey, type AppQueryKey} from './keys'
import {duplicatePageDraft} from '#/state/pageEditor'
import {useToggleMutationQueue} from '#/lib/hooks/useToggleMutationQueue'
import {GC_TIME, STALE} from './stale'
import {retryPolicy, throwIfAborted} from './retry'

/** Backend for an arbitrary session id (mirrors the recommendations
 * helper — queries never import from screens). */
function useSessionBackend(sessionId: string | null): Backend | null {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(() => {
    if (!sessionId) return null
    const session = snapshot.sessions.find(s => s.id === sessionId) ?? null
    return session ? backendForSession(session) : null
  }, [snapshot, sessionId])
}

export interface PagesQueryOptions {
  /** Backend override (tests inject fakes; defaults to the session's). */
  backend?: Backend | null
  /** Page size for paged listings. */
  limit?: number
  /** Retry count (tests pass 0 to fail fast). Defaults to 2. */
  retry?: number | false
}

/** One packed page (`pages/show` by id). Disabled without a session or
 * without the `pages` module — callers render signed-out/unsupported. */
export function usePageQuery(
  sessionId: string | null,
  pageId: string | null,
  options: PagesQueryOptions = {},
): UseQueryResult<PageModel, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  const queryKey = pageQueryKey(sessionId ?? 'signed-out', pageId ?? 'none')
  const query = useQuery<PageModel, Error, PageModel, AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      if (!backend?.pages) throw new Error('usePageQuery: no pages backend for session')
      // `PagesApi.show` takes no signal: pre-abort instead (X3.1 rule).
      throwIfAborted(signal)
      return backend.pages.show({id: pageId as string})
    },
    enabled: sessionId != null && pageId != null && backend?.pages != null,
    staleTime: STALE.POST,
    gcTime: GC_TIME.POST,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

function usePagedPages(
  sessionId: string | null,
  scope: string,
  fetch: (backend: NonNullable<Backend['pages']>, cursor: Cursor | null, limit: number) => Promise<Page<PageModel>>,
  options: PagesQueryOptions & {enabled?: boolean},
): UseInfiniteQueryResult<InfiniteData<Page<PageModel>>, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  const limit = options.limit ?? 20
  const queryKey = pagesQueryKey(sessionId ?? 'signed-out', scope)
  const query = useInfiniteQuery<
    Page<PageModel>,
    Error,
    InfiniteData<Page<PageModel>>,
    AppQueryKey,
    Cursor | null
  >({
    queryKey,
    queryFn: ({pageParam, signal}) => {
      if (!backend?.pages) throw new Error('usePagedPages: no pages backend for session')
      // `PagesApi` listings take no signal: pre-abort instead (X3.1 rule).
      throwIfAborted(signal)
      return fetch(backend.pages, pageParam, limit)
    },
    initialPageParam: null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    enabled: sessionId != null && backend?.pages != null && options.enabled !== false,
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

/** Featured pages (single fetch, ≤10). */
export function useFeaturedPages(
  sessionId: string | null,
  options: PagesQueryOptions = {},
): UseQueryResult<PageModel[], Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  const queryKey = pagesQueryKey(sessionId ?? 'signed-out', 'featured')
  const query = useQuery<PageModel[], Error, PageModel[], AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      if (!backend?.pages) throw new Error('useFeaturedPages: no pages backend for session')
      // `PagesApi.featured` takes no signal: pre-abort instead (X3.1 rule).
      throwIfAborted(signal)
      return backend.pages.featured()
    },
    enabled: backend?.pages != null,
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

/** `users/pages` for one author (public, paged). Works signed out. */
export function usePagesByUser(
  sessionId: string | null,
  userId: string | null,
  options: PagesQueryOptions = {},
) {
  return usePagedPages(
    sessionId,
    userId ? `by-user:${userId}` : 'by-user:none',
    (pages, cursor, pageLimit) =>
      pages.byUser(userId as string, {cursor: cursor ?? undefined, limit: pageLimit}),
    {...options, enabled: userId != null},
  )
}

/** Own pages (`i/pages`, paged). Disabled where `mine` is absent (Pinetree). */
export function useMyPages(sessionId: string | null, options: PagesQueryOptions = {}) {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  return usePagedPages(
    sessionId,
    'mine',
    (pages, cursor, pageLimit) => {
      if (!pages.mine) throw new Error('useMyPages: own page lists unsupported here')
      return pages.mine({cursor: cursor ?? undefined, limit: pageLimit})
    },
    {...options, backend, enabled: backend?.pages?.mine != null},
  )
}

/** Own liked pages (`i/page-likes`, paged). Disabled where `liked` is absent. */
export function useLikedPages(sessionId: string | null, options: PagesQueryOptions = {}) {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  return usePagedPages(
    sessionId,
    'liked',
    (pages, cursor, pageLimit) => {
      if (!pages.liked) throw new Error('useLikedPages: liked page lists unsupported here')
      return pages.liked({cursor: cursor ?? undefined, limit: pageLimit}).then(data => ({
        items: data.items.map(row => row.page),
        cursor: data.cursor,
        end: data.end,
      }))
    },
    {...options, backend, enabled: backend?.pages?.liked != null},
  )
}

/**
 * One embedded note by id (`notes/show` via `backend.post`). Missing id
 * disables the query — callers render the "unavailable" box.
 */
export function usePageNote(
  sessionId: string | null,
  noteId: string | null,
  options: PagesQueryOptions = {},
): UseQueryResult<Post, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  const queryKey = postQueryKey(sessionId ?? 'signed-out', noteId ?? 'none')
  const query = useQuery<Post, Error, Post, AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      if (!backend) throw new Error('usePageNote: no backend for session')
      return backend.post(noteId as string, {signal})
    },
    enabled: sessionId != null && noteId != null && backend != null,
    staleTime: STALE.POST,
    gcTime: GC_TIME.POST,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

export interface PageLikeQueue {
  /** Effective state (optimistic while busy). */
  liked: boolean
  /** Effective count (optimistic while busy). */
  count: number
  /** A toggle is in flight. */
  busy: boolean
  /** Toggle the viewer's like. Rejects on failure (callers toast). */
  toggle: () => Promise<void>
}

function patchLike(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  pageId: string,
  liked: boolean,
): void {
  const queryKey = pageQueryKey(sessionId, pageId)
  queryClient.setQueryData<PageModel>(queryKey, old => {
    if (!old) return old
    const delta = liked === old.isLiked ? 0 : liked ? 1 : -1
    return {...old, isLiked: liked, likedCount: Math.max(0, old.likedCount + delta)}
  })
}

/**
 * Page like toggle with optimistic flip + rollback (plan §2). Rapid taps
 * queue through the shared toggle queue; settle re-reads the page.
 */
export function usePageLikeQueue(
  sessionId: string | null,
  page: PageModel | null,
  options: PagesQueryOptions = {},
): PageLikeQueue {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  const queryClient = useQueryClient()
  const pageId = page?.id ?? null
  const confirmed = page?.isLiked ?? false
  const queue = useToggleMutationQueue<boolean>({
    initial: confirmed,
    equals: (a, b) => a === b,
    run: async (_from, to) => {
      if (sessionId == null || pageId == null) throw new Error('usePageLikeQueue: no page')
      if (!backend?.pages) throw new Error('usePageLikeQueue: no pages backend for session')
      if (to) await backend.pages.like(pageId)
      else await backend.pages.unlike(pageId)
    },
    onOptimistic: next => {
      if (sessionId && pageId) patchLike(queryClient, sessionId, pageId, next)
    },
    onRollback: current => {
      if (sessionId && pageId) patchLike(queryClient, sessionId, pageId, current)
    },
    onSettled: () => {
      if (sessionId && pageId) void queryClient.invalidateQueries({queryKey: pageQueryKey(sessionId, pageId)})
    },
  })
  const liked = queue.desired()
  const busy = queue.isBusy()
  const count = Math.max(0, (page?.likedCount ?? 0) + (liked === confirmed ? 0 : liked ? 1 : -1))
  return {
    liked,
    count,
    busy,
    toggle: () => queue.queueToggle(!liked),
  }
}

/** Drive file metadata by id (`drive/files/show`), keyed per session.
 * Used by the editor thumbnail and the preview eye-catch (slice 6). */
export function useDriveFile(
  sessionId: string | null,
  fileId: string | null,
  options: PagesQueryOptions = {},
): UseQueryResult<Media, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  const queryKey = pagesQueryKey(sessionId ?? 'signed-out', `driveFile:${fileId ?? 'none'}`)
  const query = useQuery<Media, Error, Media, AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      if (!backend?.drive) throw new Error('useDriveFile: no drive backend for session')
      throwIfAborted(signal)
      return backend.drive.showFile(fileId as string)
    },
    enabled: sessionId != null && fileId != null && backend?.drive != null,
    staleTime: STALE.POST,
    gcTime: GC_TIME.POST,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  })
  return {...query, queryKey}
}

/** True when the backend rejected with the page-name collision code. Pure. */
export function isNameTakenError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as {code?: unknown}).code === 'errors.pages.nameTaken'
  )
}

function invalidatePageLists(queryClient: ReturnType<typeof useQueryClient>, sessionId: string): void {
  void queryClient.invalidateQueries({queryKey: [sessionId, 'pages']})
  void queryClient.invalidateQueries({queryKey: [sessionId, 'page']})
}

export interface SavePageResult {
  page: PageModel
}

/**
 * Create a page (`pages/create`). On success the personal + featured
 * lists refetch. `NAME_ALREADY_EXISTS` surfaces to the caller for the
 * inline slug error (not a toast).
 */
export function useCreatePage(
  sessionId: string | null,
  options: PagesQueryOptions = {},
): {
  mutate: (draft: PageDraft) => Promise<SavePageResult>
  isPending: boolean
} {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  return {
    isPending: pending,
    mutate: async (draft: PageDraft) => {
      if (sessionId == null) throw new Error('useCreatePage: no session')
      if (!backend?.pages) throw new Error('useCreatePage: no pages backend for session')
      setPending(true)
      try {
        const page = await backend.pages.create(draft)
        invalidatePageLists(queryClient, sessionId)
        return {page}
      } finally {
        setPending(false)
      }
    },
  }
}

/**
 * Update a page (`pages/update`, patch-only per PG-4). No-op patches
 * never reach the server — the caller checks `pagePatch` first.
 */
export function useUpdatePage(
  sessionId: string | null,
  options: PagesQueryOptions = {},
): {
  mutate: (pageId: string, patch: PagePatch) => Promise<void>
  isPending: boolean
} {
  const storeBackend = useSessionBackend(sessionId)
  const backend = options.backend !== undefined ? options.backend : storeBackend
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  return {
    isPending: pending,
    mutate: async (pageId: string, patch: PagePatch) => {
      if (sessionId == null) throw new Error('useUpdatePage: no session')
      if (!backend?.pages) throw new Error('useUpdatePage: no pages backend for session')
      if (Object.keys(patch).length === 0) return
      setPending(true)
      try {
        await backend.pages.update(pageId, patch)
        await queryClient.invalidateQueries({queryKey: pageQueryKey(sessionId, pageId)})
        invalidatePageLists(queryClient, sessionId)
      } finally {
        setPending(false)
      }
    },
  }
}

/**
 * Duplicate a saved page: `create` with `"{title} (copy)"` and
 * `copyName(name, n)` (`-copy`, `-copy-2`, …), retrying the slug up to 5
 * times on `NAME_ALREADY_EXISTS`. Never mutates the source form.
 */
export async function duplicatePageOnBackend(
  backend: NonNullable<Backend['pages']>,
  saved: PageModel,
): Promise<PageModel> {
  let last: unknown = null
  for (let n = 1; n <= 5; n++) {
    try {
      return await backend.create(duplicatePageDraft(saved, copyName(saved.name, n)))
    } catch (err) {
      if (!isNameTakenError(err)) throw err
      last = err
    }
  }
  throw last
}
