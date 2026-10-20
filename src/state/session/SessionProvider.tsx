import {createContext, useContext, useEffect, useMemo, type ReactNode} from 'react'
import {useSyncExternalStore} from 'react'

import type {Session} from '@keystone/fedi'

import {appStorage, appTokenVault} from '#/storage'

import {createSessionStore, type SessionStore} from './store'

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
