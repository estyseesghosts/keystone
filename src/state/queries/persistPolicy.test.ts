// Persisted query-cache policy tests (repair X1.4: privacy 1, storage
// S7/S8, sessions-cache 8, security L4).
//
// Every fix ships a test that fails before and passes after:
// - a DM conversation and a followers-only post never reach the blob;
// - one MMKV key per session (churn in B never rewrites A);
// - the persister `retry` hook shrinks instead of throwing;
// - the buster tracks the domain-model shape;
// - a lint-style test fails on any new unclassified query kind.

import * as fs from 'fs'
import * as path from 'path'

import {QueryClient, dehydrate} from '@tanstack/react-query'

import {
  adaptMastodonAccount,
  adaptNote,
  adaptStatus,
  adaptUserRelation,
  createMemoryStore,
  visibilityOf,
  adaptAccount as adaptMisskeyAccount,
  type KeyValueStore,
} from '@keystone/fedi'

import {
  PERSIST_MAX_BYTES,
  PERSIST_POLICY,
  dropLargestQuery,
  filterPersistedState,
  groupQueriesBySession,
  modelShapeHash,
  perSessionPersistKey,
  persistRetry,
  prepareDehydratedQuery,
  queryKindOfKey,
  removePersistedClient,
  restoreMergedClient,
  serializeSplitPersistedClient,
  sessionIdOfKey,
  shouldDehydrateQuery,
  shouldPersistQueryKey,
  shrinkToFit,
  stripPrivateData,
} from './persistPolicy'
import {MODEL_SHAPE_HASH, QUERY_BUSTER, SCHEMA_VERSION} from './stale'
import {QUERY_PERSIST_KEY} from './Provider'

const vis = (kind: string) => ({kind, localOnly: false, raw: kind})
const post = (id: string, kind = 'public') => ({id, visibility: vis(kind)})
const page = (items: unknown[]) => ({items, cursor: null, end: true})
const infinite = (items: unknown[]) => ({pages: [page(items)], pageParams: [null]})

function testClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

describe('queryKindOfKey / sessionIdOfKey', () => {
  it('reads the kind from session-scoped keys', () => {
    expect(queryKindOfKey(['sess-a', 'post-feed', 'timeline|home'])).toBe('post-feed')
    expect(queryKindOfKey(['sess-a', 'conversations'])).toBe('conversations')
    expect(queryKindOfKey(['sess-a', 'admin-insight', 'measures'])).toBe('admin-insight')
    expect(queryKindOfKey(['sess-a', 'recommendations', 'probe'])).toBe('recommendations')
  })

  it('reads the kind from signed-out fallbacks', () => {
    expect(queryKindOfKey(['me', 'signed-out'])).toBe('me')
    expect(queryKindOfKey(['moderation', 'signed-out'])).toBe('moderation')
    expect(queryKindOfKey(['recommendations', 'probe', 'signed-out'])).toBe('recommendations')
    expect(queryKindOfKey(['admin-insight', 'signed-out'])).toBe('admin-insight')
    expect(queryKindOfKey(['signed-out', 'post-feed', 'timeline|home'])).toBe('post-feed')
  })

  it('rejects malformed keys', () => {
    expect(queryKindOfKey([])).toBeNull()
    expect(queryKindOfKey(null)).toBeNull()
    expect(queryKindOfKey(['sess-a'])).toBeNull()
    expect(queryKindOfKey(['sess-a', 42])).toBeNull()
  })

  it('scopes sessions and drops signed-out shapes', () => {
    expect(sessionIdOfKey(['sess-a', 'post-feed', 'timeline|home'])).toBe('sess-a')
    expect(sessionIdOfKey(['me', 'signed-out'])).toBeNull()
    expect(sessionIdOfKey(['signed-out', 'post-feed', 'timeline|home'])).toBeNull()
    expect(sessionIdOfKey(['recommendations', 'probe', 'signed-out'])).toBeNull()
    expect(sessionIdOfKey([])).toBeNull()
  })
})

describe('shouldPersistQueryKey (default deny)', () => {
  it('persists public timelines, profiles, emoji, instance metadata and me', () => {
    expect(shouldPersistQueryKey(['s', 'post-feed', 'timeline|home'])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'post-feed', 'timeline|local'])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'post-feed', 'timeline|social'])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'post-feed', 'timeline|global'])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'account', 'u1'])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'full-account', 'u1'])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'mention-account', 'u', null])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'custom-emojis'])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'compose-limits'])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'report-rules'])).toBe(true)
    expect(shouldPersistQueryKey(['s', 'me'])).toBe(true)
  })

  it('never persists private or personalised feeds', () => {
    for (const descriptor of [
      'bookmarks',
      'mentions',
      'recommendations',
      'timeline|home|["en",null,null]',
      'user|u1|posts',
      'list|l1',
      'antenna|a1',
      'channel|c1',
      'clip|c1',
      'tag|x',
      'search|q',
      'explore|posts',
    ]) {
      expect(shouldPersistQueryKey(['s', 'post-feed', descriptor])).toBe(false)
    }
  })

  it('never persists DMs, chat, notifications, drafts, admin, search, moderation', () => {
    for (const kind of [
      'post',
      'post-thread',
      'thread-replies',
      'post-reposts',
      'post-reactions',
      'post-history',
      'notifications',
      'server-mutes',
      'server-blocks',
      'server-renote-mutes',
      'server-filters',
      'relationship',
      'list-membership',
      'conversations',
      'conversation',
      'chat-rooms',
      'chat-room',
      'chat-room-messages',
      'chat-user-messages',
      'scheduled-posts',
      'server-drafts',
      'recommendations',
      'moderation',
      'admin-insight',
      'admin-reports',
      'admin-report',
    ]) {
      expect(shouldPersistQueryKey(['s', kind, 'x'])).toBe(false)
    }
  })

  it('denies unknown kinds and signed-out scopes', () => {
    expect(shouldPersistQueryKey(['s', 'brand-new-kind'])).toBe(false)
    expect(shouldPersistQueryKey(['s', 'post-feed', 'timeline|home'])).toBe(true)
    expect(shouldPersistQueryKey(['signed-out', 'post-feed', 'timeline|home'])).toBe(false)
    expect(shouldPersistQueryKey(['me', 'signed-out'])).toBe(false)
  })

  it('gates dehydrate on success status plus the policy', () => {
    const ok = {queryKey: ['s', 'post-feed', 'timeline|home'], state: {status: 'success'}} as never
    const pending = {queryKey: ['s', 'post-feed', 'timeline|home'], state: {status: 'pending'}} as never
    const denied = {queryKey: ['s', 'conversations'], state: {status: 'success'}} as never
    expect(shouldDehydrateQuery(ok)).toBe(true)
    expect(shouldDehydrateQuery(pending)).toBe(false)
    expect(shouldDehydrateQuery(denied)).toBe(false)
  })
})

describe('private-row stripping', () => {
  it('drops direct and followers rows from feed pages, keeps the rest', () => {
    const data = infinite([post('pub'), post('fol', 'followers'), post('dm', 'direct'), post('quiet', 'quiet')])
    const stripped = stripPrivateData(data) as ReturnType<typeof infinite>
    expect(stripped.pages[0].items.map(p => (p as {id: string}).id)).toEqual(['pub', 'quiet'])
  })

  it('drops a lone private post and a thread with a private focus', () => {
    expect(stripPrivateData(post('dm', 'direct'))).toBeUndefined()
    expect(stripPrivateData(post('pub'))).toEqual(post('pub'))
    const thread = {post: post('p'), focused: post('f', 'followers'), ancestors: [post('a')]}
    expect(stripPrivateData(thread)).toBeUndefined()
    const open = {post: post('p'), focused: post('f'), ancestors: [post('a'), post('b', 'direct')]}
    const kept = stripPrivateData(open) as typeof open
    expect(kept.ancestors.map(a => a.id)).toEqual(['a'])
  })

  it('keeps unclassified shapes (never destroys what it cannot classify)', () => {
    expect(stripPrivateData({id: 'x'} as never)).toEqual({id: 'x'})
    expect(stripPrivateData('text')).toBe('text')
  })

  it('trims infinite queries to the first page and drops denied kinds', () => {
    const dq = {
      queryHash: 'h',
      queryKey: ['s', 'post-feed', 'timeline|home'],
      state: {data: {pages: [page([post('a')]), page([post('b')])], pageParams: [null, 'c']}},
      dehydratedAt: 0,
    } as never
    const kept = prepareDehydratedQuery(dq)
    const keptData = kept?.state.data as {pages: unknown[]; pageParams: unknown[]}
    expect(keptData.pages).toHaveLength(1)
    expect(keptData.pageParams).toHaveLength(1)
    const denied = {
      ...(dq as unknown as Record<string, unknown>),
      queryKey: ['s', 'conversations'],
    } as never
    expect(prepareDehydratedQuery(denied)).toBeNull()
    const filtered = filterPersistedState({mutations: [{x: 1}], queries: [dq, denied]} as never)
    expect(filtered.mutations).toEqual([])
    expect(filtered.queries).toHaveLength(1)
  })
})

describe('no DM conversation or private post in the persisted blob', () => {
  async function persistedStrings(): Promise<string[]> {
    const client = testClient()
    await client.fetchQuery({
      queryKey: ['sess-a', 'post-feed', 'timeline|home'],
      queryFn: async () => infinite([post('pub-1'), post('fol-1', 'followers'), post('dm-1', 'direct')]),
    })
    await client.fetchQuery({
      queryKey: ['sess-a', 'conversations'],
      queryFn: async () => infinite([{id: 'c1', lastMessage: 'dm-secret-text'}]),
    })
    await client.fetchQuery({
      queryKey: ['sess-a', 'notifications', 'all|grouped:0'],
      queryFn: async () => infinite([{id: 'n1'}]),
    })
    await client.fetchQuery({
      queryKey: ['sess-a', 'me'],
      queryFn: async () => ({id: 'me-1'}),
    })
    const store = createMemoryStore()
    serializeSplitPersistedClient(store, QUERY_PERSIST_KEY, {
      timestamp: Date.now(),
      buster: QUERY_BUSTER,
      clientState: dehydrate(client, {shouldDehydrateQuery}),
    })
    const manifest = store.getItem(QUERY_PERSIST_KEY) ?? ''
    const blob = store.getItem(perSessionPersistKey('sess-a')) ?? ''
    return [manifest, blob]
  }

  it('keeps the public post, drops the DM thread and the private rows', async () => {
    const [manifest, blob] = await persistedStrings()
    expect(blob).toContain('pub-1')
    expect(blob).not.toContain('fol-1')
    expect(blob).not.toContain('dm-1')
    expect(blob).not.toContain('dm-secret-text')
    expect(blob).not.toContain('conversations')
    expect(blob).not.toContain('n1')
    expect(blob).toContain('me-1')
    expect(JSON.parse(manifest).sessions).toEqual(['sess-a'])
  })
})

describe('per-session split', () => {
  async function twoSessionStore(): Promise<KeyValueStore> {
    const client = testClient()
    await client.fetchQuery({
      queryKey: ['sess-a', 'post-feed', 'timeline|home'],
      queryFn: async () => infinite([post('a1')]),
    })
    await client.fetchQuery({
      queryKey: ['sess-b', 'post-feed', 'timeline|home'],
      queryFn: async () => infinite([post('b1')]),
    })
    await client.fetchQuery({
      queryKey: ['sess-a', 'conversations'],
      queryFn: async () => infinite([{id: 'c1'}]),
    })
    const store = createMemoryStore()
    serializeSplitPersistedClient(store, QUERY_PERSIST_KEY, {
      timestamp: Date.now(),
      buster: QUERY_BUSTER,
      clientState: dehydrate(client, {shouldDehydrateQuery}),
    })
    return store
  }

  it('writes one key per session; blobs never cross', async () => {
    const store = await twoSessionStore()
    const manifest = JSON.parse(store.getItem(QUERY_PERSIST_KEY) ?? '{}')
    expect(manifest.sessions.sort()).toEqual(['sess-a', 'sess-b'])
    const blobA = store.getItem(perSessionPersistKey('sess-a')) ?? ''
    const blobB = store.getItem(perSessionPersistKey('sess-b')) ?? ''
    expect(blobA).toContain('a1')
    expect(blobA).not.toContain('b1')
    expect(blobB).toContain('b1')
    expect(blobB).not.toContain('a1')
  })

  it('groups by session and restores merged', async () => {
    const store = await twoSessionStore()
    const merged = restoreMergedClient(store, QUERY_PERSIST_KEY)
    expect(merged).not.toBeNull()
    const parsed = JSON.parse(merged ?? '{}')
    expect(parsed.buster).toBe(QUERY_BUSTER)
    const keys = parsed.clientState.queries.map((q: {queryKey: unknown[]}) => q.queryKey)
    expect(keys).toContainEqual(['sess-a', 'post-feed', 'timeline|home'])
    expect(keys).toContainEqual(['sess-b', 'post-feed', 'timeline|home'])
    expect(keys).not.toContainEqual(['sess-a', 'conversations'])
  })

  it('restores the legacy single-blob format policy-filtered', () => {
    const store = createMemoryStore()
    store.setItem(
      QUERY_PERSIST_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        buster: QUERY_BUSTER,
        clientState: {
          mutations: [],
          queries: [
            {
              queryHash: 'h1',
              queryKey: ['sess-a', 'post-feed', 'timeline|home'],
              state: {data: infinite([post('pub-1'), post('fol-1', 'followers')]), status: 'success'},
              dehydratedAt: 0,
            },
            {
              queryHash: 'h2',
              queryKey: ['sess-a', 'conversations'],
              state: {data: infinite([{id: 'c1', lastMessage: 'dm-secret-text'}]), status: 'success'},
              dehydratedAt: 0,
            },
          ],
        },
      }),
    )
    const merged = restoreMergedClient(store, QUERY_PERSIST_KEY) ?? ''
    expect(merged).toContain('pub-1')
    expect(merged).not.toContain('fol-1')
    expect(merged).not.toContain('dm-secret-text')
  })

  it('skips unchanged sessions so one account churn never rewrites the other blob', async () => {
    const inner = createMemoryStore()
    const writes: string[] = []
    const store: KeyValueStore = {
      getItem: key => inner.getItem(key),
      setItem: (key, value) => {
        writes.push(key)
        inner.setItem(key, value)
      },
      removeItem: key => inner.removeItem(key),
    }
    const client = testClient()
    await client.fetchQuery({
      queryKey: ['sess-a', 'post-feed', 'timeline|home'],
      queryFn: async () => infinite([post('a1')]),
    })
    await client.fetchQuery({
      queryKey: ['sess-b', 'post-feed', 'timeline|home'],
      queryFn: async () => infinite([post('b1')]),
    })
    const snapshot = () => ({
      timestamp: Date.now(),
      buster: QUERY_BUSTER,
      clientState: dehydrate(client, {shouldDehydrateQuery}),
    })
    serializeSplitPersistedClient(store, QUERY_PERSIST_KEY, snapshot())
    expect(writes).toContain(perSessionPersistKey('sess-a'))
    expect(writes).toContain(perSessionPersistKey('sess-b'))
    writes.length = 0
    serializeSplitPersistedClient(store, QUERY_PERSIST_KEY, snapshot())
    expect(writes).toEqual([])
    client.setQueryData(['sess-b', 'post-feed', 'timeline|home'], infinite([post('b2')]))
    serializeSplitPersistedClient(store, QUERY_PERSIST_KEY, snapshot())
    expect(writes).toEqual([perSessionPersistKey('sess-b')])
    expect(inner.getItem(perSessionPersistKey('sess-a'))).toContain('a1')
  })

  it('removeClient clears the manifest and every session blob', async () => {
    const store = await twoSessionStore()
    removePersistedClient(store, QUERY_PERSIST_KEY)
    expect(store.getItem(QUERY_PERSIST_KEY)).toBeNull()
    expect(store.getItem(perSessionPersistKey('sess-a'))).toBeNull()
    expect(store.getItem(perSessionPersistKey('sess-b'))).toBeNull()
  })

  it('groups queries by session and drops null-session keys', () => {
    const groups = groupQueriesBySession([
      {queryHash: 'a', queryKey: ['s-a', 'me'], state: {}, dehydratedAt: 0},
      {queryHash: 'b', queryKey: ['me', 'signed-out'], state: {}, dehydratedAt: 0},
    ] as never)
    expect([...groups.keys()]).toEqual(['s-a'])
  })
})

describe('size bound and retry (S7)', () => {
  const dq = (key: string[], size: number) =>
    ({
      queryHash: JSON.stringify(key),
      queryKey: key,
      state: {data: 'x'.repeat(size), status: 'success'},
      dehydratedAt: 0,
    }) as never

  it('drops the largest query first and never throws', () => {
    const big = dq(['s', 'post-feed', 'timeline|home'], 400)
    const small = dq(['s', 'me'], 100)
    const dropped = dropLargestQuery({timestamp: 0, buster: 'b', clientState: {mutations: [], queries: [small, big]}})
    expect(dropped?.clientState.queries).toHaveLength(1)
    expect(dropped?.clientState.queries[0].queryKey).toEqual(['s', 'me'])
    expect(dropLargestQuery({timestamp: 0, buster: 'b', clientState: {mutations: [], queries: []}})).toBeNull()
  })

  it('caps the serialised blob, largest first', () => {
    const client = {
      timestamp: Date.now(),
      buster: QUERY_BUSTER,
      clientState: {
        mutations: [],
        queries: [dq(['s', 'post-feed', 'timeline|home'], 400), dq(['s', 'me'], 100)],
      },
    } as never
    const fitted = shrinkToFit(client, 500)
    const json = JSON.stringify(fitted)
    expect(json.length).toBeLessThanOrEqual(PERSIST_MAX_BYTES)
    expect(json.length).toBeLessThanOrEqual(500)
    expect(fitted.clientState.queries.map((q: {queryKey: unknown}) => q.queryKey)).toEqual([['s', 'me']])
  })

  it('the retry hook shrinks and gives up cleanly', () => {
    const client = {
      timestamp: 0,
      buster: 'b',
      clientState: {mutations: [], queries: [dq(['s', 'me'], 10)]},
    } as never
    const smaller = persistRetry({persistedClient: client, error: new Error('quota'), errorCount: 1})
    expect(smaller?.clientState.queries).toEqual([])
    expect(persistRetry({persistedClient: client, error: new Error('quota'), errorCount: 99})).toBeUndefined()
    expect(
      persistRetry({
        persistedClient: {timestamp: 0, buster: 'b', clientState: {mutations: [], queries: []}} as never,
        error: new Error('quota'),
        errorCount: 1,
      }),
    ).toBeUndefined()
  })
})

describe('buster tracks the domain-model shape (S8)', () => {
  it('derives QUERY_BUSTER from SCHEMA_VERSION', () => {
    expect(QUERY_BUSTER).toBe(`keystone-queries-v${SCHEMA_VERSION}`)
  })

  it('fails when an adapter output gains or loses a key without a bump', () => {
    const misskeyUser = {
      id: 'u1',
      name: null,
      username: 'u',
      host: null,
      avatarUrl: null,
      avatarBlurhash: null,
      isBot: false,
      isCat: false,
      emojis: {},
      onlineStatus: 'online',
    }
    const misskeyNote = {
      id: 'n1',
      createdAt: '2026-01-01T00:00:00.000Z',
      userId: 'u1',
      user: misskeyUser,
      text: 'hi',
      cw: null,
      visibility: 'public',
      localOnly: false,
      reactionAcceptance: null,
      renoteCount: 0,
      repliesCount: 0,
      reactionCount: 0,
      reactions: {},
      reactionEmojis: {},
      fileIds: [],
      files: [],
      replyId: null,
      renoteId: null,
      reply: null,
      renote: null,
      uri: null,
      url: null,
      emojis: {},
      mentions: [],
      tags: [],
      poll: null,
    }
    const mastodonAccount = {id: 'u1', username: 'u', acct: 'u'}
    const mastodonStatus = {
      id: 's1',
      created_at: '2026-01-01T00:00:00.000Z',
      visibility: 'public',
      account: mastodonAccount,
      content: '<p>hi</p>',
      uri: 'https://example/s1',
    }
    const shapes: Array<readonly [string, readonly string[]]> = [
      ['misskey-post', Object.keys(adaptNote(misskeyNote as never))],
      ['mastodon-post', Object.keys(adaptStatus(mastodonStatus as never))],
      ['misskey-account', Object.keys(adaptMisskeyAccount(misskeyUser as never))],
      ['mastodon-account', Object.keys(adaptMastodonAccount(mastodonAccount as never))],
      ['relationship', Object.keys(adaptUserRelation({id: 'r1'} as never))],
      ['visibility', Object.keys(visibilityOf('public', false))],
    ]
    // A shape change without a bump fails here. To fix: widen/narrow the
    // adapters, then bump SCHEMA_VERSION in `stale.ts` AND refresh
    // MODEL_SHAPE_HASH to the hash printed by this failure.
    expect(modelShapeHash(shapes)).toBe(MODEL_SHAPE_HASH)
  })
})

describe('every query kind has an explicit policy entry (lint-style)', () => {
  function sourceKinds(): string[] {
    const dir = __dirname
    const files = fs
      .readdirSync(dir)
      .filter(f => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.') && f !== 'persistPolicy.ts')
    const kinds = new Set<string>()
    for (const file of files) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8')
      for (const m of src.matchAll(/createQueryKey\(\s*[^,()]+,\s*['"]([^'"]+)['"]/g)) {
        kinds.add(m[1])
      }
      for (const m of src.matchAll(/(?:queryKey\s*[:=]\s*|invalidateQueries\(\s*\{\s*queryKey\s*:\s*)(\[[^\]]*\])/g)) {
        const literals = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1])
        if (literals.length === 0) continue
        kinds.add(literals[0])
      }
      // Signed-out fallbacks in conditionals (`sessionId ? key(sessionId) :
      // ['moderation', 'signed-out']`) — the kind rides first.
      for (const m of src.matchAll(/\[\s*['"]([A-Za-z0-9_-]+)['"]\s*,(?:\s*['"][A-Za-z0-9_-]+['"]\s*,)?\s*['"]signed-out['"]\s*\]/g)) {
        kinds.add(m[1])
      }
    }
    return [...kinds].sort()
  }

  it('fails on a new unclassified kind (default deny needs the explicit entry)', () => {
    const kinds = sourceKinds()
    expect(kinds.length).toBeGreaterThan(0)
    const missing = kinds.filter(kind => !(kind in PERSIST_POLICY))
    expect(missing).toEqual([])
  })
})
