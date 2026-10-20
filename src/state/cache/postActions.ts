import {useMemo, useSyncExternalStore} from 'react'
import {useQueryClient, type QueryClient} from '@tanstack/react-query'

import {backendForSession, isHeartReaction, LikeUnsupportedError, type Backend, type Post} from '@keystone/fedi'

import {
  createToggleQueue,
  PartialToggleError,
  type ToggleQueue,
} from '#/lib/hooks/useToggleMutationQueue'
import {useSessionStore} from '#/state/session/SessionProvider'

import {gateAction, type ActionGate, type PostActionKind} from './gates'
import {patchPostInCaches} from './patch'
import {
  applyPostShadow,
  postShadowStore,
  usePostShadow,
  type PostShadowStore,
  type ShadowField,
  type ShadowedPost,
} from './post-shadow'

// Post action controller (slice 4.1): optimistic toggles for reaction,
// favourite, renote, bookmark and delete over the shadow store + toggle
// queue. One queue per (sessionId, postId, kind); each run uses the backend
// of ITS session only (so a token/origin of session A is never used for B).

export class ActionUnavailableError extends Error {
  readonly reasonCode: string
  constructor(gate: Extract<ActionGate, {enabled: false}>) {
    super(gate.reason)
    this.name = 'ActionUnavailableError'
    this.reasonCode = gate.reasonCode
  }
}

type QueueCtx = {backend: Backend | null}
const FIELD: Record<PostActionKind, ShadowField> = {
  reaction: 'reaction',
  favourite: 'favourite',
  renote: 'renote',
  bookmark: 'bookmark',
  delete: 'delete',
}

export interface PostActionController {
  /** Set my reaction (key) or clear it (null). Misskey-family servers
   * change a reaction as delete-then-create. `emojiUrl` (when the picker
   * knows the art) avoids the pending placeholder. */
  setReaction(
    sessionId: string,
    backend: Backend | null,
    post: Post,
    next: string | null,
    opts?: {emojiUrl?: string | null},
  ): Promise<void>
  setFavourite(sessionId: string, backend: Backend | null, post: Post, next: boolean): Promise<void>
  setRenoted(sessionId: string, backend: Backend | null, post: Post, next: boolean): Promise<void>
  setBookmarked(sessionId: string, backend: Backend | null, post: Post, next: boolean): Promise<void>
  /** Delete own post. Rolls back (post reappears) if the server refuses. */
  deletePost(sessionId: string, backend: Backend | null, post: Post, isOwn: boolean): Promise<void>
}

export function createPostActionController(deps: {
  store?: PostShadowStore
  queryClient?: QueryClient | null
}): PostActionController {
  const store = deps.store ?? postShadowStore
  const queryClient = deps.queryClient ?? null
  const queues = new Map<string, {queue: ToggleQueue<unknown>; ctx: QueueCtx}>()

  function isCustomKey(key: string): boolean {
    return key.startsWith(':') && key.endsWith(':') && key.length > 2
  }

  function queueFor<T>(
    kind: PostActionKind,
    sessionId: string,
    post: Post,
    confirmedNow: T,
    ctx: QueueCtx,
    run: (backend: Backend, from: T, to: T) => Promise<void>,
    optimistic: (v: T) => void,
    settle: (v: T) => void,
  ): ToggleQueue<T> {
    const key = `${sessionId}\u0000${post.id}\u0000${kind}`
    const existing = queues.get(key)
    if (existing) {
      existing.ctx.backend = ctx.backend
      existing.queue.reset(confirmedNow)
      return existing.queue as ToggleQueue<T>
    }
    const entry = {ctx: {backend: ctx.backend}} as {queue: ToggleQueue<unknown>; ctx: QueueCtx}
    const queue = createToggleQueue<T>({
      initial: confirmedNow,
      run: async (from, to) => {
        const backend = entry.ctx.backend
        if (!backend) throw new Error('No backend for this session')
        await run(backend, from, to)
      },
      onRollback: v => optimistic(v),
      onSettled: v => {
        queues.delete(key)
        settle(v)
      },
    })
    entry.queue = queue as ToggleQueue<unknown>
    queues.set(key, entry)
    return queue
  }

  /** On idle: write the confirmed value into every cached copy, then drop
   * the shadow field (the cache now carries it). */
  function settleInto(sessionId: string, post: Post, kind: PostActionKind) {
    const shadow = store.get(sessionId, post.id)
    if (!shadow) return
    // Equal to the server value it was layered on: nothing left to say.
    const unchanged = applyPostShadow(post, shadow) === post
    const patched = queryClient
      ? patchPostInCaches(queryClient, sessionId, post.id, p => applyPostShadow(p, shadow))
      : 0
    // Keep the override when no cache carries it (a held reference would
    // snap back to stale data); the base guard drops it once fresh server
    // data arrives.
    if (patched > 0 || unchanged) store.clear(sessionId, post.id, [FIELD[kind]])
  }

  function refuse(kind: PostActionKind, backend: Backend | null, post: Post, isOwn?: boolean) {
    const gate = backend
      ? gateAction(kind, {capabilities: backend.capabilities, backend, isOwn})
      : gateAction(kind, {capabilities: null})
    return gate.enabled ? null : Promise.reject(new ActionUnavailableError(gate))
  }

  return {
    setReaction(sessionId, backend, post, next, opts) {
      const refused = refuse('reaction', backend, post)
      if (refused) return refused
      // Seed the queue from what the user SEES, not the raw prop. When the
      // shadow outlives the queue (held reference, post in no cached query)
      // the raw post is stale: seeding from it turns an unlike into a silent
      // no-op (confirmed == desired, no server call, server stays liked).
      // The shadow BASE stays on the raw server value (first-write-wins) so
      // fresh server data still drops a stale override.
      const rawMine = post.reactions?.mine ?? null
      const shadowMine = store.get(sessionId, post.id)?.myReaction
      const seenMine = shadowMine !== undefined ? shadowMine : rawMine
      const baseMine = rawMine
      const isKnown = (v: string | null, emojiUrl?: string | null) =>
        v == null ||
        !isCustomKey(v) ||
        !!emojiUrl ||
        !!post.reactions?.urls[v] ||
        !!post.reactions?.entries.find(e => e.key === v)?.url
      const write = (v: string | null, emojiUrl?: string | null) =>
        store.patch(sessionId, post.id, {
          myReaction: v,
          reactionDelta: (v != null ? 1 : 0) - (baseMine != null ? 1 : 0),
          reactionUrl: v != null ? (emojiUrl ?? undefined) : undefined,
          pendingEmoji: v != null && !isKnown(v, emojiUrl) ? v : null,
          base: {myReaction: baseMine},
        })
      const queue = queueFor<string | null>(
        'reaction',
        sessionId,
        post,
        seenMine,
        {backend},
        async (b, from, to) => {
          // Sharkey-family like shortcut: a pure heart toggle (one side a
          // heart, the other null-or-heart) goes through `POST notes/like`,
          // which toggles server-side — no separate delete. Custom emoji on
          // either side keeps the plain delete/create path. Unknown support
          // falls back to a vanilla heart reaction, never a wall.
          const fromHeart = from != null && isHeartReaction(from)
          const toHeart = to != null && isHeartReaction(to)
          // A press that ends liked-or-clear with a heart on either side
          // rides the shortcut: null<->heart both ways, plus replacing a
          // stale custom reaction with a heart (cleared first below, since
          // the toggle would otherwise just switch the custom off).
          const likeTransition =
            (to == null || toHeart) &&
            (from == null || fromHeart || (toHeart && from != null))
          if (likeTransition && b.like && b.like.isSupported() !== false) {
            // A stale custom reaction cannot ride the like toggle (the
            // server would just switch it off): clear it first so the
            // press lands liked, like the user asked.
            if (from != null && !fromHeart) await b.unreact(post.id)
            try {
              await b.like.like(post.id, null)
            } catch (e) {
              if (e instanceof LikeUnsupportedError) {
                if (from != null) await b.unreact(post.id)
                if (to != null) await b.react(post.id, '❤')
                return
              }
              throw e
            }
            // Never fabricate: re-read and sync to what the server
            // reports (a custom `defaultLike` lands here, not the
            // optimistic heart). A failed re-read keeps the optimistic
            // value; the stream echo reconciles it.
            const fresh = await b.post(post.id).catch(() => null)
            if (!fresh) return
            const mine = fresh.reactions?.mine ?? null
            const urls = fresh?.reactions?.urls ?? {}
            const known =
              mine == null ||
              !isCustomKey(mine) ||
              !!urls[mine] ||
              !!fresh?.reactions?.entries.some(e => e.key === mine && e.url)
            store.patch(sessionId, post.id, {
              myReaction: mine,
              reactionDelta: (mine != null ? 1 : 0) - (baseMine != null ? 1 : 0),
              reactionUrl: undefined,
              pendingEmoji: mine != null && !known ? mine : null,
              base: {myReaction: baseMine},
            })
            return
          }
          if (from != null) await b.unreact(post.id)
          if (to != null) {
            try {
              await b.react(post.id, to)
            } catch (e) {
              // The delete landed; the server now holds no reaction.
              if (from != null) throw new PartialToggleError<string | null>(null, e)
              throw e
            }
          }
        },
        v => write(v),
        () => settleInto(sessionId, post, 'reaction'),
      )
      write(next, opts?.emojiUrl)
      return queue.queueToggle(next)
    },

    setFavourite(sessionId, backend, post, next) {
      return boolToggle('favourite', sessionId, backend, post, next, post.favourite?.mine ?? false, 'favourited', (b, to) =>
        to ? b.favourite(post.id) : b.unfavourite(post.id),
      )
    },
    setRenoted(sessionId, backend, post, next) {
      return boolToggle('renote', sessionId, backend, post, next, post.ext.reblogged ?? false, 'renoted', async (b, to) => {
        if (to) await b.boost(post.id)
        else await b.unboost(post.id)
      })
    },
    setBookmarked(sessionId, backend, post, next) {
      return boolToggle('bookmark', sessionId, backend, post, next, post.ext.bookmarked ?? false, 'bookmarked', async (b, to) => {
        const api = b.bookmarks
        if (!api) throw new Error('Bookmarks are not available on this server.')
        if (to) await api.add(post.id)
        else await api.remove(post.id)
      })
    },
    deletePost(sessionId, backend, post, isOwn) {
      const refused = refuse('delete', backend, post, isOwn)
      if (refused) return refused
      const queue = queueFor<boolean>(
        'delete',
        sessionId,
        post,
        false,
        {backend},
        async (b, _from, to) => {
          if (to) await b.deletePost(post.id)
        },
        v => store.patch(sessionId, post.id, {isDeleted: v}),
        v => {
          if (v) {
            // Gone for good: remove every cached copy, keep the shadow so
            // a held reference still hides.
            if (queryClient) patchPostInCaches(queryClient, sessionId, post.id, () => null)
          } else {
            store.clear(sessionId, post.id, ['delete'])
          }
        },
      )
      store.patch(sessionId, post.id, {isDeleted: true})
      return queue.queueToggle(true)
    },
  }

  function boolToggle(
    kind: Exclude<PostActionKind, 'reaction' | 'delete'>,
    sessionId: string,
    backend: Backend | null,
    post: Post,
    next: boolean,
    baseValue: boolean,
    field: 'favourited' | 'renoted' | 'bookmarked',
    call: (b: Backend, to: boolean) => Promise<unknown>,
  ): Promise<void> {
    const refused = refuse(kind, backend, post)
    if (refused) return refused
    // Same staleness rule as reactions: seed from the seen value so an
    // undo after a kept shadow still reaches the server.
    const seen = store.get(sessionId, post.id)?.[field] ?? baseValue
    const queue = queueFor<boolean>(
      kind,
      sessionId,
      post,
      seen,
      {backend},
      async (b, _from, to) => {
        await call(b, to)
      },
      v => store.patch(sessionId, post.id, {[field]: v, base: {[field]: baseValue}}),
      () => settleInto(sessionId, post, kind),
    )
    store.patch(sessionId, post.id, {[field]: next, base: {[field]: baseValue}})
    return queue.queueToggle(next)
  }
}

// --- React ------------------------------------------------------------------

const controllers = new WeakMap<QueryClient, PostActionController>()

/** One controller (and one queue registry) per QueryClient. */
export function postActionControllerFor(queryClient: QueryClient): PostActionController {
  let c = controllers.get(queryClient)
  if (!c) controllers.set(queryClient, (c = createPostActionController({queryClient})))
  return c
}

export interface PostToggle<T> {
  gate: ActionGate
  /** The value to render (shadow-merged). */
  value: T
  set: (next: T) => Promise<void>
}

export interface PostActions {
  /** Post with the shadow merged: render THIS. */
  shadowed: ShadowedPost
  reaction: PostToggle<string | null> & {
    setWithArt: (key: string | null, emojiUrl: string | null) => Promise<void>
  }
  favourite: PostToggle<boolean>
  renote: PostToggle<boolean>
  bookmark: PostToggle<boolean>
  delete: {gate: ActionGate; run: () => Promise<void>}
}

/**
 * Everything a post row needs for the write path. `post` is the UNSHADOWED
 * domain post you are displaying (for a pure repost, its `renote` original:
 * `appearNoteOf(post)`). `sessionId` is the session that owns the feed.
 */
export function usePostActions(sessionId: string, post: Post): PostActions {
  const queryClient = useQueryClient()
  const sessionStore = useSessionStore()
  const snapshot = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot)
  const session = snapshot.sessions.find(s => s.id === sessionId) ?? null
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  const shadowed = usePostShadow(sessionId, post)
  const controller = postActionControllerFor(queryClient)
  const caps = backend?.capabilities ?? null
  const isOwn = session != null && post.author.id === session.accountId
  const merged = shadowed.post
  const toggle = <T,>(
    kind: PostActionKind,
    value: T,
    set: (next: T) => Promise<void>,
  ): PostToggle<T> => ({
    gate: gateAction(kind, {capabilities: caps, backend, isOwn}),
    value,
    set,
  })
  return {
    shadowed,
    reaction: {
      ...toggle<string | null>('reaction', merged.reactions?.mine ?? null, n =>
        controller.setReaction(sessionId, backend, post, n),
      ),
      setWithArt: (key, emojiUrl) => controller.setReaction(sessionId, backend, post, key, {emojiUrl}),
    },
    favourite: toggle('favourite', merged.favourite?.mine ?? false, n =>
      controller.setFavourite(sessionId, backend, post, n),
    ),
    renote: toggle('renote', merged.ext.reblogged ?? false, n =>
      controller.setRenoted(sessionId, backend, post, n),
    ),
    bookmark: toggle('bookmark', merged.ext.bookmarked ?? false, n =>
      controller.setBookmarked(sessionId, backend, post, n),
    ),
    delete: {
      gate: gateAction('delete', {capabilities: caps, backend, isOwn}),
      run: () => controller.deletePost(sessionId, backend, post, isOwn),
    },
  }
}
