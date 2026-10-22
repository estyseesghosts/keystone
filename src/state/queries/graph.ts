import {useCallback, useMemo, useSyncExternalStore} from 'react'
import {useQuery, useQueryClient, type QueryClient} from '@tanstack/react-query'

import {
  applyBlocked,
  applyFollowDesired,
  applyMuted,
  backendForSession,
  followDesiredOf,
  gateGraph,
  isPureRenote,
  readSoftMutes,
  writeSoftMute,
  type Backend,
  type FollowDesired,
  type GraphGate,
  type KeyValueStore,
  type Post,
  type Relationship,
} from '@keystone/fedi'

import {createToggleQueue, type ToggleQueue} from '#/lib/hooks/useToggleMutationQueue'
import {appStorage} from '#/storage'
import {useSessionStore} from '#/state/session/SessionProvider'

import {createQueryKey, type AppQueryKey} from './keys'

// Social graph (slice 4.4): relationship query, optimistic follow / mute /
// block through the desired-value toggle queue (one queue per
// session+account+kind), list membership, client-side soft mute.
// Relationship state lives in the react-query cache under a sessionId-first
// key, so switching accounts can never show another account's edge.

export function relationshipQueryKey(sessionId: string, accountId: string): AppQueryKey {
  return createQueryKey(sessionId, 'relationship', accountId)
}

export function listMembershipQueryKey(sessionId: string, accountId: string): AppQueryKey {
  return createQueryKey(sessionId, 'list-membership', accountId)
}

export class GraphUnavailableError extends Error {
  readonly reasonCode: string
  constructor(gate: Extract<GraphGate, {enabled: false}>) {
    super(gate.reason)
    this.name = 'GraphUnavailableError'
    this.reasonCode = gate.reasonCode
  }
}

const emptyRel = (id: string): Relationship => ({id})

// --- Soft mute store (per session, persisted) -------------------------------

export interface SoftMuteStore {
  list(sessionId: string): string[]
  has(sessionId: string, accountId: string): boolean
  set(sessionId: string, accountId: string, muted: boolean): void
  subscribe(fn: () => void): () => void
}

export function createSoftMuteStore(storage: () => KeyValueStore = appStorage): SoftMuteStore {
  const listeners = new Set<() => void>()
  const cache = new Map<string, string[]>()
  const read = (sessionId: string) => {
    let v = cache.get(sessionId)
    if (!v) {
      v = readSoftMutes(storage(), sessionId)
      cache.set(sessionId, v)
    }
    return v
  }
  return {
    list: read,
    has: (sessionId, accountId) => read(sessionId).includes(accountId),
    set(sessionId, accountId, muted) {
      cache.set(sessionId, writeSoftMute(storage(), sessionId, accountId, muted))
      listeners.forEach(l => l())
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export const softMuteStore: SoftMuteStore = createSoftMuteStore()

// --- Controller -------------------------------------------------------------

export interface GraphController {
  setFollow(sessionId: string, backend: Backend | null, account: {id: string; locked?: boolean}, next: FollowDesired): Promise<void>
  setMuted(sessionId: string, backend: Backend | null, accountId: string, next: boolean): Promise<void>
  setBlocked(sessionId: string, backend: Backend | null, accountId: string, next: boolean): Promise<void>
  /** Incoming request from `accountId` (the viewer's followers queue). */
  resolveFollowRequest(sessionId: string, backend: Backend | null, accountId: string, accept: boolean): Promise<void>
  setListMember(sessionId: string, backend: Backend | null, listId: string, accountId: string, next: boolean): Promise<void>
  /** Current optimistic relationship (cache), if any. */
  relationship(sessionId: string, accountId: string): Relationship | undefined
}

export function createGraphController(deps: {queryClient: QueryClient; softMutes?: SoftMuteStore}): GraphController {
  const qc = deps.queryClient
  const queues = new Map<string, ToggleQueue<any>>()

  const getRel = (s: string, id: string) => qc.getQueryData<Relationship>(relationshipQueryKey(s, id))
  const setRel = (s: string, id: string, rel: Relationship) => qc.setQueryData(relationshipQueryKey(s, id), rel)

  function refuse(gate: GraphGate): Promise<void> | null {
    return gate.enabled ? null : Promise.reject(new GraphUnavailableError(gate))
  }
  const gateOf = (kind: Parameters<typeof gateGraph>[0], backend: Backend | null, accountId: string, selfId?: string) =>
    gateGraph(kind, {capabilities: backend?.capabilities ?? null, targetId: accountId, selfId})

  function toggle<T>(
    kind: string,
    sessionId: string,
    accountId: string,
    initial: T,
    backend: Backend,
    apply: (rel: Relationship, v: T) => Relationship,
    run: (b: Backend, from: T, to: T) => Promise<void>,
    next: T,
  ): Promise<void> {
    const key = `${sessionId}\u0000${accountId}\u0000${kind}`
    let q = queues.get(key) as ToggleQueue<T> | undefined
    if (!q) {
      // `confirmedRel` is the server-confirmed relationship; optimistic and
      // rollback views are always derived from it, so a rollback restores
      // side effects too (block also clears the follow edge).
      let confirmedRel = getRel(sessionId, accountId) ?? emptyRel(accountId)
      let confirmedValue = initial
      const view = (v: T) => (Object.is(v, confirmedValue) ? confirmedRel : apply(confirmedRel, v))
      q = createToggleQueue<T>({
        initial,
        run: (from, to) => run(backend, from, to),
        onOptimistic: v => setRel(sessionId, accountId, view(v)),
        onConfirmed: v => {
          confirmedRel = apply(confirmedRel, v)
          confirmedValue = v
        },
        onRollback: v => setRel(sessionId, accountId, view(v)),
        onSettled: () => {
          queues.delete(key)
          void qc.invalidateQueries({queryKey: relationshipQueryKey(sessionId, accountId)})
        },
      })
      queues.set(key, q)
    }
    return q.queueToggle(next)
  }

  return {
    relationship: getRel,

    setFollow(sessionId, backend, account, next) {
      const gate = gateOf('follow', backend, account.id)
      const refused = refuse(gate)
      if (refused || !backend) return refused ?? Promise.resolve()
      const rel = getRel(sessionId, account.id)
      const wasPending = !!rel?.hasPendingFollowRequestFromYou
      const initial: FollowDesired = rel ? followDesiredOf(rel) : 'none'
      let pending = wasPending
      return toggle<FollowDesired>(
        'follow',
        sessionId,
        account.id,
        initial,
        backend,
        (r, v) => applyFollowDesired(r, v, !!account.locked),
        async (b, _from, to) => {
          if (to === 'following') {
            await b.follow(account.id)
            pending = !!account.locked
          } else if (pending) {
            await b.cancelFollowRequest(account.id)
            pending = false
          } else {
            await b.unfollow(account.id)
          }
        },
        next,
      )
    },

    setMuted(sessionId, backend, accountId, next) {
      const refused = refuse(gateOf('mute', backend, accountId))
      if (refused || !backend) return refused ?? Promise.resolve()
      return toggle<boolean>(
        'mute', sessionId, accountId, !!getRel(sessionId, accountId)?.isMuted, backend, applyMuted,
        async (b, _f, to) => (to ? b.mute(accountId) : b.unmute(accountId)),
        next,
      )
    },

    setBlocked(sessionId, backend, accountId, next) {
      const refused = refuse(gateOf('block', backend, accountId))
      if (refused || !backend) return refused ?? Promise.resolve()
      return toggle<boolean>(
        'block', sessionId, accountId, !!getRel(sessionId, accountId)?.isBlocking, backend, applyBlocked,
        async (b, _f, to) => (to ? b.block(accountId) : b.unblock(accountId)),
        next,
      )
    },

    async resolveFollowRequest(sessionId, backend, accountId, accept) {
      const refused = refuse(gateOf('follow_request', backend, accountId))
      if (refused || !backend) return refused ?? undefined
      const before = getRel(sessionId, accountId)
      setRel(sessionId, accountId, {
        ...(before ?? emptyRel(accountId)),
        hasPendingFollowRequestToYou: false,
        ...(accept ? {isFollowed: true} : {}),
      })
      try {
        await (accept ? backend.acceptFollowRequest(accountId) : backend.rejectFollowRequest(accountId))
      } catch (e) {
        setRel(sessionId, accountId, before ?? emptyRel(accountId))
        throw e
      } finally {
        void qc.invalidateQueries({queryKey: relationshipQueryKey(sessionId, accountId)})
      }
    },

    async setListMember(sessionId, backend, listId, accountId, next) {
      const refused = refuse(gateOf('list', backend, accountId))
      if (refused) return refused
      const api = backend?.lists?.membership
      if (!api) throw new GraphUnavailableError({enabled: false, reasonCode: 'gate.noListMembership', reason: 'This server cannot edit list members.'})
      const key = listMembershipQueryKey(sessionId, accountId)
      const before = qc.getQueryData<string[]>(key) ?? []
      qc.setQueryData(key, next ? [...before.filter(i => i !== listId), listId] : before.filter(i => i !== listId))
      try {
        await (next ? api.add(listId, accountId) : api.remove(listId, accountId))
      } catch (e) {
        qc.setQueryData(key, before)
        throw e
      }
    },
  }
}

const controllers = new WeakMap<QueryClient, GraphController>()
export function graphControllerFor(qc: QueryClient): GraphController {
  let c = controllers.get(qc)
  if (!c) {
    c = createGraphController({queryClient: qc})
    controllers.set(qc, c)
  }
  return c
}

// --- Hooks ------------------------------------------------------------------

function useSessionBackend(sessionId: string): {backend: Backend | null; selfId: string | null} {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const session = snapshot.sessions.find(s => s.id === sessionId) ?? null
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  return {backend, selfId: session?.accountId ?? null}
}

export function useRelationship(sessionId: string, accountId: string) {
  const {backend, selfId} = useSessionBackend(sessionId)
  return useQuery({
    queryKey: relationshipQueryKey(sessionId, accountId),
    enabled: !!backend && !!selfId && selfId !== accountId,
    queryFn: async () => {
      const [rel] = await backend!.relationships([accountId])
      return rel ?? emptyRel(accountId)
    },
  })
}

export function useListMembership(sessionId: string, accountId: string, enabled = true) {
  const {backend} = useSessionBackend(sessionId)
  return useQuery({
    queryKey: listMembershipQueryKey(sessionId, accountId),
    enabled: enabled && !!backend?.lists?.membership,
    queryFn: () => backend!.lists!.membership!.containing(accountId),
  })
}

export function useSoftMute(sessionId: string, accountId: string) {
  const muted = useSyncExternalStore(
    softMuteStore.subscribe,
    () => softMuteStore.has(sessionId, accountId),
  )
  const set = useCallback((next: boolean) => softMuteStore.set(sessionId, accountId, next), [sessionId, accountId])
  return {muted, set}
}

export interface GraphActions {
  follow: {gate: GraphGate; set: (next: FollowDesired) => Promise<void>}
  mute: {gate: GraphGate; set: (next: boolean) => Promise<void>}
  block: {gate: GraphGate; set: (next: boolean) => Promise<void>}
  lists: {gate: GraphGate; set: (listId: string, next: boolean) => Promise<void>}
  followRequest: {gate: GraphGate; resolve: (accept: boolean) => Promise<void>}
}

export function useGraphActions(sessionId: string, account: {id: string; locked?: boolean}): GraphActions {
  const qc = useQueryClient()
  const {backend, selfId} = useSessionBackend(sessionId)
  const controller = graphControllerFor(qc)
  const caps = backend?.capabilities ?? null
  const g = (kind: Parameters<typeof gateGraph>[0]) =>
    gateGraph(kind, {capabilities: caps, selfId, targetId: account.id})
  const listsGate = g('list')
  return {
    follow: {gate: g('follow'), set: n => controller.setFollow(sessionId, backend, account, n)},
    mute: {gate: g('mute'), set: n => controller.setMuted(sessionId, backend, account.id, n)},
    block: {gate: g('block'), set: n => controller.setBlocked(sessionId, backend, account.id, n)},
    lists: {
      gate: listsGate.enabled && !backend?.lists?.membership
        ? {enabled: false, reasonCode: 'gate.noListMembership', reason: 'This server cannot edit list members.'}
        : listsGate,
      set: (l, n) => controller.setListMember(sessionId, backend, l, account.id, n),
    },
    followRequest: {gate: g('follow_request'), resolve: a => controller.resolveFollowRequest(sessionId, backend, account.id, a)},
  }
}

// --- Soft-mute feed filter (slice 4.6) --------------------------------------

const NO_SOFT_MUTES: string[] = []

/** Soft-muted account ids for a session (live; empty when signed out). */
export function useSoftMutedIds(sessionId: string | null): string[] {
  return useSyncExternalStore(softMuteStore.subscribe, () =>
    sessionId ? softMuteStore.list(sessionId) : NO_SOFT_MUTES,
  )
}

/** The soft-mute feed predicate, shared by the filter below and the
 * card badge: a row is soft-muted when its author is, or when it is a
 * pure repost whose original author is. Takes a lookup so callers with
 * a set never rebuild one per post. */
function matchesSoftMute(post: Post, isMuted: (accountId: string) => boolean): boolean {
  if (isMuted(post.author.id)) return true
  return isPureRenote(post) && post.renote !== null && isMuted(post.renote.author.id)
}

/** Whether one row is soft-muted (same predicate the feed uses to drop
 * it). Pure: the badge says "soft-muted" only when this is true. */
export function isSoftMutedPost(post: Post, mutedIds: readonly string[]): boolean {
  if (mutedIds.length === 0) return false
  const muted = new Set(mutedIds)
  return matchesSoftMute(post, id => muted.has(id))
}

/** Drop posts authored by, or pure reposts of, soft-muted accounts. */
export function filterSoftMuted(posts: Post[], mutedIds: readonly string[]): Post[] {
  if (mutedIds.length === 0) return posts
  const muted = new Set(mutedIds)
  return posts.filter(p => !matchesSoftMute(p, id => muted.has(id)))
}
