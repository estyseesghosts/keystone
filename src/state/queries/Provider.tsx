import {useEffect, useState, type ReactNode} from 'react'
import {createAsyncStoragePersister} from '@tanstack/query-async-storage-persister'
import {persistQueryClient} from '@tanstack/react-query-persist-client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import type {KeyValueStore} from '@keystone/fedi'

import {appKeyValueStore} from '#/storage'
import {createQueryPurger, registerSessionPurger} from '#/state/session/purge'

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

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
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
  const [queryClient] = useState(() => client ?? createAppQueryClient())
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
