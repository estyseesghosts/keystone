import {useMemo, useSyncExternalStore} from 'react'

import {withFavourite, withReaction, type Post} from '@keystone/fedi'

// Post shadow (slice 4.1): a per-(sessionId, postId) overlay of the viewer's
// not-yet-confirmed state, merged over the domain `Post` at render time.
// Feeds, threads and the lightbox all read the same shadow, so a like in one
// place shows in every place immediately. The shadow never mutates the query
// cache; `patch.ts` writes the confirmed result there when a queue settles.
//
// Every key includes the session id: A's shadow can never decorate B's post
// even when both sessions see the same remote post id.

/** Snapshot of the SERVER values the shadow was layered on. If the post's
 * own value later differs from this, fresh server data has arrived and the
 * stale override is ignored (server wins). */
export interface ShadowBase {
  myReaction?: string | null
  favourited?: boolean
  renoted?: boolean
  bookmarked?: boolean
}

export interface PostShadow {
  /** Viewer's reaction key; null = no reaction; undefined = no override. */
  myReaction?: string | null
  /** Net change of the reaction total relative to `base.myReaction`. */
  reactionDelta?: number
  /** Resolved art for a custom reaction, when the picker knew it. */
  reactionUrl?: string | null
  /** A custom-emoji reaction key (`:code@host:`) whose art is not known yet.
   * Renderers show a fixed 16x16 box, never the `:code:` text. */
  pendingEmoji?: string | null
  /** Mastodon-family favourite (separate from reactions). */
  favourited?: boolean
  renoted?: boolean
  bookmarked?: boolean
  isDeleted?: boolean
  base?: ShadowBase
}

export type PostShadowPatch = Omit<PostShadow, 'base'> & {base?: ShadowBase}

const SEP = '\u0000'
function shadowKey(sessionId: string, postId: string): string {
  if (!sessionId) throw new Error('post shadow requires a non-empty sessionId')
  return `${sessionId}${SEP}${postId}`
}

export interface PostShadowStore {
  get(sessionId: string, postId: string): PostShadow | undefined
  /** Merge fields in. `base` entries are only written the first time. */
  patch(sessionId: string, postId: string, patch: PostShadowPatch): void
  /** Drop override fields (and their base). Removes the entry when empty. */
  clear(sessionId: string, postId: string, fields: ShadowField[]): void
  /** Drop everything for a session (sign-out). */
  clearSession(sessionId: string): void
  reset(): void
  subscribe(sessionId: string, postId: string, cb: () => void): () => void
}

export type ShadowField = 'reaction' | 'favourite' | 'renote' | 'bookmark' | 'delete'

const FIELD_KEYS: Record<ShadowField, (keyof PostShadow)[]> = {
  reaction: ['myReaction', 'reactionDelta', 'reactionUrl', 'pendingEmoji'],
  favourite: ['favourited'],
  renote: ['renoted'],
  bookmark: ['bookmarked'],
  delete: ['isDeleted'],
}
const BASE_KEYS: Record<ShadowField, keyof ShadowBase | null> = {
  reaction: 'myReaction',
  favourite: 'favourited',
  renote: 'renoted',
  bookmark: 'bookmarked',
  delete: null,
}

export function createPostShadowStore(): PostShadowStore {
  const entries = new Map<string, PostShadow>()
  const listeners = new Map<string, Set<() => void>>()
  const emit = (key: string) => listeners.get(key)?.forEach(cb => cb())

  return {
    get: (s, p) => entries.get(shadowKey(s, p)),
    patch(s, p, patch) {
      const key = shadowKey(s, p)
      const prev = entries.get(key) ?? {}
      const {base: baseIn, ...rest} = patch
      const base: ShadowBase = {...prev.base}
      for (const [k, v] of Object.entries(baseIn ?? {})) {
        if (!(k in base)) (base as Record<string, unknown>)[k] = v
      }
      entries.set(key, {...prev, ...rest, base})
      emit(key)
    },
    clear(s, p, fields) {
      const key = shadowKey(s, p)
      const prev = entries.get(key)
      if (!prev) return
      const next: PostShadow = {...prev, base: {...prev.base}}
      for (const f of fields) {
        for (const k of FIELD_KEYS[f]) delete next[k]
        const bk = BASE_KEYS[f]
        if (bk) delete next.base?.[bk]
      }
      const hasOverride = Object.keys(next).some(k => k !== 'base')
      if (hasOverride) entries.set(key, next)
      else entries.delete(key)
      emit(key)
    },
    clearSession(s) {
      const prefix = `${s}${SEP}`
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) {
          entries.delete(key)
          emit(key)
        }
      }
    },
    reset() {
      const keys = [...entries.keys()]
      entries.clear()
      keys.forEach(emit)
    },
    subscribe(s, p, cb) {
      const key = shadowKey(s, p)
      let set = listeners.get(key)
      if (!set) listeners.set(key, (set = new Set()))
      set.add(cb)
      return () => {
        set?.delete(cb)
        if (set && set.size === 0) listeners.delete(key)
      }
    },
  }
}

/** App-wide shadow store. Tests call `postShadowStore.reset()`. */
export const postShadowStore: PostShadowStore = createPostShadowStore()

// --- Pure merge ------------------------------------------------------------

function clampAdd(n: number, d: number): number {
  return Math.max(0, n + d)
}

/**
 * Merge a shadow over a post. Pure. Each override applies only while the
 * post's own server value still equals the value the shadow was based on.
 */
export function applyPostShadow(post: Post, shadow: PostShadow | undefined): Post {
  if (!shadow) return post
  const base = shadow.base ?? {}
  let out = post

  if (shadow.myReaction !== undefined && (post.reactions?.mine ?? null) === (base.myReaction ?? null)) {
    out = withReaction(out, shadow.myReaction)
    const key = shadow.myReaction
    if (key != null && shadow.reactionUrl && out.reactions) {
      out = {
        ...out,
        reactions: {
          ...out.reactions,
          urls: {...out.reactions.urls, [key]: shadow.reactionUrl},
          entries: out.reactions.entries.map(e =>
            e.key === key && !e.url ? {...e, url: shadow.reactionUrl ?? null} : e,
          ),
        },
      }
    }
    const delta = shadow.reactionDelta ?? 0
    if (delta !== 0) {
      out = {...out, counts: {...out.counts, reactions: clampAdd(out.counts.reactions, delta)}}
    }
  }

  if (
    shadow.favourited !== undefined &&
    out.favourite &&
    out.favourite.mine === (base.favourited ?? out.favourite.mine)
  ) {
    out = withFavourite(out, shadow.favourited)
  }

  if (shadow.renoted !== undefined) {
    const server = post.ext.reblogged
    const was = base.renoted ?? false
    if (server === undefined || server === was) {
      const delta = (shadow.renoted ? 1 : 0) - (was ? 1 : 0)
      out = {
        ...out,
        counts: {...out.counts, boosts: clampAdd(out.counts.boosts, delta)},
        ext: {...out.ext, reblogged: shadow.renoted},
      }
    }
  }

  if (shadow.bookmarked !== undefined) {
    const server = post.ext.bookmarked
    const was = base.bookmarked ?? false
    if (server === undefined || server === was) {
      out = {...out, ext: {...out.ext, bookmarked: shadow.bookmarked}}
    }
  }
  return out
}

// --- Hooks -----------------------------------------------------------------

export interface ShadowedPost {
  /** The domain post with the shadow merged in. */
  post: Post
  /** The viewer deleted it (confirmed or still in flight): hide the row. */
  isDeleted: boolean
  /** Reaction keys that are custom emoji with unknown art right now. */
  pendingEmojiKeys: ReadonlySet<string>
  shadow: PostShadow | undefined
}

const NO_KEYS: ReadonlySet<string> = new Set()

/** Subscribe to one post's shadow (sessionId first, always). */
export function usePostShadowState(
  sessionId: string,
  postId: string,
  store: PostShadowStore = postShadowStore,
): PostShadow | undefined {
  return useSyncExternalStore(
    cb => store.subscribe(sessionId, postId, cb),
    () => store.get(sessionId, postId),
    () => store.get(sessionId, postId),
  )
}

/** Merge the shadow for (sessionId, post.id) over `post`. */
export function usePostShadow(
  sessionId: string,
  post: Post,
  store: PostShadowStore = postShadowStore,
): ShadowedPost {
  const shadow = usePostShadowState(sessionId, post.id, store)
  return useMemo(() => {
    const merged = applyPostShadow(post, shadow)
    return {
      post: merged,
      isDeleted: shadow?.isDeleted === true,
      pendingEmojiKeys: shadow?.pendingEmoji ? new Set([shadow.pendingEmoji]) : NO_KEYS,
      shadow,
    }
  }, [post, shadow])
}
