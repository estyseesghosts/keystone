import {useMemo, useSyncExternalStore} from 'react'
import {useQuery} from '@tanstack/react-query'

import {
  backendForSession,
  checkNoteWordMute,
  isInstanceMuted,
  isPureRenote,
  muteCheckOf,
  type Account,
  type Backend,
  type Cursor,
  type Page,
  type Post,
} from '@keystone/fedi'

import {useSessionStore} from '#/state/session/SessionProvider'

import {serverBlocksQueryKey, serverMutesQueryKey, serverRenoteMutesQueryKey} from './keys'
import {useMe, wordMuteListsOf} from './me'
import {STALE} from './stale'

// Server-side feed moderation (F22/MK1 — v1 `TimelineFeed.isExcluded`
// parity): blocked/muted account sets, renote-muted reposts, hard word
// mutes and muted instances DROP rows in every feed. Server soft words
// (`mutedWords`) only BADGE rows in v1 and there is no badge UI in this
// build (F16, not a W4 row), so they are deliberately not applied here —
// see DECISIONS. The client soft-mute set (`filterSoftMuted`) stays as
// the per-session account hide until badge UI exists.

export interface ModerationRules {
  selfId: string | null
  hardMutedWords: Array<string | string[]> | null
  mutedInstances: string[] | null
  mutedIds: ReadonlySet<string>
  blockedIds: ReadonlySet<string>
  renoteMutedIds: ReadonlySet<string>
}

const EMPTY_SET: ReadonlySet<string> = new Set()

export const EMPTY_RULES: ModerationRules = {
  selfId: null,
  hardMutedWords: null,
  mutedInstances: null,
  mutedIds: EMPTY_SET,
  blockedIds: EMPTY_SET,
  renoteMutedIds: EMPTY_SET,
}

// Bounded page walk for id sets: feeds need the whole set, but a runaway
// follower-scale list must never page forever.
const MAX_MODERATION_IDS = 500

async function fetchIdSet(
  fetch: (cursor: Cursor | null) => Promise<Page<Account>>,
): Promise<string[]> {
  const ids: string[] = []
  let cursor: Cursor | null = null
  for (;;) {
    const page = await fetch(cursor)
    for (const item of page.items) {
      if (ids.length >= MAX_MODERATION_IDS) return ids
      ids.push(item.id)
    }
    if (page.end || !page.cursor) return ids
    cursor = page.cursor
  }
}

function useIdSet(
  sessionId: string | null,
  backend: Backend | null,
  key: (sessionId: string) => readonly unknown[],
  fetch: (backend: Backend, cursor: Cursor | null) => Promise<Page<Account>>,
): ReadonlySet<string> {
  const query = useQuery({
    queryKey: sessionId ? key(sessionId) : ['moderation', 'signed-out'],
    enabled: !!sessionId && !!backend,
    staleTime: STALE.ACCOUNT,
    // Best-effort per session (v1 parity): 404/a missing member means an
    // empty set and feeds simply show everything — never an error state.
    queryFn: async (): Promise<string[]> => {
      try {
        return await fetchIdSet(cursor => fetch(backend!, cursor))
      } catch {
        return []
      }
    },
  })
  return useMemo(() => new Set(query.data ?? []), [query.data])
}

function useModerationBackend(sessionId: string | null): {backend: Backend | null; selfId: string | null} {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const session = sessionId ? (snapshot.sessions.find(s => s.id === sessionId) ?? null) : null
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  return {backend, selfId: session?.accountId ?? null}
}

/** Live server-side moderation rules for a session (empty rules when
 * signed out — feeds show everything). */
export function useModerationRules(sessionId: string | null): ModerationRules {
  const {backend, selfId} = useModerationBackend(sessionId)
  const {me} = useMe(sessionId)
  const lists = useMemo(() => wordMuteListsOf(me), [me])
  const mutedIds = useIdSet(sessionId, backend, serverMutesQueryKey, (b, cursor) =>
    b.mutes({cursor, limit: 100}),
  )
  const blockedIds = useIdSet(sessionId, backend, serverBlocksQueryKey, (b, cursor) =>
    b.blocks({cursor, limit: 100}),
  )
  const renoteMutedIds = useIdSet(sessionId, backend, serverRenoteMutesQueryKey, (b, cursor) =>
    // `renoteMutes` is optional (no Mastodon-family endpoint): absent
    // means an empty set, and the Mutes section keeps its placeholder.
    b.renoteMutes ? b.renoteMutes({cursor, limit: 100}) : Promise.resolve({items: [], cursor: null, end: true}),
  )
  return useMemo(
    () => ({
      selfId,
      hardMutedWords: lists.hardMutedWords,
      mutedInstances: lists.mutedInstances,
      mutedIds,
      blockedIds,
      renoteMutedIds,
    }),
    [selfId, lists, mutedIds, blockedIds, renoteMutedIds],
  )
}

/** v1 `isExcluded` mirror: the wrapper if it carries own content, else
 * the pure renote's original (quotes check their own post). */
function shownOf(post: Post): Post {
  return isPureRenote(post) && post.renote ? post.renote : post
}

/** Drop every row the server-side rules exclude (pure — v1 semantics). */
export function filterModerated(posts: Post[], rules: ModerationRules): Post[] {
  if (
    rules.mutedIds.size === 0 &&
    rules.blockedIds.size === 0 &&
    rules.renoteMutedIds.size === 0 &&
    rules.hardMutedWords == null &&
    rules.mutedInstances == null
  ) {
    return posts
  }
  return posts.filter(post => {
    const involved = [post.accountId, post.reply?.accountId, post.renote?.accountId].filter(
      (id): id is string => typeof id === 'string',
    )
    if (involved.some(id => rules.blockedIds.has(id) || rules.mutedIds.has(id))) return false
    if (post.renote && rules.renoteMutedIds.has(post.renote.accountId)) return false
    const shown = muteCheckOf(shownOf(post))
    if (checkNoteWordMute(shown, rules.selfId, rules.hardMutedWords) !== false) return false
    return !isInstanceMuted(shown, rules.mutedInstances)
  })
}
