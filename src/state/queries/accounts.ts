// Mention → account resolution (chips show avatar + display name, not the
// raw handle). One cached query per (session, username, host) over
// `backend.account`, so a timeline full of the same mention hits the
// network once. Unresolvable mentions (deleted, typo, lookup 404) stay
// unresolved — callers render the handle fallback, never an error.

import {useQuery} from '@tanstack/react-query'

import {parseAcct, type Account, type Backend} from '@keystone/fedi'

import {GC_TIME, STALE} from './stale'
import {createQueryKey, type AppQueryKey} from './keys'

export function mentionedAccountQueryKey(
  sessionId: string,
  username: string,
  host: string | null,
): AppQueryKey {
  return createQueryKey(sessionId, 'mention-account', username, host ?? '')
}

export function useMentionedAccount(
  backend: Backend | null,
  sessionId: string | null,
  label: string | null,
): Account | null {
  const ref = label ? parseAcct(label) : null
  const query = useQuery<Account, Error, Account, AppQueryKey>({
    queryKey: createQueryKey(
      sessionId ?? 'signed-out',
      'mention-account',
      ref?.username ?? '',
      ref?.host ?? '',
    ),
    queryFn: async () => {
      if (!backend || !ref) throw new Error('unresolved mention')
      return backend.account({username: ref.username, host: ref.host})
    },
    enabled: backend != null && ref != null && sessionId != null,
    staleTime: STALE.ACCOUNT,
    gcTime: GC_TIME.ACCOUNT,
    retry: false,
  })
  return query.data ?? null
}
