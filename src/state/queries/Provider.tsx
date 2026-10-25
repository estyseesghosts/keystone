import {useEffect, useState, type ReactNode} from 'react'
import {createAsyncStoragePersister} from '@tanstack/query-async-storage-persister'
import {persistQueryClient} from '@tanstack/react-query-persist-client'
import {MutationCache, QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {msg} from '@lingui/macro'

import {ApiError, type KeyValueStore, type Session} from '@keystone/fedi'

import {appKeyValueStore} from '#/storage'
import {createQueryPurger, registerSessionPurger} from '#/state/session/purge'
import {useOptionalSessionStore} from '#/state/session/SessionProvider'
import {i18n} from '#/locale/i18n'
import {showToast} from '#/lib/toast'
import {navigationRef} from '#/navigationRef'

import {
  QUERY_PERSIST_KEY,
  persistRetry,
  removePersistedClient,
  restoreMergedClient,
  serializeSplitPersistedClient,
  shouldDehydrateQuery,
} from './persistPolicy'
import {GC_TIME, QUERY_BUSTER, QUERY_PERSIST_MAX_AGE, STALE} from './stale'
import {retryPolicy} from './retry'

export {QUERY_PERSIST_KEY}

// Query provider (slice 3.2 + repair X1.4): the app's `QueryClient` plus
// MMKV-backed query persistence. Only the `persistPolicy.ts` allowlist
// reaches the store (no DMs, no private posts, first page only),
// size-bounded and split one MMKV key per `sessionId` — restoring never
// serves account A's timeline to account B, and purging one account
// deletes exactly its key.
//
// Mounting: this component only. `SessionProvider` stays unmounted here
// (slice 3.1 owns it); Root composition is left to the orchestrator.

// (The manifest key lives in `persistPolicy.ts`; it is re-exported above
// so existing importers keep working.)

export function createAppQueryClient(runtime401?: Runtime401Store | null): QueryClient {
  // Runtime 401 handling (repair X1.5, sessions-cache 4): a dead token is
  // only caught at boot today, so every query stays failed-but-signed-in
  // until relaunch. These caches close the loop — a 401 from a query or a
  // session-scoped mutation verifies THAT session via `verifySession`,
  // and only a second 401 (from the verify's own `me()`) drops it through
  // the X1.2 purge path. 403/network/5xx never verify-drop: they are
  // filtered here, and `verifySession` never clears them either.
  //
  // `pending` stops a burst of cache errors from enqueueing duplicate
  // verifies and toasts: the first settles the toast, the rest ride
  // along. The 30 s server cool-down lives in `store.verifySession`
  // (shared by boot, switch-lazy, and cache paths), so a verify that
  // just ran is reused instead of re-hitting `me()`.
  const pending = new Map<string, Promise<void>>()
  const handleAuthFailure = (sessionId: string): void => {
    if (!runtime401 || pending.has(sessionId)) return
    // Known sessions only: an unknown head (or a `signed-out` key that
    // slipped past `sessionIdFromKey`) never reaches the network —
    // `verifySession` would report `unknown-session` anyway.
    const target = runtime401.list().find(s => s.id === sessionId) ?? null
    if (!target) return
    const label = target.user?.displayName ?? target.accountId
    const work = runtime401
      .verifySession(sessionId)
      .then(result => {
        if (!result.cleared) return
        showToast(i18n._(msg`Signed out of ${label}: session expired`))
        if (runtime401.list().length === 0 && navigationRef.isReady()) {
          navigationRef.navigate('Login')
        }
      })
      .catch(() => {
        // `verifySession`/`dropLocal` are best-effort by contract (the
        // purge never throws); a rejection here must not break the cache.
      })
      .finally(() => {
        if (pending.get(sessionId) === work) pending.delete(sessionId)
      })
    pending.set(sessionId, work)
  }
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        if (!isRuntime401(err)) return
        const id = sessionIdFromKey(query?.queryKey)
        if (!id) return
        handleAuthFailure(id)
      },
    }),
    mutationCache: new MutationCache({
      // Mutations carry no session key today (no new keys per X0.1), so
      // only a mutation that sets a sessionId-first `mutationKey` routes
      // here; key-less mutations are ignored (never mis-attributed to the
      // active session in a multi-account tree).
      onError: (err, _variables, _mutationContext, mutation) => {
        if (!isRuntime401(err)) return
        const id = sessionIdFromKey(mutation?.options?.mutationKey)
        if (!id) return
        handleAuthFailure(id)
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: STALE.FEED,
        gcTime: GC_TIME.FEED,
        retry: retryPolicy(),
        refetchOnWindowFocus: false,
      },
    },
  })
}

/** Minimal store surface the runtime-401 handler needs (the real session
 * store, or a stub in tests). The real `SessionStore` satisfies this
 * structurally (`verifySession` resolves a superset with `cleared`). */
export interface Runtime401Store {
  verifySession(id: string): Promise<{cleared: boolean}>
  list(): Session[]
}

/** True only for a dead-token signal: an `ApiError` with status 401.
 * 403 (scope), network failures (status 0/absent), and 5xx never count —
 * they must never drop a session. Pure. */
export function isRuntime401(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

/** Session id from a TanStack key when it is sessionId-first (X0.1 rule).
 * Null for missing/non-array keys and for non-string, empty, or
 * `signed-out` heads — those never route to `verifySession`. Pure. */
export function sessionIdFromKey(key: unknown): string | null {
  if (!Array.isArray(key) || key.length === 0) return null
  const first = key[0]
  if (typeof first !== 'string' || first.length === 0 || first === 'signed-out') return null
  return first
}

/**
 * MMKV-backed query persister (repair X1.4). The `KeyValueStore` seam is
 * sync (MMKV is synchronous); the persister wants async, so this adapts
 * without changing the seam. Injectable for tests.
 *
 * The split serialiser writes one MMKV value per session plus a manifest
 * under `QUERY_PERSIST_KEY`; restores merge them back. A rejected save
 * retries smaller (largest queries dropped first) via `persistRetry`.
 */
export function createQueryPersister(storage: KeyValueStore = appKeyValueStore()) {
  return createAsyncStoragePersister({
    key: QUERY_PERSIST_KEY,
    storage: {
      getItem: key => Promise.resolve(restoreMergedClient(storage, key)),
      setItem: (key, value) => {
        // `value` is the manifest JSON from `serializeSplitPersistedClient`
        // (the per-session blobs are already written); the next save
        // overwrites it. Legacy single-blob values never occur here.
        storage.setItem(key, value)
        return Promise.resolve()
      },
      removeItem: key => {
        removePersistedClient(storage, key)
        return Promise.resolve()
      },
    },
    serialize: client => serializeSplitPersistedClient(storage, QUERY_PERSIST_KEY, client),
    deserialize: raw => JSON.parse(raw),
    retry: persistRetry,
  })
}

export interface QueryProviderProps {
  children: ReactNode
  /** Injectable client (tests). Defaults to the app client. */
  client?: QueryClient
  /** Injectable persister (tests). Defaults to the MMKV persister. */
  persister?: ReturnType<typeof createQueryPersister>
}

export function QueryProvider({children, client, persister}: QueryProviderProps) {
  // The session store lives above this provider (Root: SessionProvider
  // wraps QueryProvider), so the runtime-401 handler can verify through
  // the real store. Bare trees (some tests) have no store — the client
  // still gets the caches, but failures are ignored. An explicitly
  // injected `client` keeps its own caches (existing tests).
  const runtime401Store = useOptionalSessionStore()
  const [queryClient] = useState(() => client ?? createAppQueryClient(runtime401Store))
  const [activePersister] = useState(() => persister ?? createQueryPersister())
  useEffect(() => {
    const [stopPersisting, restored] = persistQueryClient({
      queryClient,
      persister: activePersister,
      maxAge: QUERY_PERSIST_MAX_AGE,
      buster: QUERY_BUSTER,
      dehydrateOptions: {shouldDehydrateQuery},
    })
    restored.catch(() => {
      // A corrupt/expired cache is already discarded by the restorer;
      // boot continues cold.
    })
    return () => {
      stopPersisting()
    }
  }, [queryClient, activePersister])
  // Session purge (repair X1.2): the session store lives outside React and
  // cannot see this client, so it purges query state through this registry.
  // Nothing else in this file is the purge slice's to touch.
  useEffect(() => registerSessionPurger(createQueryPurger(queryClient)), [queryClient])
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
