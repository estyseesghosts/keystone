// Persisted query-cache policy (repair X1.4: privacy 1, storage S7/S8,
// sessions-cache 8, security L4).
//
// Default-deny: only the query kinds in `PERSIST_POLICY` with
// `persist: true` reach MMKV, size-bounded (`PERSIST_MAX_BYTES`) and split
// one MMKV key per `sessionId`. Everything else — conversations, chat,
// notifications, bookmarks/favourites, drafts (scheduled and server),
// admin, search, moderation, relationships, single-post and thread views —
// is never serialised, so a direct-message conversation or a
// followers-only post cannot survive in the persisted blob.
//
// `shouldDehydrateQuery` is the `dehydrateOptions` predicate wired in
// `Provider.tsx`. The persister `serialize` runs the same policy again and
// additionally strips private rows, trims infinite queries to
// `maxPages`, caps the blob (largest queries dropped first), and splits
// the write per session. The persister `retry` hook shrinks the same way
// when the store itself rejects a save. Nothing here throws.

import type {DehydratedState, Query} from '@tanstack/react-query'
import type {PersistedClient} from '@tanstack/react-query-persist-client'

/** One serialised query row (`DehydratedQuery` is not exported; index the state). */
type DehydratedQuery = DehydratedState['queries'][number]

import type {KeyValueStore} from '@keystone/fedi'

/** Stable MMKV key for the persist manifest (per-session blobs hang off it). */
export const QUERY_PERSIST_KEY = 'keystone-query-cache'

/** First page only: a cold boot re-pages from there, never from page N. */
export const PERSIST_MAX_PAGES = 1

/** Cap for one serialised persisted blob (S7). Overflow drops the largest
 * queries first; the save never throws. */
export const PERSIST_MAX_BYTES = 2 * 1024 * 1024

/** How many store-rejected saves are retried (shrinking) before giving up. */
export const PERSIST_RETRY_ATTEMPTS = 5

export interface PersistRule {
  persist: boolean
  /** Infinite queries only: pages kept per query (first page). */
  maxPages?: number
}

/**
 * Default-deny map from query kind (the second element of the key, see
 * `queryKindOfKey`) to its persist verdict. A kind missing here is denied.
 * Persisted: public timelines (descriptor-gated below), profiles, emoji,
 * instance metadata, and `me`. Never persisted: conversations, chat,
 * notifications, bookmarks/favourites, drafts, admin, search, moderation,
 * relationships, single-post/thread views.
 */
export const PERSIST_POLICY: Record<string, PersistRule> = {
  // Allowlist.
  'post-feed': {persist: true, maxPages: PERSIST_MAX_PAGES},
  account: {persist: true},
  'full-account': {persist: true},
  'mention-account': {persist: true},
  'custom-emojis': {persist: true},
  'compose-limits': {persist: true},
  'report-rules': {persist: true},
  me: {persist: true},
  // Explicit deny (documents the audit surface; missing kinds deny too).
  post: {persist: false},
  'post-thread': {persist: false},
  'thread-replies': {persist: false},
  'post-reposts': {persist: false},
  'post-reactions': {persist: false},
  'post-history': {persist: false},
  notifications: {persist: false},
  'server-mutes': {persist: false},
  'server-blocks': {persist: false},
  'server-renote-mutes': {persist: false},
  'server-filters': {persist: false},
  relationship: {persist: false},
  'list-membership': {persist: false},
  conversations: {persist: false},
  conversation: {persist: false},
  'chat-rooms': {persist: false},
  'chat-room': {persist: false},
  'chat-room-messages': {persist: false},
  'chat-user-messages': {persist: false},
  'scheduled-posts': {persist: false},
  'server-drafts': {persist: false},
  recommendations: {persist: false},
  moderation: {persist: false},
  'admin-insight': {persist: false},
  'admin-reports': {persist: false},
  'admin-report': {persist: false},
}

/**
 * The only feed descriptors allowed into the persisted blob: the public
 * timelines, first page. User tabs, lists, antennas, channels, clips,
 * tags, search, explore, bookmarks and mentions are personalised (or DM /
 * followers-only adjacent) and always refetch. Note the recommendations
 * feed never matches: its key carries a `|rec-params` suffix.
 */
export const PERSISTED_FEED_DESCRIPTORS: ReadonlySet<string> = new Set([
  'timeline|home',
  'timeline|local',
  'timeline|social',
  'timeline|global',
])

/**
 * The query kind for policy lookup. Session-scoped keys read the second
 * element (`[sessionId, kind, ...]`); signed-out fallbacks read the first
 * (`['me', 'signed-out']`); the recommendations compound reads
 * `'recommendations'` either way. Returns null when no kind is present.
 */
export function queryKindOfKey(key: readonly unknown[] | unknown): string | null {
  if (!Array.isArray(key) || key.length === 0) return null
  const [first, second] = key as readonly unknown[]
  if (first === 'recommendations') return 'recommendations'
  if (second === 'signed-out') return typeof first === 'string' ? first : null
  if (first === 'signed-out') return typeof second === 'string' ? second : null
  return typeof second === 'string' ? second : null
}

/**
 * The owning session of a persisted key, or null for signed-out fallbacks
 * (`['me', 'signed-out']`, `['signed-out', ...]`) and malformed keys.
 * Null-session queries are never persisted (they carry no fresh data: every
 * such hook is disabled without a session).
 */
export function sessionIdOfKey(key: readonly unknown[] | unknown): string | null {
  if (!Array.isArray(key) || key.length < 2) return null
  const [first, second, third] = key as readonly unknown[]
  if (first === 'signed-out' || second === 'signed-out' || third === 'signed-out') {
    return null
  }
  return typeof first === 'string' && first.length > 0 ? first : null
}

/** Policy verdict for one query key (pure; default deny). */
export function shouldPersistQueryKey(key: readonly unknown[] | unknown): boolean {
  // Signed-out scopes never persist, even for allowlisted kinds: without
  // a session there is no owning account and no fresh data (every such
  // hook is disabled), and the X0.1 key rule requires session-first keys.
  if (sessionIdOfKey(key) == null) return false
  const kind = queryKindOfKey(key)
  if (kind == null) return false
  const rule = PERSIST_POLICY[kind]
  if (!rule?.persist) return false
  if (kind === 'post-feed') {
    const descriptor = Array.isArray(key) ? (key as readonly unknown[])[2] : undefined
    return typeof descriptor === 'string' && PERSISTED_FEED_DESCRIPTORS.has(descriptor)
  }
  return true
}

/**
 * `dehydrateOptions.shouldDehydrateQuery` for `persistQueryClient`: the
 * default success-only gate plus the policy. Wired in `Provider.tsx`.
 */
export function shouldDehydrateQuery(query: Query): boolean {
  if (query.state?.status !== 'success') return false
  return shouldPersistQueryKey(query.queryKey)
}

/** A post-like row whose own visibility is private (direct or followers). */
function isPrivatePost(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as {visibility?: {kind?: unknown}}).visibility?.kind
  return kind === 'direct' || kind === 'followers'
}

interface InfiniteShape {
  pages: Array<{items: unknown[]} & Record<string, unknown>>
  pageParams: unknown[]
  [key: string]: unknown
}

function isInfiniteData(data: unknown): data is InfiniteShape {
  if (typeof data !== 'object' || data === null) return false
  const pages = (data as {pages?: unknown}).pages
  return (
    Array.isArray(pages) &&
    pages.every(p => typeof p === 'object' && p !== null && Array.isArray((p as {items?: unknown}).items))
  )
}

interface ThreadShape {
  post?: unknown
  focused?: unknown
  ancestors?: unknown
  [key: string]: unknown
}

function isPostThread(data: unknown): data is ThreadShape {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
  const rec = data as Record<string, unknown>
  return 'focused' in rec && 'ancestors' in rec
}

/**
 * Strip private rows from dehydrated data (pure). Feed/thread pages drop
 * direct/followers rows; a lone private post (or a thread whose focused
 * post is private) drops the whole query (`undefined`); everything else
 * passes through untouched. Only explicit `direct`/`followers` kinds
 * strip — unclassified shapes are kept (never destroy data we cannot
 * classify).
 */
export function stripPrivateData(data: unknown): unknown {
  if (isInfiniteData(data)) {
    return {
      ...data,
      pages: data.pages.map(p => ({...p, items: p.items.filter(item => !isPrivatePost(item))})),
    }
  }
  if (Array.isArray(data)) return data.filter(item => !isPrivatePost(item))
  if (isPostThread(data)) {
    if (isPrivatePost(data.focused) || isPrivatePost(data.post)) return undefined
    const ancestors = Array.isArray(data.ancestors)
      ? data.ancestors.filter(a => !isPrivatePost(a))
      : data.ancestors
    return {...data, ancestors}
  }
  if (isPrivatePost(data)) return undefined
  return data
}

/**
 * Apply the policy to one dehydrated query: drop denied kinds, strip
 * private rows, trim infinite queries to `maxPages`. Returns null for a
 * dropped query.
 */
export function prepareDehydratedQuery(query: DehydratedQuery): DehydratedQuery | null {
  if (!shouldPersistQueryKey(query.queryKey)) return null
  const rule = PERSIST_POLICY[queryKindOfKey(query.queryKey) ?? '']
  const data = stripPrivateData(query.state?.data)
  if (data === undefined) return null
  if (rule?.maxPages !== undefined && isInfiniteData(data)) {
    return {
      ...query,
      state: {
        ...query.state,
        data: {...data, pages: data.pages.slice(0, rule.maxPages), pageParams: data.pageParams.slice(0, rule.maxPages)},
      },
    }
  }
  if (data !== query.state?.data) {
    return {...query, state: {...query.state, data}}
  }
  return query
}

/** Apply the policy to a whole dehydrated state (pure). Mutations never
 * persist: a paused mutation's variables can carry unsent DM/draft text,
 * and resume-across-restart is out of scope — the next mount refetches. */
export function filterPersistedState(state: DehydratedState): DehydratedState {
  const queries: DehydratedQuery[] = []
  for (const query of state?.queries ?? []) {
    const kept = prepareDehydratedQuery(query)
    if (kept) queries.push(kept)
  }
  return {mutations: [], queries}
}

function dehydratedQuerySize(query: DehydratedQuery): number {
  try {
    return JSON.stringify(query)?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * Drop the single largest query (by serialised size) from a persisted
 * client. Returns null when nothing is left to drop. Pure; never throws.
 */
export function dropLargestQuery(client: PersistedClient): PersistedClient | null {
  const queries = client?.clientState?.queries ?? []
  if (queries.length === 0) return null
  let largest = 0
  let largestSize = -1
  queries.forEach((query, index) => {
    const size = dehydratedQuerySize(query)
    if (size > largestSize) {
      largestSize = size
      largest = index
    }
  })
  return {
    ...client,
    clientState: {...client.clientState, queries: queries.filter((_, index) => index !== largest)},
  }
}

function emptyPersistedClient(timestamp: number, buster: string): PersistedClient {
  return {timestamp, buster, clientState: {mutations: [], queries: []}}
}

/**
 * Policy-filter, strip, trim and cap a persisted client (pure). Drops the
 * largest queries first until the blob fits `maxBytes`; an
 * unserialisable client degrades to an empty one. Never throws.
 */
export function shrinkToFit(client: PersistedClient, maxBytes: number = PERSIST_MAX_BYTES): PersistedClient {
  try {
    let next: PersistedClient = {
      ...client,
      clientState: filterPersistedState(client.clientState),
    }
    let size = JSON.stringify(next)?.length ?? 0
    while (size > maxBytes) {
      const smaller = dropLargestQuery(next)
      if (!smaller) break
      next = smaller
      size = JSON.stringify(next)?.length ?? 0
    }
    return next
  } catch {
    return emptyPersistedClient(client?.timestamp ?? Date.now(), client?.buster ?? '')
  }
}

/** Serialise a persisted client for the store (pure). Never throws. */
export function serializePersistedClient(client: PersistedClient): string {
  try {
    return JSON.stringify(shrinkToFit(client))
  } catch {
    return JSON.stringify(
      emptyPersistedClient(client?.timestamp ?? Date.now(), client?.buster ?? ''),
    )
  }
}

/**
 * Persister `retry` hook: a rejected save shrinks the client (largest
 * query dropped) for one more attempt. Gives up (`undefined`) past
 * `PERSIST_RETRY_ATTEMPTS` or when nothing is left to drop.
 */
export function persistRetry({
  persistedClient,
  errorCount,
}: {
  persistedClient: PersistedClient
  error: unknown
  errorCount: number
}): PersistedClient | undefined {
  if (errorCount > PERSIST_RETRY_ATTEMPTS) return undefined
  return dropLargestQuery(persistedClient) ?? undefined
}

/** FNV-1a (32-bit) over the canonical shape string. ASCII-only input. */
export function modelShapeHash(shapes: ReadonlyArray<readonly [string, readonly string[]]>): string {
  const canonical = shapes.map(([name, keys]) => `${name}:{${[...keys].sort().join(',')}}`).join(';')
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// --- Per-session split -------------------------------------------------------

/** MMKV key for one session's persisted queries. */
export function perSessionPersistKey(sessionId: string): string {
  return `${QUERY_PERSIST_KEY}.${sessionId}`
}

export interface PersistManifest {
  buster: string
  sessions: string[]
}

/** Group dehydrated queries by owning session (null-session queries drop). */
export function groupQueriesBySession(queries: DehydratedQuery[]): Map<string, DehydratedQuery[]> {
  const groups = new Map<string, DehydratedQuery[]>()
  for (const query of queries) {
    const sessionId = sessionIdOfKey(query.queryKey)
    if (!sessionId) continue
    const list = groups.get(sessionId)
    if (list) list.push(query)
    else groups.set(sessionId, [query])
  }
  return groups
}

/**
 * Serialise a persisted client into per-session blobs (S7). Filters,
 * strips, trims and caps first; then writes one MMKV value per session
 * (skipping sessions whose blob is unchanged, so one account's churn never
 * rewrites everyone's blob), prunes blobs for sessions no longer present,
 * and stores a manifest under `key` listing the sessions written (also
 * skipped when unchanged). Returns the manifest JSON. Never throws.
 *
 * The manifest carries no timestamp: per-blob envelopes keep their own
 * save times (restore uses the freshest), so a data-only change rewrites
 * exactly the changed session's blob and nothing else.
 */
export function serializeSplitPersistedClient(
  storage: KeyValueStore,
  key: string,
  client: PersistedClient,
): string {
  const timestamp = client?.timestamp ?? Date.now()
  const buster = client?.buster ?? ''
  try {
    const fitted = shrinkToFit(client)
    const groups = groupQueriesBySession(fitted.clientState.queries)
    let previous: PersistManifest | null = null
    try {
      const raw = storage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistManifest>
        if (parsed && Array.isArray(parsed.sessions)) previous = parsed as PersistManifest
      }
    } catch {
      previous = null
    }
    for (const [sessionId, queries] of groups) {
      // `dehydratedAt` is re-stamped on every dehydrate, which would make
      // every blob differ on every save. It carries no meaning across a
      // cold boot (in-flight promises never survive JSON), so normalise it:
      // blobs are then a pure function of the data, and unchanged sessions
      // compare equal below. Restore still sees a valid envelope.
      const stable = queries.map(q => ({...q, dehydratedAt: 0}))
      const comparable = JSON.stringify({buster, clientState: {mutations: [], queries: stable}})
      let unchanged = false
      const sessionKey = perSessionPersistKey(sessionId)
      try {
        const raw = storage.getItem(sessionKey)
        if (raw != null) {
          try {
            const sub = JSON.parse(raw) as Partial<PersistedClient>
            unchanged =
              JSON.stringify({buster: sub?.buster, clientState: sub?.clientState}) === comparable
          } catch {
            unchanged = false
          }
        }
      } catch {
        unchanged = false
      }
      // The stored envelope keeps its original save timestamp when the
      // data is unchanged; only a data change rewrites the blob (with the
      // fresh timestamp, which drives restore maxAge).
      if (!unchanged) {
        const blob = JSON.stringify({timestamp, buster, clientState: {mutations: [], queries: stable}})
        try {
          storage.setItem(sessionKey, blob)
        } catch {
          // One session's write failing must not lose the others.
        }
      }
    }
    const gone = (previous?.sessions ?? []).filter(sessionId => !groups.has(sessionId))
    for (const sessionId of gone) {
      try {
        storage.removeItem(perSessionPersistKey(sessionId))
      } catch {
        // Best effort.
      }
    }
    const manifest: PersistManifest = {buster, sessions: [...groups.keys()]}
    const manifestJson = JSON.stringify(manifest)
    try {
      // The manifest itself is stored here (not left to the caller), and
      // skipped when unchanged like the blobs.
      if (storage.getItem(key) !== manifestJson) storage.setItem(key, manifestJson)
    } catch {
      // Best effort: the blobs are already written; the next save retries.
    }
    return manifestJson
  } catch {
    const empty: PersistManifest = {buster, sessions: []}
    return JSON.stringify(empty)
  }
}

/**
 * Read the merged persisted client for restore: manifest plus every
 * per-session blob. Falls back to the legacy single-blob format (a full
 * `PersistedClient` JSON under the same key, written before the split):
 * it restores policy-filtered so a pre-split blob carrying DMs still
 * hydrates clean. Returns undefined when nothing restorable exists. Never
 * throws.
 */
export function restoreMergedClient(storage: KeyValueStore, key: string): string | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    const record = parsed as Partial<PersistManifest> & Partial<PersistedClient>
    if (record && Array.isArray((record as PersistManifest).sessions)) {
      const manifest = record as PersistManifest
      const queries: DehydratedQuery[] = []
      // Freshest blob save drives the merged timestamp (maxAge is checked
      // against it); a session that has not saved recently keeps its data
      // but does not extend the envelope's life.
      let timestamp = 0
      for (const sessionId of manifest.sessions) {
        try {
          const blob = storage.getItem(perSessionPersistKey(sessionId))
          if (!blob) continue
          const sub = JSON.parse(blob) as Partial<PersistedClient>
          if (typeof sub?.timestamp === 'number' && sub.timestamp > timestamp) {
            timestamp = sub.timestamp
          }
          const subQueries = sub?.clientState?.queries
          if (Array.isArray(subQueries)) queries.push(...subQueries)
        } catch {
          // A corrupt session blob drops; the others still restore.
        }
      }
      return JSON.stringify({
        timestamp: timestamp > 0 ? timestamp : Date.now(),
        buster: manifest.buster,
        clientState: {mutations: [], queries},
      })
    }
    // Legacy single blob: policy-filter before returning it.
    const legacy = parsed as Partial<PersistedClient>
    if (legacy && legacy.clientState && Array.isArray(legacy.clientState.queries)) {
      const filtered = filterPersistedState(legacy.clientState as DehydratedState)
      return JSON.stringify({
        timestamp: typeof legacy.timestamp === 'number' ? legacy.timestamp : Date.now(),
        buster: typeof legacy.buster === 'string' ? legacy.buster : '',
        clientState: filtered,
      })
    }
    return null
  } catch {
    return null
  }
}

/**
 * Remove the manifest and every per-session blob (used by the persister's
 * `removeClient`; per-session purge deletes a single session key). Never
 * throws.
 */
export function removePersistedClient(storage: KeyValueStore, key: string): void {
  try {
    const raw = storage.getItem(key)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<PersistManifest>
        if (parsed && Array.isArray(parsed.sessions)) {
          for (const sessionId of parsed.sessions) {
            try {
              storage.removeItem(perSessionPersistKey(sessionId))
            } catch {
              // Best effort.
            }
          }
        }
      } catch {
        // A legacy blob needs no session sweep.
      }
    }
  } catch {
    // Reading must not block removal.
  }
  try {
    storage.removeItem(key)
  } catch {
    // Best effort.
  }
}
