import {useMemo, useSyncExternalStore} from 'react'
import {useQuery} from '@tanstack/react-query'

import {backendForSession, type Account} from '@keystone/fedi'

import {useSessionStore} from '#/state/session/SessionProvider'

import {meQueryKey} from './keys'
import {STALE} from './stale'

// Viewer account (F22/MK1 foundation): word/instance/hard mutes live on
// `me.ext.me`, so every feed filter reads them from here — one cached
// query per session, never a per-screen `backend.me()` call. Signed out
// (or backend-less) sessions get `null`, and every consumer treats null
// as "no server-side rules", never an error.

export function useMe(sessionId: string | null): {me: Account | null; isPending: boolean} {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const session = sessionId ? (snapshot.sessions.find(s => s.id === sessionId) ?? null) : null
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  const query = useQuery({
    queryKey: sessionId ? meQueryKey(sessionId) : ['me', 'signed-out'],
    enabled: !!sessionId && !!backend,
    staleTime: STALE.ACCOUNT,
    queryFn: async (): Promise<Account> => backend!.me(),
  })
  return {me: query.data ?? null, isPending: query.isPending && !!sessionId && !!backend}
}

/** Misskey-family word/instance/hard-mute lists off `me.ext.me` (v1
 * `TimelineFeed.wordLists` parity: same keys, same shapes, absent → null
 * so the matcher is a no-op on families without them). */
export interface WordMuteLists {
  mutedWords: Array<string | string[]> | null
  hardMutedWords: Array<string | string[]> | null
  mutedInstances: string[] | null
}

export function wordMuteListsOf(me: Account | null): WordMuteLists {
  const raw = (me?.ext.me ?? {}) as Record<string, unknown>
  const words = (key: string): Array<string | string[]> | null => {
    const v = raw[key]
    return Array.isArray(v) ? (v as Array<string | string[]>) : null
  }
  const instances = raw.mutedInstances
  return {
    mutedWords: words('mutedWords'),
    hardMutedWords: words('hardMutedWords'),
    mutedInstances: Array.isArray(instances)
      ? instances.filter((x): x is string => typeof x === 'string')
      : null,
  }
}
