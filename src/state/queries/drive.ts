// Drive queries (P6.6 slice 5): folders (paged by parent), folder
// detail (breadcrumbs), files (infinite), usage, mutations. Every key
// carries the sessionId first. Sort is sent only when the probe verdict
// for the origin is not `false` (the fedi layer enforces this; the UI
// additionally hides the sort menu when unsupported).

import {useMemo, useSyncExternalStore} from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  backendForSession,
  type Backend,
  type Cursor,
  type DriveFolder,
  type DriveFolderDetail,
  type DriveSort,
  type Media,
  type Page,
} from '@keystone/fedi';

import {appStorage} from '#/storage';
import {useSessionStore} from '#/state/session/SessionProvider';

import {
  driveFilesQueryKey,
  driveFolderQueryKey,
  driveFoldersQueryKey,
  driveUsageQueryKey,
  type AppQueryKey,
} from './keys';
import {GC_TIME, STALE} from './stale';
import {guardRepeatedCursor, retryPolicy, throwIfAborted} from './retry';

function useSessionBackend(sessionId: string | null): Backend | null {
  const store = useSessionStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(() => {
    if (!sessionId) return null;
    const session = snapshot.sessions.find(s => s.id === sessionId) ?? null;
    return session ? backendForSession(session) : null;
  }, [snapshot, sessionId]);
}

export interface DriveQueryOptions {
  backend?: Backend | null;
  limit?: number;
  retry?: number | false;
}

/** Folders in one parent (null = root), paged. */
export function useDriveFolders(
  sessionId: string | null,
  parentId: string | null,
  options: DriveQueryOptions = {},
): UseInfiniteQueryResult<InfiniteData<Page<DriveFolder>>, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId);
  const backend = options.backend !== undefined ? options.backend : storeBackend;
  const limit = options.limit ?? 20;
  const queryKey = driveFoldersQueryKey(sessionId ?? 'signed-out', parentId ?? 'root');
  const query = useInfiniteQuery<
    Page<DriveFolder>,
    Error,
    InfiniteData<Page<DriveFolder>>,
    AppQueryKey,
    Cursor | null
  >({
    queryKey,
    queryFn: ({pageParam, signal}) => {
      if (!backend?.drive?.folders) throw new Error('useDriveFolders: no drive folders backend for session');
      throwIfAborted(signal);
      return backend.drive.folders.list({parentId, cursor: pageParam ?? undefined, limit});
    },
    initialPageParam: null,
    getNextPageParam: guardRepeatedCursor,
    enabled: sessionId != null && backend?.drive?.folders != null,
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  });
  return {...query, queryKey};
}

/** One folder with its breadcrumb path. */
export function useDriveFolder(
  sessionId: string | null,
  folderId: string | null,
  options: DriveQueryOptions = {},
): UseQueryResult<DriveFolderDetail | null, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId);
  const backend = options.backend !== undefined ? options.backend : storeBackend;
  const queryKey = driveFolderQueryKey(sessionId ?? 'signed-out', folderId ?? 'root');
  const query = useQuery<DriveFolderDetail | null, Error, DriveFolderDetail | null, AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      if (!backend?.drive?.folders) throw new Error('useDriveFolder: no drive folders backend for session');
      throwIfAborted(signal);
      if (folderId == null) return Promise.resolve(null);
      return backend.drive.folders.show(folderId);
    },
    enabled: sessionId != null && backend?.drive?.folders != null,
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  });
  return {...query, queryKey};
}

/** Files in one folder (null = root), infinite. */
export function useDriveFiles(
  sessionId: string | null,
  folderId: string | null,
  options: DriveQueryOptions & {sort?: DriveSort} = {},
): UseInfiniteQueryResult<InfiniteData<Page<Media>>, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId);
  const backend = options.backend !== undefined ? options.backend : storeBackend;
  const limit = options.limit ?? 20;
  const sort = options.sort;
  // Never ask for what the server lacks (the fedi layer gates again as
  // defense for direct callers; the sort menu hides on the same verdict).
  const sendSort = sort !== undefined && backend?.drive?.isSortSupported?.() !== false ? sort : undefined;
  const queryKey = driveFilesQueryKey(sessionId ?? 'signed-out', folderId ?? 'root', sendSort ?? 'newest');
  const query = useInfiniteQuery<
    Page<Media>,
    Error,
    InfiniteData<Page<Media>>,
    AppQueryKey,
    Cursor | null
  >({
    queryKey,
    queryFn: ({pageParam, signal}) => {
      if (!backend?.drive) throw new Error('useDriveFiles: no drive backend for session');
      throwIfAborted(signal);
      return backend.drive.files({
        folderId: folderId ?? undefined,
        cursor: pageParam ?? undefined,
        limit,
        ...(sendSort !== undefined ? {sort: sendSort} : {}),
      });
    },
    initialPageParam: null,
    getNextPageParam: guardRepeatedCursor,
    enabled: sessionId != null && backend?.drive != null,
    staleTime: STALE.FEED,
    gcTime: GC_TIME.FEED,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  });
  return {...query, queryKey};
}

/** Storage usage (`{capacity, usage}`). */
export function useDriveUsage(
  sessionId: string | null,
  options: DriveQueryOptions = {},
): UseQueryResult<{capacity: number; usage: number}, Error> & {queryKey: AppQueryKey} {
  const storeBackend = useSessionBackend(sessionId);
  const backend = options.backend !== undefined ? options.backend : storeBackend;
  const queryKey = driveUsageQueryKey(sessionId ?? 'signed-out');
  const query = useQuery<{capacity: number; usage: number}, Error, {capacity: number; usage: number}, AppQueryKey>({
    queryKey,
    queryFn: ({signal}) => {
      if (!backend?.drive) throw new Error('useDriveUsage: no drive backend for session');
      throwIfAborted(signal);
      return backend.drive.usage();
    },
    enabled: sessionId != null && backend?.drive != null,
    staleTime: STALE.ACCOUNT,
    gcTime: GC_TIME.ACCOUNT,
    retry: retryPolicy(options.retry),
    refetchOnWindowFocus: false,
  });
  return {...query, queryKey};
}

/** Invalidation helpers (mutations live in the screens/panels). */
export function useInvalidateDrive(): {
  folder: (sessionId: string, folderId: string | null) => void;
  usage: (sessionId: string) => void;
} {
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      folder: (sessionId: string, folderId: string | null) => {
        // Prefix match: every sort ordering of the folder's files.
        void queryClient.invalidateQueries({queryKey: driveFoldersQueryKey(sessionId, folderId ?? 'root')});
        void queryClient.invalidateQueries({queryKey: [sessionId, 'drive-files', folderId ?? 'root']});
        void queryClient.invalidateQueries({queryKey: driveUsageQueryKey(sessionId)});
      },
      usage: (sessionId: string) => {
        void queryClient.invalidateQueries({queryKey: driveUsageQueryKey(sessionId)});
      },
    }),
    [queryClient],
  );
}

/** Folder mutations (create/rename/move/delete) with list invalidation. */
export function useDriveFolderMutations(
  sessionId: string | null,
  options: DriveQueryOptions = {},
): {
  create: UseMutationResult<DriveFolder, Error, {name: string; parentId: string | null}, unknown>;
  rename: UseMutationResult<DriveFolder, Error, {id: string; name: string}, unknown>;
  move: UseMutationResult<DriveFolder, Error, {id: string; parentId: string | null}, unknown>;
  remove: UseMutationResult<void, Error, {id: string; parentId: string | null}, unknown>;
} {
  const storeBackend = useSessionBackend(sessionId);
  const backend = options.backend !== undefined ? options.backend : storeBackend;
  const queryClient = useQueryClient();
  const invalidateParent = (parentId: string | null) => {
    if (sessionId) {
      void queryClient.invalidateQueries({queryKey: driveFoldersQueryKey(sessionId, parentId ?? 'root')});
      void queryClient.invalidateQueries({queryKey: driveFilesQueryKey(sessionId, parentId ?? 'root', 'newest')});
    }
  };
  const need = () => {
    if (!backend?.drive?.folders) throw new Error('useDriveFolderMutations: no drive folders backend for session');
    return backend.drive.folders;
  };
  const create = useMutation({
    mutationFn: (input: {name: string; parentId: string | null}) =>
      need().create(input.name, input.parentId != null ? {parentId: input.parentId} : {}),
    onSuccess: (_data, input) => invalidateParent(input.parentId),
  });
  const rename = useMutation({
    mutationFn: (input: {id: string; name: string}) => need().update(input.id, {name: input.name}),
    onSuccess: data => invalidateParent(data.parentId),
  });
  const move = useMutation({
    mutationFn: (input: {id: string; parentId: string | null}) =>
      need().update(input.id, {parentId: input.parentId}),
    onSuccess: (_data, input) => invalidateParent(input.parentId),
  });
  const remove = useMutation({
    mutationFn: async (input: {id: string; parentId: string | null}) => {
      await need().delete(input.id);
    },
    onSuccess: (_data, input) => invalidateParent(input.parentId),
  });
  return {create, rename, move, remove};
}

/** File mutations (rename/sensitive/comment/move/delete) with invalidation. */
export function useDriveFileMutations(
  sessionId: string | null,
  options: DriveQueryOptions = {},
): {
  patch: UseMutationResult<Media, Error, {id: string; folderId: string | null; patch: {name?: string; isSensitive?: boolean; comment?: string | null; folderId?: string | null}}, unknown>;
  remove: UseMutationResult<void, Error, {id: string; folderId: string | null}, unknown>;
} {
  const storeBackend = useSessionBackend(sessionId);
  const backend = options.backend !== undefined ? options.backend : storeBackend;
  const queryClient = useQueryClient();
  const invalidateFolder = (folderId: string | null) => {
    if (sessionId) {
      // Prefix match: invalidates every sort ordering of the folder.
      void queryClient.invalidateQueries({queryKey: [sessionId, 'drive-files', folderId ?? 'root']});
      void queryClient.invalidateQueries({queryKey: driveUsageQueryKey(sessionId)});
    }
  };
  const patch = useMutation({
    mutationFn: (input: {id: string; folderId: string | null; patch: {name?: string; isSensitive?: boolean; comment?: string | null; folderId?: string | null}}) => {
      if (!backend?.drive) throw new Error('useDriveFileMutations: no drive backend for session');
      return backend.drive.updateFile(input.id, input.patch).then(updated => {
        if (input.patch.folderId !== undefined && input.patch.folderId !== input.folderId) {
          invalidateFolder(input.folderId);
          invalidateFolder(input.patch.folderId);
        } else {
          invalidateFolder(input.folderId);
        }
        return updated;
      });
    },
  });
  const remove = useMutation({
    mutationFn: async (input: {id: string; folderId: string | null}) => {
      if (!backend?.drive) throw new Error('useDriveFileMutations: no drive backend for session');
      await backend.drive.deleteFile(input.id);
      invalidateFolder(input.folderId);
    },
  });
  return {patch, remove};
}
