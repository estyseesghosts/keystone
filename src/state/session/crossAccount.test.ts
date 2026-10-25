// Cross-account isolation (repair X11.2 step 3; AGENTS.md §6).
//
// Switching accounts never shows the previous account's data. This suite
// exercises the final tree — feed, notifications, drafts, post shadow,
// streams — across two sessions: after switching, every read for the new
// active account returns only its own rows; after removing the old
// account, nothing keyed by it remains anywhere while the surviving
// account is fully intact.
//
// The last describe is the ratchet the slice requires: every entry of
// `sessionScopedKeys(id)` is written as a sentinel and must be gone after
// `purgeSessionStorage` — if any listed key is missing from the purge
// list, the test fails.

import {QueryClient} from '@tanstack/react-query'

import {createMemoryStore, type KeyValueStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'

import {makeFetchSpy, makeNotification, makePost, makeSession} from '#/__tests__/factories'
import {postShadowStore} from '#/state/cache/post-shadow'
import {feedQueryKey, meQueryKey, notificationsQueryKey} from '#/state/queries/keys'
import {getOpenDraftId, listDrafts, saveDraft, setOpenDraftId, type LocalDraft} from '#/storage/drafts'

import {
  createQueryPurger,
  purgeSessionMemory,
  purgeSessionStorage,
  registerSessionPurger,
  registerSessionStreamStop,
  sessionScopedKeys,
  stopSessionStreams,
} from './purge'
import {createSessionStore, type NewSessionInput} from './store'

const HOME_ORIGIN = 'https://app.example'

const inputA = (): NewSessionInput => ({
  origin: 'https://a.example',
  family: 'misskey',
  flavor: 'misskey',
  accountId: 'alice',
  token: 'token-a',
  grant: 'password',
  hosting: 'third-party',
})

const inputB = (): NewSessionInput => ({
  origin: 'https://b.example',
  family: 'mastodon',
  flavor: 'mastodon',
  accountId: 'bob',
  token: 'token-b',
  grant: 'oauth-pkce',
  hosting: 'third-party',
})

const draft = (text: string): LocalDraft => ({
  id: `d-${text}`,
  updatedAt: Date.now(),
  text,
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
})

function memVault(): TokenVault {
  const map = new Map<string, string>()
  return {
    getToken: (id: string, origin: string) => Promise.resolve(map.get(`${origin} ${id}`) ?? null),
    setToken: (id: string, origin: string, token: string) => {
      map.set(`${origin} ${id}`, token)
      return Promise.resolve()
    },
    removeToken: (id: string, origin: string) => {
      map.delete(`${origin} ${id}`)
      return Promise.resolve()
    },
  }
}

function setup() {
  const storage: KeyValueStore = createMemoryStore()
  const {fetchImpl} = makeFetchSpy()
  const store = createSessionStore({storage, vault: memVault(), homeOrigin: HOME_ORIGIN, revokeFetch: fetchImpl})
  const client = new QueryClient()
  const unregister = registerSessionPurger(createQueryPurger(client))
  return {storage, store, client, unregister}
}

const feedPage = (ids: string[]) => ({
  pages: [{items: ids.map(id => makePost({id}))}],
  pageParams: [undefined],
})

const notifPage = (ids: string[]) => ({
  pages: [{items: ids.map(id => makeNotification({id}))}],
  pageParams: [undefined],
})

afterEach(() => {
  postShadowStore.reset()
})

describe('switching accounts never shows the previous account data', () => {
  it('feed + notifications + me reads follow the active session', async () => {
    const {store, client, unregister} = setup()
    try {
      const a = await store.add(inputA())
      const b = await store.add(inputB())
      client.setQueryData(feedQueryKey(a.id, 'timeline|home'), feedPage(['a-post']))
      client.setQueryData(feedQueryKey(b.id, 'timeline|home'), feedPage(['b-post']))
      client.setQueryData(notificationsQueryKey(a.id), notifPage(['a-notif']))
      client.setQueryData(notificationsQueryKey(b.id), notifPage(['b-notif']))
      client.setQueryData(meQueryKey(a.id), {id: 'alice'})
      client.setQueryData(meQueryKey(b.id), {id: 'bob'})

      // B is active after add; switching to A must surface only A's rows.
      expect(store.activeId()).toBe(b.id)
      store.switch(a.id)
      expect(store.activeId()).toBe(a.id)
      const active = store.activeId() as string
      expect(client.getQueryData(feedQueryKey(active, 'timeline|home'))).toEqual(feedPage(['a-post']))
      expect(client.getQueryData(notificationsQueryKey(active))).toEqual(notifPage(['a-notif']))

      // And back: B's rows are exactly what B left, with no A rows mixed in.
      store.switch(b.id)
      const back = store.activeId() as string
      expect(client.getQueryData(feedQueryKey(back, 'timeline|home'))).toEqual(feedPage(['b-post']))
      expect(client.getQueryData(notificationsQueryKey(back))).toEqual(notifPage(['b-notif']))
      expect(client.getQueryData(meQueryKey(back))).toEqual({id: 'bob'})
    } finally {
      unregister()
    }
  })

  it('drafts follow the session, not the active pointer', async () => {
    const {storage, store, unregister} = setup()
    try {
      const a = await store.add(inputA())
      const b = await store.add(inputB())
      saveDraft(storage, a.id, draft('alice-words'))
      setOpenDraftId(storage, a.id, 'd-alice-words')
      saveDraft(storage, b.id, draft('bob-words'))

      store.switch(a.id)
      expect(listDrafts(storage, store.activeId() as string).map(d => d.text)).toEqual(['alice-words'])
      expect(getOpenDraftId(storage, store.activeId() as string)).toBe('d-alice-words')
      store.switch(b.id)
      expect(listDrafts(storage, store.activeId() as string).map(d => d.text)).toEqual(['bob-words'])
      expect(getOpenDraftId(storage, store.activeId() as string)).toBeNull()
    } finally {
      unregister()
    }
  })

  it('post shadow is keyed per session even for the same remote post', async () => {
    const {store, unregister} = setup()
    try {
      const a = await store.add(inputA())
      const b = await store.add(inputB())
      postShadowStore.patch(a.id, 'shared-post', {favourited: true})
      postShadowStore.patch(b.id, 'shared-post', {bookmarked: true})

      store.switch(b.id)
      expect(postShadowStore.get(store.activeId() as string, 'shared-post')).toEqual(
        expect.objectContaining({bookmarked: true}),
      )
      expect(postShadowStore.get(store.activeId() as string, 'shared-post')).not.toHaveProperty('favourited')
    } finally {
      unregister()
    }
  })
})

describe('removing an account leaves the survivor fully intact', () => {
  it('purges feed, notifications, drafts, shadow and streams for the removed id only', async () => {
    const {storage, store, client, unregister} = setup()
    const stopped: string[] = []
    try {
      const a = await store.add(inputA())
      const b = await store.add(inputB())
      client.setQueryData(feedQueryKey(a.id, 'timeline|home'), feedPage(['a-post']))
      client.setQueryData(feedQueryKey(b.id, 'timeline|home'), feedPage(['b-post']))
      client.setQueryData(notificationsQueryKey(a.id), notifPage(['a-notif']))
      client.setQueryData(notificationsQueryKey(b.id), notifPage(['b-notif']))
      saveDraft(storage, a.id, draft('alice-words'))
      setOpenDraftId(storage, a.id, 'd-alice-words')
      saveDraft(storage, b.id, draft('bob-words'))
      postShadowStore.patch(a.id, 'p1', {favourited: true})
      postShadowStore.patch(b.id, 'p1', {renoted: true})
      registerSessionStreamStop(a.id, () => {
        stopped.push('a')
      })
      registerSessionStreamStop(b.id, () => {
        stopped.push('b')
      })

      await store.remove(a.id)

      // A's stream teardown ran; B's is still registered (not run).
      expect(stopped).toEqual(['a'])
      // Every A surface is gone.
      expect(client.getQueryData(feedQueryKey(a.id, 'timeline|home'))).toBeUndefined()
      expect(client.getQueryData(notificationsQueryKey(a.id))).toBeUndefined()
      expect(listDrafts(storage, a.id)).toEqual([])
      expect(getOpenDraftId(storage, a.id)).toBeNull()
      expect(postShadowStore.get(a.id, 'p1')).toBeUndefined()
      // Every B surface is intact.
      expect(client.getQueryData(feedQueryKey(b.id, 'timeline|home'))).toEqual(feedPage(['b-post']))
      expect(client.getQueryData(notificationsQueryKey(b.id))).toEqual(notifPage(['b-notif']))
      expect(listDrafts(storage, b.id).map(d => d.text)).toEqual(['bob-words'])
      expect(postShadowStore.get(b.id, 'p1')).toEqual(expect.objectContaining({renoted: true}))
      stopSessionStreams(b.id)
      expect(stopped).toEqual(['a', 'b'])
    } finally {
      unregister()
    }
  })
})

describe('sessionScopedKeys ratchet (every listed key is purged)', () => {
  it('purgeSessionStorage deletes each listed key and nothing else', () => {
    const storage: KeyValueStore = createMemoryStore()
    const victim = makeSession({origin: 'https://a.example', accountId: 'alice'}).id
    const survivor = makeSession({origin: 'https://b.example', accountId: 'bob'}).id
    const keys = sessionScopedKeys(victim)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) storage.setItem(key, 'sentinel')
    storage.setItem(sessionScopedKeys(survivor)[0], 'survivor-sentinel')

    purgeSessionStorage(storage, victim)

    // Fails if any sessionScopedKeys entry is missing from the purge list.
    for (const key of keys) expect(storage.getItem(key)).toBeNull()
    expect(storage.getItem(sessionScopedKeys(survivor)[0])).toBe('survivor-sentinel')
    // Idempotent.
    expect(() => purgeSessionStorage(storage, victim)).not.toThrow()
  })

  it('purgeSessionMemory clears the shadow and stops the streams', () => {
    const stopped: string[] = []
    registerSessionStreamStop('s1', () => {
      stopped.push('s1')
    })
    postShadowStore.patch('s1', 'p1', {bookmarked: true})
    postShadowStore.patch('s2', 'p1', {bookmarked: true})
    purgeSessionMemory('s1')
    expect(postShadowStore.get('s1', 'p1')).toBeUndefined()
    expect(postShadowStore.get('s2', 'p1')).toBeDefined()
    expect(stopped).toEqual(['s1'])
  })
})
