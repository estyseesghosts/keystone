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

export function fullAccountQueryKey(sessionId: string, accountId: string): AppQueryKey {
  return createQueryKey(sessionId, 'full-account', accountId)
}

// Embedded timeline authors can be lite (Misskey packs no banner/bio on
// notes; Mastodon embeds are full). The hovercard shows the embedded
// account immediately and upgrades to the fetched full account when it
// lands (cached per session, so one users/show per account). Genuinely
// bannerless users keep the fallback block — null is honest, not broken.
export function useFullAccount(
  backend: Backend | null,
  sessionId: string | null,
  account: Account | null,
): Account | null {
  const needsFetch = account !== null && (account.headerUrl == null || account.headerUrl === '')
  const query = useQuery<Account, Error, Account, AppQueryKey>({
    queryKey: createQueryKey(sessionId ?? 'signed-out', 'full-account', account?.id ?? ''),
    queryFn: async () => {
      if (!backend || !account) throw new Error('unresolvable account')
      return backend.account({id: account.id})
    },
    enabled: backend != null && sessionId != null && account !== null && needsFetch,
    staleTime: STALE.ACCOUNT,
    gcTime: GC_TIME.ACCOUNT,
    retry: false,
  })
  if (!account) return null
  return query.data ?? account
}
