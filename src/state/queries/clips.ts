// Clips queries (P6.6 slice 3): own-clips infinite list, per-clip
// mosaic (lazy, max 3 in flight — DC-5), show, mutations. Every key
// carries the sessionId first. Mosaic cache: 10 min, invalidated on
// add/remove (callers invalidate the clip's mosaic key).

import {useMemo, useSyncExternalStore} from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  backendForSession,
  collectMosaic,
  type Backend,
  type ClipSummary,
  type Cursor,
  type Page,
  type Post,
} from '@keystone/fedi';

import {appStorage} from '#/storage';
import {useSessionStore} from '#/state/session/SessionProvider';

import {clipMosaicQueryKey, clipsQueryKey, type AppQueryKey} from './keys';
import {GC_TIME, STALE} from './stale';
import {retryPolicy, throwIfAborted} from './retry';

function useSessionBackend(sessionId: string | null): Backend | null {
  const store = useSessionStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(() => {
    if (!sessionId) return null;
    const session = snapshot.sessions.find(s => s.id === sessionId) ?? null;
    return session ? backendForSession(session) : null;
  }, [snapshot, sessionId]);
}

export interface ClipsQueryOptions {
  backend?: Backend | null;
  limit?: number;
  retry?: number | false;
}

/** Own clips (`clips/list`, paged). Disabled without a session or module. */
export function useClips(
  sessionId: string | null,
  options: ClipsQueryOptions = {},
): UseInfiniteQueryResult<InfiniteData<Page<ClipSummary>>, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId);
  const backend = options.backend !== undefined ? options.backend : storeBackend;
  const limit = options.limit ?? 20;
  const queryKey = clipsQueryKey(sessionId ?? 'signed-out', 'mine');
  const query = useInfiniteQuery<
    Page<ClipSummary>,
    Error,
    InfiniteData<Page<ClipSummary>>,
    AppQueryKey,
    Cursor | null
  >({
    queryKey,
    queryFn: ({pageParam, signal}) => {
      if (!backend?.clips) throw new Error('useClips: no clips backend for session');
      throwIfAborted(signal);
      return backend.clips.list({cursor: pageParam ?? undefined, limit});
    },
    initialPageParam: null,
    getNextPageParam: last => (last.end ? undefined : (last.cursor ?? undefined)),
    enabled: sessionId != null && backend?.clips != null,
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  });
  return {...query, queryKey};
}

/** One clip (`clips/show`); null when the server has no such clip. */
export function useClip(
  sessionId: string | null,
  clipId: string | null,
  options: ClipsQueryOptions = {},
): UseQueryResult<ClipSummary | null, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId);
  const backend = options.backend !== undefined ? options.backend : storeBackend;
  const queryKey = clipsQueryKey(sessionId ?? 'signed-out', `clip:${clipId ?? 'none'}`);
  const query = useQuery<ClipSummary | null, Error, ClipSummary | null, AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      if (!backend?.clips) throw new Error('useClip: no clips backend for session');
      throwIfAborted(signal);
      return backend.clips.show(clipId as string);
    },
    enabled: sessionId != null && clipId != null && backend?.clips != null,
    staleTime: STALE.POST,
    gcTime: GC_TIME.POST,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  });
  return {...query, queryKey};
}

// --- Mosaic loading (DC-5): at most 3 `clips/notes` in flight ---------

let mosaicInFlight = 0;
const mosaicWaiters: Array<() => void> = [];

async function withMosaicSlot<T>(run: () => Promise<T>): Promise<T> {
  if (mosaicInFlight >= 3) {
    await new Promise<void>(resolve => {
      mosaicWaiters.push(resolve);
    });
  }
  mosaicInFlight++;
  try {
    return await run();
  } finally {
    mosaicInFlight--;
    mosaicWaiters.shift()?.();
  }
}

/** Test hook: reset the mosaic concurrency gate. */
export function resetMosaicGate(): void {
  mosaicInFlight = 0;
  mosaicWaiters.length = 0;
}

export interface ClipMosaic {
  images: Array<{url: string; sensitive?: boolean}>;
}

/**
 * Mosaic source for one clip: newest notes first (DC-4), cached 10 min.
 * Only mounts for rendered tiles (callers gate on visibility).
 */
export function useClipMosaic(
  sessionId: string | null,
  clipId: string | null,
  options: ClipsQueryOptions & {enabled?: boolean} = {},
): UseQueryResult<ClipMosaic, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId);
  const backend = options.backend !== undefined ? options.backend : storeBackend;
  const queryKey = clipMosaicQueryKey(sessionId ?? 'signed-out', clipId ?? 'none');
  const query = useQuery<ClipMosaic, Error, ClipMosaic, AppQueryKey>({
    queryKey,
    queryFn: async ({signal}) => {
      if (!backend?.clips) throw new Error('useClipMosaic: no clips backend for session');
      throwIfAborted(signal);
      const page = await withMosaicSlot(() => backend.clips!.notes(clipId as string, {limit: 10}));
      throwIfAborted(signal);
      return {images: collectMosaic(page.items)};
    },
    enabled: sessionId != null && clipId != null && backend?.clips != null && options.enabled !== false,
    staleTime: 10 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  });
  return {...query, queryKey};
}

/** Invalidate one clip's mosaic (call after add/remove note). */
export function useInvalidateClipMosaic(): (sessionId: string, clipId: string) => void {
  const queryClient = useQueryClient();
  return (sessionId: string, clipId: string) => {
    void queryClient.invalidateQueries({queryKey: clipMosaicQueryKey(sessionId, clipId)});
  };
}

/** Invalidate the own-clips list (call after create/update/delete/add). */
export function useInvalidateClips(): (sessionId: string) => void {
  const queryClient = useQueryClient();
  return (sessionId: string) => {
    void queryClient.invalidateQueries({queryKey: clipsQueryKey(sessionId, 'mine')});
  };
}

/** Invalidate one clip's detail (call after update). */
export function useInvalidateClip(): (sessionId: string, clipId: string) => void {
  const queryClient = useQueryClient();
  return (sessionId: string, clipId: string) => {
    void queryClient.invalidateQueries({queryKey: clipsQueryKey(sessionId, `clip:${clipId}`)});
  };
}
