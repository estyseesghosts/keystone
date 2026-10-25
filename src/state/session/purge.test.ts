// Session purge tests (repair X1.2: privacy 2/7, storage S3/S5/S6,
// networking H3, sessions-cache 1/6/7).
//
// Every fix ships a test that fails before the fix and passes after:
// - MMKV + QueryClient enumeration after `remove` (nothing for the id
//   remains; other sessions are untouched).
// - `signOutEverywhere` revokes in parallel via `allSettled` and never
//   drops a session added while revokes are in flight (S6).
// - `hydrate` never resurrects a removed session, never clobbers a
//   refreshed token, never reorders, and is safe to run twice (S5).
// - D3: removing the active session activates the most recently used
//   remaining one; the last removal signs out.
// - Re-adding an account inside the old cache lifetime shows cold data.
// - Stream stops run (and cannot break the purge).

import {QueryClient} from '@tanstack/react-query'

import {
  readSoftMutes,
  removeSession,
  saveSession,
  writeSoftMute,
  type KeyValueStore,
  type Session,
} from '@keystone/fedi'

import {createEmojiRecentsStore} from '#/components/EmojiPicker/recents'
import {postShadowStore} from '#/state/cache/post-shadow'
import {createFavouritesStore, createLikeEmojiStore} from '#/state/emojiPrefs'
import {feedQueryKey, meQueryKey} from '#/state/queries/keys'
import {perSessionPersistKey, QUERY_PERSIST_KEY} from '#/state/queries/persistPolicy'
import {readAccountState, readDeviceState, writeAccountState, type TokenVault} from '#/storage'
import {getOpenDraftId, listDrafts, saveDraft, setOpenDraftId, type LocalDraft} from '#/storage/drafts'

import {
  createQueryPurger,
  favouritesKeyFor,
  homeTabKeyFor,
  likeEmojiKeyFor,
  purgeSessionMemory,
  purgeSessionStorage,
  registerSessionPurger,
  registerSessionStreamStop,
  sessionScopedKeys,
  stopSessionStreams,
} from './purge'
import {createSessionStore, type NewSessionInput} from './store'

const HOME_ORIGIN = 'https://app.example'
const ORIGIN_A = 'https://a.example'
const ORIGIN_B = 'https://b.example'
const ORIGIN_C = 'https://c.example'

const sessionA = (over: Partial<NewSessionInput> = {}): NewSessionInput => ({
  origin: ORIGIN_A,
  family: 'misskey',
  flavor: 'misskey',
  accountId: 'alice',
  token: 'token-a',
  grant: 'password',
  hosting: 'third-party',
  ...over,
})

const sessionB = (over: Partial<NewSessionInput> = {}): NewSessionInput => ({
  origin: ORIGIN_B,
  family: 'misskey',
  flavor: 'sharkey',
  accountId: 'bob',
  token: 'token-b',
  grant: 'miauth',
  hosting: 'third-party',
  ...over,
})

const sessionC = (over: Partial<NewSessionInput> = {}): NewSessionInput => ({
  origin: ORIGIN_C,
  family: 'misskey',
  flavor: 'misskey',
  accountId: 'cara',
  token: 'token-c',
  grant: 'password',
  hosting: 'third-party',
  ...over,
})

const draft = (over: Partial<LocalDraft> = {}): LocalDraft => ({
  id: 'd1',
  updatedAt: Date.now(),
  text: 'hello',
  cw: '',
  cwEnabled: false,
  visibilityRaw: 'public',
  visibleUserIds: [],
  localOnly: false,
  replyToId: null,
  quoteId: null,
  pollChoices: null,
  pollMultiple: false,
  pollHideTotals: false,
  pollDurationSeconds: 86400,
  reactionAcceptance: null,
  noQuote: false,
  scheduledAt: null,
  sensitive: false,
  language: null,
  hadMedia: false,
  ...over,
})

/** Plain (web-grade) vault stub. */
function memVault(): TokenVault {
  const map = new Map<string, string>()
  const key = (id: string, origin: string) => `${origin} ${id}`
  return {
    getToken: (id, origin) => Promise.resolve(map.get(key(id, origin)) ?? null),
    setToken: (id, origin, token) => {
      map.set(key(id, origin), token)
      return Promise.resolve()
    },
    removeToken: (id, origin) => {
      map.delete(key(id, origin))
      return Promise.resolve()
    },
  }
}

function stubRevoke(gate?: () => Promise<void>) {
  const calls: Array<{url: string; init: RequestInit}> = []
  const fetchImpl = jest.fn((_url: string, _init?: RequestInit) => {
    const run = async () => {
      if (gate) await gate()
      calls.push({url: _url, init: _init ?? {}})
      return new Response('{}', {status: 200})
    }
    return run()
  }) as unknown as typeof fetch
  return {calls, fetchImpl}
}

/** Live-key tracking wrapper: the seam has no enumeration, so tests track
 * it (the app's MMKV equivalent is read back the same way). */
function trackingStore(): {store: KeyValueStore; keys: () => string[]} {
  const live = new Map<string, string>()
  return {
    store: {
      getItem: key => live.get(key) ?? null,
      setItem: (key, value) => {
        live.set(key, value)
        return true
      },
      removeItem: key => {
        live.delete(key)
      },
    },
    keys: () => [...live.keys()],
  }
}

/** Populate every per-session surface for `id` (through the real owner
 * APIs, never raw key literals — except the home-tab key, whose only
 * writer is the screen). */
function populateSessionData(store: KeyValueStore, id: string): void {
  saveDraft(store, id, draft({text: `draft of ${id}`}))
  setOpenDraftId(store, id, 'd1')
  writeAccountState(store, id, {version: 2, prefs: {}})
  writeSoftMute(store, id, 'muted-acct', true)
  createEmojiRecentsStore(() => store).touch(id, {kind: 'unicode', key: '🍮'})
  createLikeEmojiStore(() => store).set(id, '🍮')
  createFavouritesStore(() => store).toggle(id, '🍮')
  store.setItem(`keystone.homeTab:${id}`, 'recommendations')
  store.setItem(
    perSessionPersistKey(id),
    JSON.stringify({timestamp: 1, buster: 'x', clientState: {mutations: [], queries: []}}),
  )
  postShadowStore.patch(id, 'p1', {favourited: true})
}

afterEach(() => {
  postShadowStore.reset()
})

describe('sessionScopedKeys (the whole per-session surface in one list)', () => {
  const S = `${ORIGIN_A} alice`

  it('covers every builder and pins the mirrored formats', () => {
    expect(sessionScopedKeys(S)).toEqual([
      `keystone.drafts.${S}`,
      `keystone.draftopen.${S}`,
      `keystone.account.${S}`,
      `keystone.softmute.${S}`,
      `keystone.emojirecents.${S}`,
      `keystone.emojifavs.${S}`,
      `keystone.likeemoji.${S}`,
      `keystone.homeTab:${S}`,
      `${QUERY_PERSIST_KEY}.${S}`,
    ])
    // The mirrors pin the owner formats (behavioural tests below prove the
    // purge actually removes what the owners write).
    expect(favouritesKeyFor(S)).toBe(`keystone.emojifavs.${S}`)
    expect(likeEmojiKeyFor(S)).toBe(`keystone.likeemoji.${S}`)
    expect(homeTabKeyFor(S)).toBe(`keystone.homeTab:${S}`)
  })
})

describe('remove() purges everything for the id (privacy 2, storage S3, networking H3)', () => {
  it('enumerates MMKV + QueryClient after remove and finds nothing for the id', async () => {
    const {store: storage, keys} = trackingStore()
    const {calls, fetchImpl} = stubRevoke()
    const store = createSessionStore({storage, vault: memVault(), homeOrigin: HOME_ORIGIN, revokeFetch: fetchImpl})
    const client = new QueryClient()
    const unregister = registerSessionPurger(createQueryPurger(client))
    try {
      const a = await store.add(sessionA())
      const b = await store.add(sessionB())

      populateSessionData(storage, a.id)
      saveDraft(storage, b.id, draft({text: 'bob draft'}))
      client.setQueryData(feedQueryKey(a.id, 'timeline|home'), {
        pages: [{items: [{id: 'p1'}]}],
        pageParams: [undefined],
      })
      client.setQueryData(meQueryKey(a.id), {id: 'alice'})
      client.setQueryData(feedQueryKey(b.id, 'timeline|home'), {
        pages: [{items: [{id: 'p9'}]}],
        pageParams: [undefined],
      })
      storage.setItem(QUERY_PERSIST_KEY, JSON.stringify({buster: 'x', sessions: [a.id, b.id]}))
      createLikeEmojiStore(() => storage).set('anon', '🍩')

      const cancelSpy = jest.spyOn(client, 'cancelQueries')

      await store.remove(a.id)

      // Revoked once, at A's origin only.
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe(`${ORIGIN_A}/api/i/revoke-token`)
      // In-flight queries for A are cancelled before the delete.
      expect(cancelSpy).toHaveBeenCalledTimes(1)

      // No MMKV key mentions A anymore.
      expect(keys().filter(k => k.includes(a.id))).toEqual([])
      // The owners agree the data is gone.
      expect(listDrafts(storage, a.id)).toEqual([])
      expect(getOpenDraftId(storage, a.id)).toBeNull()
      expect(readAccountState(storage, a.id)).toEqual({version: 2, prefs: {}})
      expect(readSoftMutes(storage, a.id)).toEqual([])
      expect(createEmojiRecentsStore(() => storage).list(a.id)).toEqual([])
      // No QueryClient entry is keyed by A anymore.
      expect(client.getQueryData(feedQueryKey(a.id, 'timeline|home'))).toBeUndefined()
      expect(client.getQueryData(meQueryKey(a.id))).toBeUndefined()
      // Shadow + stream stops are cleared (clearSession's first caller).
      expect(postShadowStore.get(a.id, 'p1')).toBeUndefined()
      // The persisted blob is deleted and the manifest no longer lists A.
      expect(storage.getItem(perSessionPersistKey(a.id))).toBeNull()
      expect(JSON.parse(storage.getItem(QUERY_PERSIST_KEY) as string)).toEqual({
        buster: 'x',
        sessions: [b.id],
      })

      // B is fully intact; the device-global anon bucket is not purged.
      expect(listDrafts(storage, b.id)).toHaveLength(1)
      expect(client.getQueryData(feedQueryKey(b.id, 'timeline|home'))).toEqual({
        pages: [{items: [{id: 'p9'}]}],
        pageParams: [undefined],
      })
      expect(storage.getItem(`keystone.likeemoji.anon`)).toBe('🍩')
      expect(store.list().map(s => s.id)).toEqual([b.id])
    } finally {
      unregister()
    }
  })

  it('purgeSessionStorage alone deletes the storage surface', () => {
    const {store: storage, keys} = trackingStore()
    const S = `${ORIGIN_A} alice`
    populateSessionData(storage, S)
    storage.setItem(QUERY_PERSIST_KEY, JSON.stringify({buster: 'x', sessions: [S]}))
    expect(keys().filter(k => k.includes(S)).length).toBeGreaterThan(0)
    purgeSessionStorage(storage, S)
    expect(keys().filter(k => k.includes(S))).toEqual([])
    // Idempotent and null-safe.
    expect(() => purgeSessionStorage(storage, S)).not.toThrow()
    expect(() => purgeSessionStorage(storage, '')).not.toThrow()
  })

  it('purgeSessionStorage also removes a legacy `.open` pointer (repair X1.3 S11)', () => {
    const {store: storage, keys} = trackingStore()
    const S = `${ORIGIN_A} alice`
    storage.setItem(`keystone.drafts.${S}.open`, 'legacy')
    storage.setItem(`keystone.draftbak.${S}`, 'forensics')
    purgeSessionStorage(storage, S)
    expect(keys().filter(k => k.includes(S))).toEqual([])
  })
})

describe('stream stops (X3.4 owns the mounts; this is the stop seam)', () => {
  it('runs and forgets every registered stop; failures and unknowns are swallowed', () => {
    const seen: string[] = []
    registerSessionStreamStop('s1', () => {
      seen.push('one')
    })
    registerSessionStreamStop('s1', () => {
      throw new Error('boom')
    })
    registerSessionStreamStop('s2', () => {
      seen.push('two')
    })
    stopSessionStreams('s1')
    expect(seen).toEqual(['one'])
    stopSessionStreams('s1')
    expect(seen).toEqual(['one'])
    expect(() => stopSessionStreams('')).not.toThrow()
    expect(() => stopSessionStreams('unknown')).not.toThrow()
  })

  it('purgeSessionMemory clears the shadow and stops the streams', () => {
    const seen: string[] = []
    registerSessionStreamStop('s1', () => {
      seen.push('stopped')
    })
    postShadowStore.patch('s1', 'p1', {renoted: true})
    purgeSessionMemory('s1')
    expect(postShadowStore.get('s1', 'p1')).toBeUndefined()
    expect(seen).toEqual(['stopped'])
  })
})

describe('D3: removing the active session activates the most recently used remaining one', () => {
  function setup() {
    const {store: storage, keys} = trackingStore()
    const {calls, fetchImpl} = stubRevoke()
    const store = createSessionStore({storage, vault: memVault(), homeOrigin: HOME_ORIGIN, revokeFetch: fetchImpl})
    return {storage, keys, calls, store}
  }

  it('activates MRU, not the list head; the last removal signs out', async () => {
    const {store, storage} = setup()
    const a = await store.add(sessionA())
    const b = await store.add(sessionB())
    const c = await store.add(sessionC())
    expect(store.activeId()).toBe(c.id)
    store.switch(b.id)
    store.switch(a.id)
    expect(store.activeId()).toBe(a.id)

    // MRU order is A(used last) > B > C; removing A must land on B even
    // though C is the envelope head.
    await store.remove(a.id)
    expect(store.list().map(s => s.id)).toEqual([c.id, b.id])
    expect(store.activeId()).toBe(b.id)
    expect(readDeviceState(storage).activeSessionId).toBe(b.id)

    // Removing a non-active session keeps the active one.
    await store.remove(c.id)
    expect(store.activeId()).toBe(b.id)

    // The last removal signs out (pointer + mirror cleared).
    await store.remove(b.id)
    expect(store.list()).toEqual([])
    expect(store.activeId()).toBeNull()
    expect(readDeviceState(storage).activeSessionId).toBeNull()
  })

  it('401-drop of the active session falls through to the next account', async () => {
    const {store, storage} = setup()
    await store.add(sessionA())
    const b = await store.add(sessionB())
    expect(store.activeId()).toBe(b.id)
    const realFetch = globalThis.fetch
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({error: {message: 'unauthorized', code: 'AUTHENTICATION_FAILED'}}), {
          status: 401,
        }),
      ),
    ) as unknown as typeof fetch
    try {
      await expect(store.verifyActive()).resolves.toEqual({ok: false, reason: 'unauthorized', cleared: true})
    } finally {
      globalThis.fetch = realFetch
    }
    expect(store.list().map(s => s.id)).toEqual([`${ORIGIN_A} alice`])
    expect(store.activeId()).toBe(`${ORIGIN_A} alice`)
  })
})

describe('signOutEverywhere (S6: parallel revokes, added sessions survive)', () => {
  it('revokes in parallel and keeps a session added while revokes are in flight', async () => {
    const {store: storage} = trackingStore()
    let releaseRevokes!: () => void
    const gate = new Promise<void>(res => {
      releaseRevokes = res
    })
    let entered = 0
    const {calls, fetchImpl} = stubRevoke(async () => {
      entered += 1
      await gate
    })
    const store = createSessionStore({storage, vault: memVault(), homeOrigin: HOME_ORIGIN, revokeFetch: fetchImpl})
    const client = new QueryClient()
    const unregister = registerSessionPurger(createQueryPurger(client))
    try {
      const a = await store.add(sessionA())
      const b = await store.add(sessionB())
      client.setQueryData(feedQueryKey(a.id, 'timeline|home'), {pages: [], pageParams: []})

      const signingOut = store.signOutEverywhere()
      // Let both revokes start (parallel — one tick, not 2 x timeout).
      await new Promise(r => setTimeout(r, 0))
      expect(entered).toBe(2)
      const added = store.add(sessionC())
      releaseRevokes()
      const c = await added
      await signingOut

      expect(calls.map(call => call.url).sort()).toEqual(
        [`${ORIGIN_A}/api/i/revoke-token`, `${ORIGIN_B}/api/i/revoke-token`].sort(),
      )
      // C was never in the snapshot: it survives and stays active (S6).
      expect(store.list().map(s => s.id)).toEqual([c.id])
      expect(store.activeId()).toBe(c.id)
      expect(readDeviceState(storage).activeSessionId).toBe(c.id)
      // The removed sessions' query state is gone; the cache is cleared.
      expect(client.getQueryData(feedQueryKey(a.id, 'timeline|home'))).toBeUndefined()
      expect(client.getQueryCache().getAll()).toEqual([])
      expect(storage.getItem(QUERY_PERSIST_KEY)).toBeNull()
    } finally {
      unregister()
    }
  })

  it('with no surviving sessions the store is empty and signed out', async () => {
    const {store: storage} = trackingStore()
    const {calls, fetchImpl} = stubRevoke()
    const store = createSessionStore({storage, vault: memVault(), homeOrigin: HOME_ORIGIN, revokeFetch: fetchImpl})
    await store.add(sessionA())
    await store.add(sessionB())
    await store.signOutEverywhere()
    expect(calls).toHaveLength(2)
    expect(store.list()).toEqual([])
    expect(store.activeId()).toBeNull()
    expect(readDeviceState(storage).activeSessionId).toBeNull()
  })
})

describe('hydrate races (S5)', () => {
  function legacySession(input: NewSessionInput, token: string): Session {
    return {
      id: `${input.origin} ${input.accountId}`,
      origin: input.origin,
      family: input.family,
      flavor: input.flavor,
      accountId: input.accountId,
      token,
      grant: input.grant,
      hosting: input.hosting,
    }
  }

  it('never resurrects a session removed while the vault read was in flight', async () => {
    const {store: storage} = trackingStore()
    saveSession(storage, legacySession(sessionA(), 'token-a'), HOME_ORIGIN)
    saveSession(storage, legacySession(sessionB(), 'token-b'), HOME_ORIGIN)
    let release!: (v: string | null) => void
    const gate = new Promise<string | null>(res => {
      release = res
    })
    let getTokenCalls = 0
    const vault: TokenVault = {
      getToken: async () => {
        getTokenCalls += 1
        return gate
      },
      setToken: jest.fn(async () => {}),
      removeToken: jest.fn(async () => {}),
    }
    const store = createSessionStore({storage, vault, homeOrigin: HOME_ORIGIN})
    const hydrating = store.hydrate()
    while (getTokenCalls === 0) {
      await new Promise(r => setTimeout(r, 0))
    }
    // A concurrent erase lands before the vault answers.
    removeSession(storage, `${ORIGIN_A} alice`, HOME_ORIGIN)
    release('vault-fresh')
    await hydrating
    expect(store.list().map(s => s.id)).toEqual([`${ORIGIN_B} bob`])
  })

  it('never clobbers an envelope token refreshed while the vault read was in flight', async () => {
    const {store: storage} = trackingStore()
    saveSession(storage, legacySession(sessionA(), 'token-a'), HOME_ORIGIN)
    let release!: (v: string | null) => void
    const gate = new Promise<string | null>(res => {
      release = res
    })
    let getTokenCalls = 0
    const vault: TokenVault = {
      getToken: async () => {
        getTokenCalls += 1
        return gate
      },
      setToken: jest.fn(async () => {}),
      removeToken: jest.fn(async () => {}),
    }
    const store = createSessionStore({storage, vault, homeOrigin: HOME_ORIGIN})
    const hydrating = store.hydrate()
    while (getTokenCalls === 0) {
      await new Promise(r => setTimeout(r, 0))
    }
    // A re-sign-in refreshes the envelope while hydrate is awaiting.
    saveSession(storage, legacySession(sessionA(), 'token-b'), HOME_ORIGIN)
    release('vault-fresh')
    await hydrating
    const remaining = store.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].token).toBe('token-b')
  })

  it('stale vault values do not reorder the list or break the second hydrate', async () => {
    const {store: storage} = trackingStore()
    const {vault} = (() => {
      const map = new Map<string, string>()
      return {
        vault: {
          getToken: (id: string, origin: string) => Promise.resolve(map.get(`${origin} ${id}`) ?? null),
          setToken: (id: string, origin: string, token: string) => {
            map.set(`${origin} ${id}`, token)
            return Promise.resolve(true)
          },
          removeToken: (id: string, origin: string) => {
            map.delete(`${origin} ${id}`)
            return Promise.resolve(true)
          },
          secure: true as const,
          getAppSecret: () => Promise.resolve(null),
          setAppSecret: () => Promise.resolve(true),
          removeAppSecret: () => Promise.resolve(true),
        },
      }
    })()
    const store = createSessionStore({storage, vault, homeOrigin: HOME_ORIGIN})
    // Envelope order is [C, B, A] (saveSession prepends).
    saveSession(storage, legacySession(sessionA(), 'token-a'), HOME_ORIGIN)
    saveSession(storage, legacySession(sessionB(), 'token-b'), HOME_ORIGIN)
    saveSession(storage, legacySession(sessionC(), 'token-c'), HOME_ORIGIN)
    expect(store.list().map(s => s.id)).toEqual([
      `${ORIGIN_C} cara`,
      `${ORIGIN_B} bob`,
      `${ORIGIN_A} alice`,
    ])
    // Two concurrent hydrates (provider double-mount) are single-flight.
    await Promise.all([store.hydrate(), store.hydrate()])
    // Migrated, scrubbed, and NOT reordered.
    expect(store.list().map(s => s.id)).toEqual([
      `${ORIGIN_C} cara`,
      `${ORIGIN_B} bob`,
      `${ORIGIN_A} alice`,
    ])
    for (const s of store.list()) expect(s.token).toMatch(/^token-/)
    const raw = storage.getItem('keystone_sessions') as string
    expect(raw).not.toContain('token-a')
    expect(raw).not.toContain('token-b')
    expect(raw).not.toContain('token-c')
  })
})

describe('cold re-add (sessions-cache 1: no cached feed after remove + add)', () => {
  it('re-adding the same account inside the old cache lifetime shows cold data', async () => {
    const {store: storage, keys} = trackingStore()
    const {fetchImpl} = stubRevoke()
    const store = createSessionStore({storage, vault: memVault(), homeOrigin: HOME_ORIGIN, revokeFetch: fetchImpl})
    const client = new QueryClient()
    const unregister = registerSessionPurger(createQueryPurger(client))
    try {
      const a = await store.add(sessionA())
      client.setQueryData(feedQueryKey(a.id, 'timeline|home'), {
        pages: [{items: [{id: 'p1'}]}],
        pageParams: [undefined],
      })
      storage.setItem(
        perSessionPersistKey(a.id),
        JSON.stringify({timestamp: 1, buster: 'x', clientState: {mutations: [], queries: []}}),
      )
      await store.remove(a.id)
      expect(client.getQueryData(feedQueryKey(a.id, 'timeline|home'))).toBeUndefined()
      expect(keys().filter(k => k.includes(a.id))).toEqual([])

      const again = await store.add(sessionA())
      expect(again.id).toBe(a.id)
      expect(client.getQueryData(feedQueryKey(a.id, 'timeline|home'))).toBeUndefined()
      expect(storage.getItem(perSessionPersistKey(a.id))).toBeNull()
    } finally {
      unregister()
    }
  })
})

describe('createQueryPurger', () => {
  it('cancels then removes only the session keys', async () => {
    const client = new QueryClient()
    const purger = createQueryPurger(client)
    const A = `${ORIGIN_A} alice`
    const B = `${ORIGIN_B} bob`
    client.setQueryData(feedQueryKey(A, 'timeline|home'), {pages: [], pageParams: []})
    client.setQueryData(feedQueryKey(B, 'timeline|home'), {pages: [], pageParams: []})
    const cancelSpy = jest.spyOn(client, 'cancelQueries')
    const removeSpy = jest.spyOn(client, 'removeQueries')
    await purger.removeSessionQueries(A)
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(1)
    // Cancel ran before remove (a late response cannot repopulate).
    expect(cancelSpy.mock.invocationCallOrder[0]).toBeLessThan(removeSpy.mock.invocationCallOrder[0])
    expect(client.getQueryData(feedQueryKey(A, 'timeline|home'))).toBeUndefined()
    expect(client.getQueryData(feedQueryKey(B, 'timeline|home'))).toBeDefined()
    await purger.clearAllQueries()
    expect(client.getQueryCache().getAll()).toEqual([])
  })
})
