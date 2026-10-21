// Session-scoped custom-emoji stores (WS-C).
//
// `createCustomEmojiStore` is per-session state (hosted listing + remote
// per-host tables + load state). This registry owns one store per
// session id so render paths (`CustomEmojiGlyph`, the picker) subscribe
// to the SAME store for their session — a token only ever reaches its
// own origin because the store's wire call is built FROM that session
// (via `createMisskeyClient`, exactly like `backendForSession`).
//
// Multi-account correctness: entries are keyed by session id, and a
// stored entry is rebuilt when the session's origin/token/family
// drifts (re-auth replaces the session object). Mastodon-family
// sessions get a store too — its local listing immediately resolves
// `unavailable` (no Misskey endpoint is ever called) while the
// remote-host tables still work (direct public fetches, family-free).
//
// React Compiler note: bare `store.state()` reads in render get frozen
// by the compiler (memoized on the stable store identity). Every live
// read below goes through `useCustomEmojiSelect`, whose selector runs
// inside `useSyncExternalStore` — React re-invokes it on each store
// emission, so host listings landing re-render their readers. Selector
// results must be referentially stable (primitives, or the store's own
// stable refs) or the snapshot never settles.

import {useEffect, useMemo, useSyncExternalStore} from 'react'

import {createCustomEmojiStore, createMisskeyClient, type CustomEmojiStore, type Session} from '@keystone/fedi'

import {useOptionalSessionStore} from '#/state/session/SessionProvider'
import type {SessionSnapshot} from '#/state/session/store'

interface Entry {
  origin: string
  token: string
  family: string
  store: CustomEmojiStore
}

const entries = new Map<string, Entry>()

function matches(entry: Entry, session: Session): boolean {
  return entry.origin === session.origin && entry.token === session.token && entry.family === session.family
}

/** The store for exactly one session (get-or-create; rebuilt on drift). */
export function customEmojiStoreFor(session: Session): CustomEmojiStore {
  const existing = entries.get(session.id)
  if (existing && matches(existing, session)) return existing.store
  const store = createCustomEmojiStore(createMisskeyClient(session).call, session.family)
  entries.set(session.id, {origin: session.origin, token: session.token, family: session.family, store})
  return store
}

/** Test seam: drop every cached store. */
export function resetCustomEmojiStoresForTests(): void {
  entries.clear()
}

/** Stable empty snapshot for session-less trees. */
export const NO_CUSTOM_EMOJIS: [] = []

const NO_SUBSCRIBE = () => () => {}
const EMPTY_SESSIONS: SessionSnapshot = {sessions: [], activeId: null}
const EMPTY_SESSION_SNAPSHOT = () => EMPTY_SESSIONS

/** The session's store (null when signed out / no provider). Kicks the
 * local listing load once per store (idempotent — a no-op when ready).
 * Reads go through `useCustomEmojiSelect` (below), never bare. */
export function useCustomEmojiStore(sessionId: string | null): CustomEmojiStore | null {
  const sessionStore = useOptionalSessionStore()
  const snapshot = useSyncExternalStore(
    sessionStore?.subscribe ?? NO_SUBSCRIBE,
    sessionStore ? sessionStore.getSnapshot : EMPTY_SESSION_SNAPSHOT,
  )
  const session = sessionId ? (snapshot.sessions.find(s => s.id === sessionId) ?? null) : null
  const store = useMemo(() => (session ? customEmojiStoreFor(session) : null), [session])
  useEffect(() => {
    store?.load()
  }, [store])
  return store
}

/** A live read of the session's store: `select` re-runs on every store
 * emission (host listing ready, remote host landed, error) and on every
 * render, so late resolutions swap in. `select` must return a
 * referentially stable value for unchanged state (a primitive, the
 * store's own array ref, or a shared empty) — a fresh array per call
 * would re-render forever. */
export function useCustomEmojiSelect<T>(store: CustomEmojiStore | null, select: (store: CustomEmojiStore | null) => T): T {
  const subscribe = useMemo(
    () => (store ? (fn: () => void) => store.onChange(fn) : NO_SUBSCRIBE),
    [store],
  )
  const getSnapshot = useMemo(() => () => select(store), [store, select])
  return useSyncExternalStore(subscribe, getSnapshot)
}
