import {useMemo, useSyncExternalStore} from 'react'
import {useQuery} from '@tanstack/react-query'

import {
  backendForSession,
  isUnsupportedError,
  type Backend,
  type InstanceRule,
} from '@keystone/fedi'

import {useSessionStore} from '#/state/session/SessionProvider'

import {reportRulesQueryKey} from './keys'
import {STALE} from './stale'

// Server rules for the report chooser (clickstone §1.5). Mastodon serves
// `GET /api/v1/instance/rules`; Akkoma/Pleroma answer 404 and Misskey has no
// such endpoint at all. Those are NOT errors: the sheet hides the rules
// step and shows the reason. Auth/network failures also degrade to a reason
// instead of blocking the report (the comment/category path still works).
//
// The query key is session-scoped (keys.ts), so two accounts on different
// servers never share a rule list. Mounted only while the chooser is open.

export type ReportRulesStatus = 'loading' | 'ready' | 'empty' | 'absent' | 'error' | 'unavailable'

export interface ReportRulesState {
  rules: InstanceRule[]
  status: ReportRulesStatus
}

interface RulesPayload {
  rules: InstanceRule[]
  /** True when the server answered 404/405 (no rules endpoint). */
  absent: boolean
}

function useSessionBackend(sessionId: string | null): Backend | null {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const session = sessionId ? (snapshot.sessions.find(s => s.id === sessionId) ?? null) : null
  return useMemo(() => (session ? backendForSession(session) : null), [session])
}

export function useReportRules(sessionId: string | null): ReportRulesState {
  const backend = useSessionBackend(sessionId)
  const hasEndpoint = typeof backend?.instanceRules === 'function'
  const query = useQuery({
    queryKey: sessionId ? reportRulesQueryKey(sessionId) : ['report-rules', 'signed-out'],
    enabled: !!sessionId && hasEndpoint,
    staleTime: STALE.ACCOUNT,
    retry: false,
    queryFn: async (): Promise<RulesPayload> => {
      try {
        return {rules: await backend!.instanceRules!(), absent: false}
      } catch (e) {
        if (isUnsupportedError(e)) return {rules: [], absent: true}
        throw e
      }
    },
  })

  if (!sessionId || !backend) return {rules: [], status: 'unavailable'}
  if (!hasEndpoint) return {rules: [], status: 'absent'}
  if (query.isPending) return {rules: [], status: 'loading'}
  if (query.isError) return {rules: [], status: 'error'}
  const data = query.data
  if (!data || data.absent) return {rules: [], status: 'absent'}
  if (data.rules.length === 0) return {rules: [], status: 'empty'}
  return {rules: data.rules, status: 'ready'}
}
