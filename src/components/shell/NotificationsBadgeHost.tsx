import {useContext, useMemo} from 'react'
import {QueryClientContext} from '@tanstack/react-query'

import {backendForSession} from '@keystone/fedi'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'
import {useLiveNotifications} from '#/state/streaming'

// Shell-level live notification channel (P6.5): mounted ONCE inside the
// provider tree so the unread count ticks on every screen — not
// screen-scoped, not boot-only. The Notifications screen must NOT mount
// `useLiveNotifications` itself (a double mount double-increments the
// count). Renders null; suspend/foreground discipline stays with
// `monitorStreamAppState` in the streaming mount.
//
// The guard keeps provider-less trees (tests, bare shells) rendering:
// no QueryClient, no mount, never a crash (the hook reads the client,
// so it can only run inside the inner component).
export function NotificationsBadgeHost() {
  const qc = useContext(QueryClientContext)
  if (!qc) return null
  return <NotificationsBadgeHostInner />
}

function NotificationsBadgeHostInner() {
  const session = useOptionalActiveSession()
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  useLiveNotifications(session?.id ?? null, backend)
  return null
}
