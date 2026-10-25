// Session purge (repair X1.2: privacy 2/7, storage S3/S5/S6, networking H3,
// sessions-cache 1/6/7).
//
// Removing an account or signing out wipes every trace of it: the
// `QueryClient` entries for the session (cancelled first, so an in-flight
// fetch cannot repopulate the cache after the delete), the per-session
// persisted-query blob, the post-shadow overlay, registered stream stops,
// and every `<prefix>.<sessionId>` MMKV key the app writes.
//
// Split by necessity, not by taste: the session store lives outside React
// and cannot see the `QueryClient`, so the query half arrives through a
// registry (`registerSessionPurger`, called once by `QueryProvider` with a
// client-bound purger from `createQueryPurger`). The storage/memory half
// (`purgeSessionStorage` / `purgeSessionMemory`) needs no client and is
// called directly. Both halves are best-effort and never throw: local
// sign-out always completes, even when a backend or the storage shim
// misbehaves.
//
// The single exported `sessionScopedKeys(id)` list is the whole per-session
// key surface. A test enumerates every live MMKV key after a purge and
// asserts none contains the removed id, so a new key builder that is not
// added here fails loudly instead of leaking.

import type {Query, QueryClient} from '@tanstack/react-query'

import {softMuteKeyFor, type KeyValueStore} from '@keystone/fedi'

import {recentsKeyFor} from '#/components/EmojiPicker/recents'
import {postShadowStore} from '#/state/cache/post-shadow'
import {
  perSessionPersistKey,
  QUERY_PERSIST_KEY,
  removePersistedClient,
  type PersistManifest,
} from '#/state/queries/persistPolicy'
import {accountKeyFor, purgeAccountScope} from '#/storage/schema'
import {draftsKeyFor, openDraftKeyFor, purgeDrafts} from '#/storage/drafts'

// NOTE: drafts.ts and schema.ts both export their key builders plus a
// `purge*` helper (slice scope). `src/storage/recents.ts` and
// `src/storage/emojiPrefs.ts` do not exist (those owners live at
// `src/components/EmojiPicker/recents.ts` and `src/state/emojiPrefs.ts`),
// hence the local mirrors below — each tested behaviourally against the
// real owner API.

/** Mirrors `scopedKey(FAVOURITES_BASE, scope)` in `src/state/emojiPrefs.ts`
 * (scope = session id). The device-global `anon` bucket is never purged. */
export function favouritesKeyFor(sessionId: string): string {
  if (!sessionId) throw new Error('favouritesKeyFor requires a sessionId')
  return `keystone.emojifavs.${sessionId}`
}

/** Mirrors `scopedKey(LIKE_EMOJI_BASE, scope)` in `src/state/emojiPrefs.ts`
 * (scope = session id; `anon` untouched). */
export function likeEmojiKeyFor(sessionId: string): string {
  if (!sessionId) throw new Error('likeEmojiKeyFor requires a sessionId')
  return `keystone.likeemoji.${sessionId}`
}

/** Mirrors `homeTabKeyFor` in `src/screens/Home.tsx`. Kept local (not
 * imported): importing the screen would drag the component tree into the
 * session layer. The enumeration test writes the same literal the screen
 * writes, so a format change on either side must change both. */
export function homeTabKeyFor(sessionId: string): string {
  if (!sessionId) throw new Error('homeTabKeyFor requires a sessionId')
  return `keystone.homeTab:${sessionId}`
}

/** Every MMKV key owned by one session. Add new per-session builders here
 * (and purge them below) — the enumeration test fails otherwise. */
export function sessionScopedKeys(sessionId: string): string[] {
  return [
    draftsKeyFor(sessionId),
    openDraftKeyFor(sessionId),
    accountKeyFor(sessionId),
    softMuteKeyFor(sessionId),
    recentsKeyFor(sessionId),
    favouritesKeyFor(sessionId),
    likeEmojiKeyFor(sessionId),
    homeTabKeyFor(sessionId),
    perSessionPersistKey(sessionId),
  ]
}

function removeQuietly(storage: KeyValueStore, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    // Best-effort: local sign-out completes even on storage failure.
  }
}

/** Drop the session from the persisted-query manifest (the per-session blob
 * itself is removed with the other scoped keys). Without this the manifest
 * would keep listing a session whose blob is gone. */
function prunePersistManifest(storage: KeyValueStore, sessionId: string): void {
  let manifest: PersistManifest | null = null
  try {
    const raw = storage.getItem(QUERY_PERSIST_KEY)
    if (!raw) return
    manifest = JSON.parse(raw) as PersistManifest
  } catch {
    return
  }
  if (!manifest || !Array.isArray(manifest.sessions) || !manifest.sessions.includes(sessionId)) return
  try {
    storage.setItem(
      QUERY_PERSIST_KEY,
      JSON.stringify({buster: manifest.buster, sessions: manifest.sessions.filter(s => s !== sessionId)}),
    )
  } catch {
    // Best-effort (see above).
  }
}

/** Delete every MMKV trace of a session (keys + persisted-query blob +
 * manifest entry). Never throws. */
export function purgeSessionStorage(storage: KeyValueStore, sessionId: string): void {
  if (!sessionId) return
  purgeDrafts(storage, sessionId)
  purgeAccountScope(storage, sessionId)
  removeQuietly(storage, softMuteKeyFor(sessionId))
  removeQuietly(storage, recentsKeyFor(sessionId))
  removeQuietly(storage, favouritesKeyFor(sessionId))
  removeQuietly(storage, likeEmojiKeyFor(sessionId))
  removeQuietly(storage, homeTabKeyFor(sessionId))
  removeQuietly(storage, perSessionPersistKey(sessionId))
  prunePersistManifest(storage, sessionId)
}

/** Drop the in-memory traces of a session (post shadow + stream stops).
 * Never throws. Gives `postShadowStore.clearSession` its first non-test
 * caller (sessions-cache 1). */
export function purgeSessionMemory(sessionId: string): void {
  if (!sessionId) return
  try {
    postShadowStore.clearSession(sessionId)
  } catch {
    // Best-effort (see above).
  }
  stopSessionStreams(sessionId)
}

/** Remove the whole persisted query cache (manifest + every per-session
 * blob). `signOutEverywhere` only. Never throws. */
export function purgeAllPersistedSessions(storage: KeyValueStore): void {
  try {
    removePersistedClient(storage, QUERY_PERSIST_KEY)
  } catch {
    // Best-effort (see above).
  }
}

// --- Stream stops (X3.4 owns the mounts; this is only the stop seam) --------

/** One live subscription's teardown for a session. */
export type SessionStreamStop = () => void

const streamStops = new Map<string, Set<SessionStreamStop>>()

/** Register a live teardown for a session (live mounts call this; purge
 * runs and forgets them). Returns an unregister function. */
export function registerSessionStreamStop(sessionId: string, stop: SessionStreamStop): () => void {
  if (!sessionId || typeof stop !== 'function') return () => undefined
  let set = streamStops.get(sessionId)
  if (!set) streamStops.set(sessionId, (set = new Set()))
  set.add(stop)
  return () => {
    const live = streamStops.get(sessionId)
    live?.delete(stop)
    if (live && live.size === 0) streamStops.delete(sessionId)
  }
}

/** Run and forget every registered teardown for a session. Never throws. */
export function stopSessionStreams(sessionId: string): void {
  const set = streamStops.get(sessionId)
  if (!set) return
  streamStops.delete(sessionId)
  for (const stop of [...set]) {
    try {
      stop()
    } catch {
      // A failing teardown must never block sign-out.
    }
  }
}

// --- QueryClient registry (the store lives outside React) -------------------

/** The query-cache half of a purge, bound to a `QueryClient` by the
 * provider. Both halves run for one removed session; `clearAllQueries`
 * additionally runs on `signOutEverywhere`. */
export interface SessionQueryPurger {
  removeSessionQueries(sessionId: string): Promise<void> | void
  clearAllQueries(): Promise<void> | void
}

let registered: SessionQueryPurger | null = null

/** Install the query purger (called once by `QueryProvider`). Returns an
 * unregister function for unmount/tests. */
export function registerSessionPurger(next: SessionQueryPurger | null): () => void {
  registered = next
  return () => {
    if (registered === next) registered = null
  }
}

/** Test hook: the currently registered purger, if any. */
export function registeredSessionPurger(): SessionQueryPurger | null {
  return registered
}

/** Build a purger bound to a client: cancel in-flight session queries,
 * then remove them (cancel first, so a late response cannot repopulate the
 * cache after the delete — sessions-cache 9 pattern). Every key is
 * sessionId-first (X0.1 rule), hence `queryKey[0]`. */
export function createQueryPurger(queryClient: QueryClient): SessionQueryPurger {
  const forSession =
    (sessionId: string) =>
    (query: Query): boolean =>
      Array.isArray(query.queryKey) && query.queryKey[0] === sessionId
  return {
    async removeSessionQueries(sessionId: string): Promise<void> {
      if (!sessionId) return
      const predicate = forSession(sessionId)
      await queryClient.cancelQueries({predicate})
      await queryClient.removeQueries({predicate})
    },
    async clearAllQueries(): Promise<void> {
      await queryClient.cancelQueries()
      queryClient.clear()
    },
  }
}

/** Run the registered `removeSessionQueries`, if any. Best-effort: a
 * missing purger (store used without a provider, e.g. some tests) or a
 * throwing client never blocks the storage/memory purge. */
export async function removeSessionQueries(sessionId: string): Promise<void> {
  const purger = registered
  if (!purger || !sessionId) return
  try {
    await purger.removeSessionQueries(sessionId)
  } catch {
    // Best-effort (see above).
  }
}

/** Run the registered `clearAllQueries`, if any. Best-effort (see above). */
export async function clearAllQueries(): Promise<void> {
  const purger = registered
  if (!purger) return
  try {
    await purger.clearAllQueries()
  } catch {
    // Best-effort (see above).
  }
}
