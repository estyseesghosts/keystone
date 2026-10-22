import {createContext, useContext, useEffect, useMemo, type ReactNode} from 'react'
import {useSyncExternalStore} from 'react'

import {setPermissionDeniedObserver, type Session} from '@keystone/fedi'

import {appStorage, appTokenVault} from '#/storage'

import {createSessionStore, type SessionScopeHealth, type SessionStore} from './store'

// Session provider (slice 2.5): minimal but real React integration over
// the session store. One store per tree (prop-injectable for tests);
// boot adopts the device mirror then hydrates vault tokens once.

const SessionStoreContext = createContext<SessionStore | null>(null)

export interface SessionProviderProps {
  children: ReactNode
  /** Binds migrated internal tokens (the app's own origin). */
  homeOrigin: string
  /** Injectable store (tests). Defaults to the app MMKV + vault wiring. */
  store?: SessionStore
}

export function SessionProvider({children, homeOrigin, store}: SessionProviderProps) {
  const value = useMemo(
    () =>
      store ??
      createSessionStore({storage: appStorage(), vault: appTokenVault(), homeOrigin}),
    [store, homeOrigin],
  )
  useEffect(() => {
    value.initialize()
    void value.hydrate()
  }, [value])
  // 0.8: the Misskey transport's one error path reports permission
  // denials here, so every refused call — from a feed query, a settings
  // action or a screen that catches locally — marks the session for the
  // shell's upgrade prompt. Returned disposer is identity-safe.
  useEffect(
    () =>
      setPermissionDeniedObserver(event => {
        value.notePermissionDenied(event.sessionId)
      }),
    [value],
  )
  return <SessionStoreContext.Provider value={value}>{children}</SessionStoreContext.Provider>
}

export function useSessionStore(): SessionStore {
  const store = useContext(SessionStoreContext)
  if (!store) throw new Error('useSessionStore must be used inside SessionProvider')
  return store
}

/** Like `useSessionStore` but null outside a provider (presentational trees). */
export function useOptionalSessionStore(): SessionStore | null {
  return useContext(SessionStoreContext)
}

/** All stored sessions (reactive). */
export function useSessions(): Session[] {
  const store = useSessionStore()
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().sessions)
}

/** The active session, or null (reactive). Never a half session. */
export function useActiveSession(): Session | null {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return snapshot.sessions.find(s => s.id === snapshot.activeId) ?? null
}

/**
 * Like `useActiveSession` but null outside a provider (shell chrome renders
 * in bare test trees) or when signed out. Never throws, never a half
 * session.
 */
const EMPTY_SNAPSHOT = {sessions: [], activeId: null}
const NO_SUBSCRIBE = () => () => {}

export function useOptionalActiveSession(): Session | null {
  const store = useOptionalSessionStore()
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? NO_SUBSCRIBE,
    store ? store.getSnapshot : () => EMPTY_SNAPSHOT,
  )
  return snapshot.sessions.find(s => s.id === snapshot.activeId) ?? null
}

/**
 * Scope/permission health of the ACTIVE session (0.8). Null when signed
 * out or outside a provider. Reactive: the store emits on a recorded
 * permission denial, so the shell prompt appears without a screen
 * remount. Uses `scopeHealthSnapshot` because `useSyncExternalStore`
 * requires a stable snapshot reference between emits. Never invents data —
 * it is `scopeHealth` straight through.
 */
export function useScopeHealth(): SessionScopeHealth | null {
  const store = useOptionalSessionStore()
  const session = useOptionalActiveSession()
  const sessionId = session?.id ?? null
  return useSyncExternalStore(
    store?.subscribe ?? NO_SUBSCRIBE,
    () => (store && sessionId ? store.scopeHealthSnapshot(sessionId) : null),
  )
}
