// Reports queue (Wave 3 slice 3.2 — the daily moderation surface).
//
// React-query state for the queue list + one report, keyed by
// `adminReportsQueryKey` / `adminReportQueryKey` (sessionId FIRST —
// switching accounts switches keys, never data).
//
// - `adminReportsGate` is the single entry/section gate: signed-out,
//   module-less or capability-unsupported backends stay hidden; a
//   non-staff viewer gets the honest not-staff reason instead of an empty
//   screen. Role comes from verify_credentials at the session layer, same
//   as the insight gate.
// - A 403 on any section disables THAT section with a reason — it never
//   clears the session (nothing here touches the session store; the
//   global scope-upgrade prompt already owns re-auth).
// - A 404 (forks without the queue endpoints) reads as the honest absent
//   state, never an error page.
// - Mutations confirm in the UI first, then run and invalidate the queue
//   + detail keys (confirm + refetch). Optimistic updates are FORBIDDEN on
//   this surface: the server's answer is the new state.
// - Detail: the Mastodon family fetches `get(id)` fresh; the Misskey
//   family has no show endpoint, so detail selects the row from the
//   unfiltered queue query (same key the list uses for filter 'all' — one
//   shared fetch). A row missing from the loaded page reads absent with a
//   reason, never a fabricated report.

import {useMemo, useSyncExternalStore} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'

import {
  adminRoleOf,
  backendForSession,
  isPermissionError,
  isUnsupportedError,
  misskeyAdminRoleOf,
  type Account,
  type Backend,
  type QueuedReport,
  type ReportRecategorizePatch,
  type ReportResolution,
  type ReportsQueueApi,
  type ReportsQueueListOpts,
  type Session,
} from '@keystone/fedi'

import {useSessionStore} from '#/state/session/SessionProvider'

import {useMe} from './me'
import {createQueryKey, type AppQueryKey} from './keys'
import {STALE} from './stale'
import {
  type AdminRole,
  type AdminSection,
  type AdminGate,
  type AdminGateReason,
} from './adminInsight'

export type {AdminRole, AdminGate, AdminGateReason}

/** Key for the reports-queue list (session first, like every other key). */
export function adminReportsQueryKey(sessionId: string, filter: string = 'all'): AppQueryKey {
  return createQueryKey(sessionId, 'admin-reports', filter)
}

/** Key for one queued report (the Mastodon `get` fetch; Misskey detail
 * reuses the unfiltered list key instead — see `useAdminReport`). */
export function adminReportQueryKey(sessionId: string, id: string): AppQueryKey {
  return createQueryKey(sessionId, 'admin-report', id)
}

export type AdminQueueFilter = 'all' | 'open' | 'resolved'

function filterToListOpts(filter: AdminQueueFilter): ReportsQueueListOpts {
  if (filter === 'open') return {state: 'open'}
  if (filter === 'resolved') return {state: 'resolved'}
  return {}
}

/**
 * The single entry/section gate. `account` is the live `useMe` account
 * with the sign-in-time `session.user` cache as fallback (both carry the
 * role the same way the insight gate reads it).
 */
export function adminReportsGate(
  backend: Backend | null,
  account: Account | null,
): AdminGate {
  if (!backend) return {ok: false, reason: 'signed-out'}
  if (backend.family !== 'mastodon' && backend.family !== 'misskey') {
    return {ok: false, reason: 'unsupported'}
  }
  if (!backend.reportsQueue) {
    return {ok: false, reason: 'unsupported'}
  }
  if (backend.capabilities.admin_read === 'unsupported') {
    return {ok: false, reason: 'unsupported'}
  }
  const role = backend.family === 'misskey' ? misskeyAdminRoleOf(account) : adminRoleOf(account)
  if (role == null) return {ok: false, reason: 'not-staff'}
  return {ok: true}
}

interface SectionPayload<T> {
  data: T
  /** True when the server answered 404/405 (no such endpoint here). */
  absent: boolean
  /** True when the token/role may not read this section (403). */
  denied: boolean
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

function toSection<T>(query: {
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
  data?: SectionPayload<T> | undefined
}): AdminSection<T> {
  const retry = () => void query.refetch()
  if (query.isPending) return {data: null, status: 'loading', error: null, retry}
  if (query.isError)
    return {data: null, status: 'error', error: query.error, retry}
  const payload = query.data
  if (!payload || payload.denied)
    return {data: null, status: 'denied', error: null, retry}
  if (payload.absent)
    return {data: null, status: 'absent', error: null, retry}
  return {data: payload.data, status: 'ready', error: null, retry}
}

export interface AdminReportsQueueState {
  backend: Backend | null
  role: AdminRole | null
  gate: AdminGate
  queue: AdminSection<QueuedReport[]>
}

export function useAdminReportsQueue(
  sessionId: string | null,
  filter: AdminQueueFilter = 'open',
): AdminReportsQueueState {
  const {session, backend} = useSessionBackend(sessionId)
  const {me} = useMe(sessionId)
  const account = me ?? session?.user ?? null
  const role = backend?.family === 'misskey' ? misskeyAdminRoleOf(account) : adminRoleOf(account)
  const gate = adminReportsGate(backend, account)

  const staff = gate.ok
  const queueApi = staff ? backend?.reportsQueue ?? null : null
  const listOpts = filterToListOpts(filter)
  const query = useQuery({
    queryKey: sessionId ? adminReportsQueryKey(sessionId, filter) : ['admin-reports', 'signed-out'],
    enabled: staff && queueApi != null,
    staleTime: STALE.ACCOUNT,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SectionPayload<QueuedReport[]>> => {
      try {
        const page = await queueApi!.list({...listOpts, limit: 20})
        return {data: page.items, absent: false, denied: false}
      } catch (e) {
        if (isUnsupportedError(e)) return {data: [], absent: true, denied: false}
        if (isPermissionError(e)) return {data: [], absent: false, denied: true}
        throw e
      }
    },
  })
  const base = toSection(query)
  const queue: AdminSection<QueuedReport[]> =
    !sessionId || !backend
      ? {...base, data: null, status: 'unavailable'}
      : !staff
        ? {...base, data: null, status: 'gated'}
        : base.data && base.data.length === 0 && base.status === 'ready'
          ? {...base, status: 'empty'}
          : base
  return {backend, role, gate, queue}
}

export interface AdminReportState {
  backend: Backend | null
  role: AdminRole | null
  gate: AdminGate
  report: AdminSection<QueuedReport>
}

/**
 * One queued report. Mastodon fetches `get(id)` fresh (its own key, so a
 * detail refresh never re-pages the list); Misskey selects the row from
 * the shared unfiltered queue query (no show endpoint upstream — a row
 * missing from the loaded page reads absent with a reason).
 */
export function useAdminReport(
  sessionId: string | null,
  id: string | null,
): AdminReportState {
  const {session, backend} = useSessionBackend(sessionId)
  const {me} = useMe(sessionId)
  const account = me ?? session?.user ?? null
  const role = backend?.family === 'misskey' ? misskeyAdminRoleOf(account) : adminRoleOf(account)
  const gate = adminReportsGate(backend, account)

  const staff = gate.ok
  const queueApi = staff ? backend?.reportsQueue ?? null : null
  const useGet = backend?.family === 'mastodon' && typeof queueApi?.get === 'function'
  const getQuery = useQuery({
    queryKey: sessionId && id ? adminReportQueryKey(sessionId, id) : ['admin-report', 'signed-out'],
    enabled: staff && useGet && id != null,
    staleTime: STALE.ACCOUNT,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SectionPayload<QueuedReport>> => {
      try {
        return {data: await queueApi!.get!(id!), absent: false, denied: false}
      } catch (e) {
        if (isUnsupportedError(e)) return {data: null as unknown as QueuedReport, absent: true, denied: false}
        if (isPermissionError(e)) return {data: null as unknown as QueuedReport, absent: false, denied: true}
        throw e
      }
    },
  })
  const listQuery = useQuery({
    queryKey: sessionId ? adminReportsQueryKey(sessionId, 'all') : ['admin-reports', 'signed-out'],
    enabled: staff && !useGet && id != null,
    staleTime: STALE.ACCOUNT,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SectionPayload<QueuedReport[]>> => {
      try {
        const page = await queueApi!.list({limit: 20})
        return {data: page.items, absent: false, denied: false}
      } catch (e) {
        if (isUnsupportedError(e)) return {data: [], absent: true, denied: false}
        if (isPermissionError(e)) return {data: [], absent: false, denied: true}
        throw e
      }
    },
  })

  if (!sessionId || !backend || id == null) {
    return {
      backend,
      role,
      gate,
      report: {data: null, status: 'unavailable', error: null, retry: () => {}},
    }
  }
  if (!staff) {
    return {
      backend,
      role,
      gate,
      report: {data: null, status: 'gated', error: null, retry: () => {}},
    }
  }
  if (useGet) return {backend, role, gate, report: toSection(getQuery)}
  const section = toSection(listQuery)
  if (section.status !== 'ready' || !section.data) {
    return {backend, role, gate, report: {...section, data: null}}
  }
  const row = section.data.find(r => r.id === id) ?? null
  if (!row) {
    return {
      backend,
      role,
      gate,
      report: {data: null, status: 'absent', error: null, retry: section.retry},
    }
  }
  return {backend, role, gate, report: {data: row, status: 'ready', error: null, retry: section.retry}}
}

function requireQueue(backend: Backend | null): ReportsQueueApi {
  if (!backend) throw new Error('Sign in to moderate reports.')
  if (!backend.reportsQueue) throw new Error('Reports are not available on this server.')
  return backend.reportsQueue
}

function useReportsMutation<TVars>(
  sessionId: string | null,
  run: (queue: ReportsQueueApi, vars: TVars) => Promise<void>,
) {
  const queryClient = useQueryClient()
  const {backend} = useSessionBackend(sessionId)
  return useMutation<void, Error, TVars>({
    mutationFn: async vars => {
      await run(requireQueue(backend), vars)
    },
    onSuccess: (_value, vars) => {
      if (!sessionId) return
      void queryClient.invalidateQueries({queryKey: adminReportsQueryKey(sessionId)})
      const id = typeof vars === 'string' ? vars : (vars as {id?: unknown} | null)?.id
      if (typeof id === 'string' && id) {
        void queryClient.invalidateQueries({queryKey: adminReportQueryKey(sessionId, id)})
      }
    },
  })
}

/** Claim the report for the viewer (Mastodon only). Confirm in the UI, then refetch. */
export function useAssignReport(sessionId: string | null) {
  return useReportsMutation<string>(sessionId, (queue, id) => queue.assignToSelf!(id))
}

/** Release the claim (Mastodon only). */
export function useUnassignReport(sessionId: string | null) {
  return useReportsMutation<string>(sessionId, (queue, id) => queue.unassign!(id))
}

/** Re-open a resolved report (Mastodon only). */
export function useReopenReport(sessionId: string | null) {
  return useReportsMutation<string>(sessionId, (queue, id) => queue.reopen!(id))
}

export interface ResolveReportVars {
  id: string
  decision?: ReportResolution | null
}

/** Resolve/close the report (both families; the verdict is Misskey-only). */
export function useResolveReport(sessionId: string | null) {
  return useReportsMutation<ResolveReportVars>(sessionId, (queue, {id, decision}) =>
    queue.resolve(id, decision != null ? {decision} : undefined),
  )
}

export interface RecategorizeReportVars {
  id: string
  patch: ReportRecategorizePatch
}

/** Change category/rules (Mastodon only). */
export function useRecategorizeReport(sessionId: string | null) {
  return useReportsMutation<RecategorizeReportVars>(sessionId, (queue, {id, patch}) =>
    queue.recategorize!(id, patch),
  )
}

export interface UpdateReportNoteVars {
  id: string
  note: string
}

/** Set the moderator note, verbatim (Misskey only; empty clears it). */
export function useUpdateReportNote(sessionId: string | null) {
  return useReportsMutation<UpdateReportNoteVars>(sessionId, (queue, {id, note}) =>
    queue.updateNote!(id, note),
  )
}

/** Forward the report to the target's home server (Misskey only). */
export function useForwardReport(sessionId: string | null) {
  return useReportsMutation<string>(sessionId, (queue, id) => queue.forward!(id))
}
