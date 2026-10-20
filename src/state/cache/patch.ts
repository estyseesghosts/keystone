import type {InfiniteData, QueryClient} from '@tanstack/react-query'

import type {Post} from '@keystone/fedi'

// Cache-wide post patching (slice 4.1). Writes a confirmed change into every
// cached copy of a post for ONE session: feed pages, single-post queries,
// notification rows, and nested renote/quote/reply copies. Only queries whose
// key starts with `sessionId` are touched -- another account's cache is never
// read or written.

/** Return a new post, or null to remove it from lists. */
export type PostUpdater = (post: Post) => Post | null

function patchPost(post: Post, id: string, fn: PostUpdater): Post | null {
  if (!post || typeof post !== 'object') return post
  let changed = false
  let next: Post = post
  if (post.id === id) {
    const res = fn(post)
    if (res === null) return null
    if (res !== post) {
      next = res
      changed = true
    }
  }
  for (const k of ['renote', 'quote', 'reply'] as const) {
    const child = next[k]
    if (child) {
      const res = patchPost(child, id, fn)
      if (res !== child && res !== null) {
        next = {...next, [k]: res}
        changed = true
      }
    }
  }
  return changed ? next : post
}

type Row = Post | {post?: Post | null; id?: string}

function patchRow(row: Row, id: string, fn: PostUpdater): Row | null {
  const r = row as {post?: Post | null; content?: unknown; author?: unknown}
  if (r.author && r.content) return patchPost(row as Post, id, fn)
  // Notification-shaped row: patch the nested post, never drop the row.
  if (r.post) {
    const res = patchPost(r.post, id, fn)
    if (res === r.post) return row
    return {...(row as object), post: res} as Row
  }
  return row
}

function patchData(data: unknown, id: string, fn: PostUpdater): unknown {
  if (!data || typeof data !== 'object') return data
  const maybePages = (data as InfiniteData<{items: Row[]}>).pages
  if (Array.isArray(maybePages)) {
    let changed = false
    const pages = maybePages.map(page => {
      if (!page || !Array.isArray(page.items)) return page
      let pageChanged = false
      const items: Row[] = []
      for (const item of page.items) {
        const res = patchRow(item, id, fn)
        if (res !== item) pageChanged = true
        if (res !== null) items.push(res)
      }
      if (!pageChanged) return page
      changed = true
      return {...page, items}
    })
    return changed ? {...(data as object), pages} : data
  }
  const asPost = data as Post
  if (asPost.author && asPost.content) {
    const res = patchPost(asPost, id, fn)
    return res === null ? data : res
  }
  return data
}

/**
 * Apply `fn` to every cached copy of `postId` in `sessionId`'s queries.
 * Returns the number of queries changed.
 */
export function patchPostInCaches(
  client: QueryClient,
  sessionId: string,
  postId: string,
  fn: PostUpdater,
): number {
  if (!sessionId) throw new Error('patchPostInCaches requires a sessionId')
  let changed = 0
  for (const query of client.getQueryCache().findAll()) {
    if (query.queryKey[0] !== sessionId) continue
    const prev = query.state.data
    const next = patchData(prev, postId, fn)
    if (next !== prev) {
      client.setQueryData(query.queryKey, next)
      changed++
    }
  }
  return changed
}
