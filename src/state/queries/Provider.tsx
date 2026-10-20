import {useEffect, useState, type ReactNode} from 'react'
import {createAsyncStoragePersister} from '@tanstack/query-async-storage-persister'
import {persistQueryClient} from '@tanstack/react-query-persist-client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import type {KeyValueStore} from '@keystone/fedi'

import {appKeyValueStore} from '#/storage'

import {GC_TIME, QUERY_BUSTER, QUERY_PERSIST_MAX_AGE, STALE} from './stale'

// Query provider (slice 3.2): the app's `QueryClient` plus MMKV-backed
// query persistence. Nothing persisted before this slice (verified: no
// `QueryClient` / persist wiring anywhere in `src/`), so this wires
// `persistQueryClient` with an MMKV storage adapter.
//
// Scoping by sessionId: every query key carries the sessionId first
// (`createQueryKey`), so the persisted cache is inherently partitioned per
// account — restoring never serves account A's timeline to account B.
//
// Mounting: this component only. `SessionProvider` stays unmounted here
// (slice 3.1 owns it); Root composition is left to the orchestrator.

/** Persister storage key (stable — the buster versions the payload). */
export const QUERY_PERSIST_KEY = 'keystone-query-cache'

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE.FEED,
        gcTime: GC_TIME.FEED,
        retry: 2,
        refetchOnWindowFocus: false,
      },
    },
  })
}

/**
 * MMKV-backed query persister. The `KeyValueStore` seam is sync (MMKV is
 * synchronous); the persister wants async, so this adapts without
 * changing the seam. Injectable for tests.
 */
export function createQueryPersister(storage: KeyValueStore = appKeyValueStore()) {
  return createAsyncStoragePersister({
    key: QUERY_PERSIST_KEY,
    storage: {
      getItem: key => Promise.resolve(storage.getItem(key)),
      setItem: (key, value) => {
        storage.setItem(key, value)
        return Promise.resolve()
      },
      removeItem: key => {
        storage.removeItem(key)
        return Promise.resolve()
      },
    },
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
    })
    restored.catch(() => {
      // A corrupt/expired cache is already discarded by the restorer;
      // boot continues cold.
    })
    return () => {
      stopPersisting()
    }
  }, [queryClient, activePersister])
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
