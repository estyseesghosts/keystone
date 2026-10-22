// Server-insight queries (Wave 3 slice 3.1 — read-only, no mutations).
//
// React-query state for the one admin screen, keyed by
// `adminInsightQueryKey` (sessionId FIRST — switching accounts switches
// keys, never data).
//
// - Role comes from verify_credentials at the session layer: the live
//   `useMe` account first, the sign-in-time `session.user` cache as the
//   sync fallback for entries. `adminRoleOf` reads the Mastodon `role`
//   verbatim plus Akkoma/Pleroma `is_admin`/`is_moderator` — never a guess.
// - `adminInsightGate` is the single entry/section gate: signed-out,
//   non-Mastodon or module-less backends stay hidden; a capability flag
//   reading `unsupported` closes the surface; a non-staff viewer gets the
//   honest not-staff reason instead of an empty screen.
// - A 403 on measures/dimensions disables THAT section with a reason — it
//   never clears the session (nothing here touches the session store; the
//   global scope-upgrade prompt already owns re-auth).
// - A 404 (forks without `/api/v1/admin/*`, disabled public endpoints)
//   reads as the honest absent state, never an error page.

import {useMemo, useSyncExternalStore} from 'react'
import {useQuery} from '@tanstack/react-query'

import {
  adminRoleOf,
  backendForSession,
  isPermissionError,
  isUnsupportedError,
  type Account,
  type AdminDimension,
  type AdminMeasure,
  type Backend,
  type InstanceActivityWeek,
  type InstanceExtendedDescription,
  type Session,
} from '@keystone/fedi'

import {useSessionStore} from '#/state/session/SessionProvider'

import {useMe} from './me'
import {createQueryKey, type AppQueryKey} from './keys'
import {STALE} from './stale'

/** Key for the server-insight screen state. Session first, like every
 * other key, so two accounts never share an insight cache entry. */
export function adminInsightQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, 'admin-insight')
}

export type AdminRole = 'admin' | 'moderator'

/** Why the insight surface stays closed (stable codes; the UI localizes). */
export type AdminGateReason = 'signed-out' | 'unsupported' | 'not-staff'

export type AdminGate = {ok: true} | {ok: false; reason: AdminGateReason}

/**
 * The single entry/section gate. `account` is the live `useMe` account
 * with the sign-in-time `session.user` as fallback (both carry the
 * verify_credentials role on `ext.mastodon`).
 */
export function adminInsightGate(
  backend: Backend | null,
  account: Account | null,
): AdminGate {
  if (!backend) return {ok: false, reason: 'signed-out'}
  if (backend.family !== 'mastodon' || !backend.adminInsight) {
    return {ok: false, reason: 'unsupported'}
  }
  if (backend.capabilities.admin_read === 'unsupported') {
    return {ok: false, reason: 'unsupported'}
  }
  if (adminRoleOf(account) == null) return {ok: false, reason: 'not-staff'}
  return {ok: true}
}

export type AdminSectionStatus =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'denied'
  | 'absent'
  | 'error'
  | 'gated'
  | 'unavailable'

export interface AdminSection<T> {
  data: T | null
  status: AdminSectionStatus
  error: unknown
  retry: () => void
}

interface SectionPayload<T> {
  data: T
  /** True when the server answered 404/405 (no such endpoint here). */
  absent: boolean
  /** True when the token/role may not read this section (403). */
  denied: boolean
}

function useAdminSection<T>(
  key: AppQueryKey,
  enabled: boolean,
  run: () => Promise<T>,
  empty: (data: T) => boolean,
): AdminSection<T> {
  const query = useQuery({
    queryKey: key,
    enabled,
    staleTime: STALE.ACCOUNT,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SectionPayload<T>> => {
      try {
        return {data: await run(), absent: false, denied: false}
      } catch (e) {
        if (isUnsupportedError(e)) return {data: [] as unknown as T, absent: true, denied: false}
        if (isPermissionError(e)) return {data: [] as unknown as T, absent: false, denied: true}
        throw e
      }
    },
  })
  if (!enabled) return {data: null, status: 'gated', error: null, retry: () => {}}
  if (query.isPending) return {data: null, status: 'loading', error: null, retry: () => {}}
  if (query.isError)
    return {data: null, status: 'error', error: query.error, retry: () => void query.refetch()}
  const payload = query.data
  if (!payload || payload.denied)
    return {data: null, status: 'denied', error: null, retry: () => void query.refetch()}
  if (payload.absent)
    return {data: null, status: 'absent', error: null, retry: () => void query.refetch()}
  if (empty(payload.data))
    return {data: payload.data, status: 'empty', error: null, retry: () => void query.refetch()}
  return {data: payload.data, status: 'ready', error: null, retry: () => void query.refetch()}
}

function useSessionBackend(sessionId: string | null): {
  session: Session | null
  backend: Backend | null
} {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(() => {
    const session = sessionId
      ? (snapshot.sessions.find(s => s.id === sessionId) ?? null)
      : null
    return {session, backend: session ? backendForSession(session) : null}
  }, [snapshot, sessionId])
}

const isEmptyList = (data: unknown): boolean => Array.isArray(data) && data.length === 0

export interface AdminInsightState {
  backend: Backend | null
  /** Live role (verify_credentials via `useMe`, sign-in cache fallback). */
  role: AdminRole | null
  gate: AdminGate
  measures: AdminSection<AdminMeasure[]>
  dimensions: AdminSection<AdminDimension[]>
  peers: AdminSection<string[]>
  extendedDescription: AdminSection<InstanceExtendedDescription>
  activity: AdminSection<InstanceActivityWeek[]>
}

export function useAdminInsight(sessionId: string | null): AdminInsightState {
  const {session, backend} = useSessionBackend(sessionId)
  const {me} = useMe(sessionId)
  const account = me ?? session?.user ?? null
  const role = adminRoleOf(account)
  const gate = adminInsightGate(backend, account)

  const staff = gate.ok
  const base = sessionId ? adminInsightQueryKey(sessionId) : ['admin-insight', 'signed-out']
  const keyFor = (part: string): AppQueryKey => [...base, part]
  const admin = backend?.adminInsight ?? null

  const measures = useAdminSection<AdminMeasure[]>(
    keyFor('measures'),
    staff && !!admin,
    () => admin!.measures(['active_users', 'new_users', 'instance_accounts', 'instance_statuses', 'opened_reports', 'resolved_reports']),
    isEmptyList,
  )
  const dimensions = useAdminSection<AdminDimension[]>(
    keyFor('dimensions'),
    staff && !!admin,
    () => admin!.dimensions(['sources']),
    isEmptyList,
  )
  const peers = useAdminSection<string[]>(
    keyFor('peers'),
    staff && !!admin,
    () => admin!.peers(),
    isEmptyList,
  )
  const extendedDescription = useAdminSection<InstanceExtendedDescription>(
    keyFor('extended-description'),
    staff && !!admin,
    () => admin!.extendedDescription(),
    data => data.html.length === 0,
  )
  const activity = useAdminSection<InstanceActivityWeek[]>(
    keyFor('activity'),
    staff && !!admin,
    () => admin!.activity(),
    isEmptyList,
  )

  if (!sessionId || !backend) {
    const unavailable = <T,>(s: AdminSection<T>): AdminSection<T> => ({
      ...s,
      data: null,
      status: 'unavailable',
    })
    return {
      backend,
      role,
      gate,
      measures: unavailable(measures),
      dimensions: unavailable(dimensions),
      peers: unavailable(peers),
      extendedDescription: unavailable(extendedDescription),
      activity: unavailable(activity),
    }
  }
  return {backend, role, gate, measures, dimensions, peers, extendedDescription, activity}
}
