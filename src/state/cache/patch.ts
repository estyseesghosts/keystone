import type {InfiniteData, QueryClient} from '@tanstack/react-query'

import {isPureRenote, type Post} from '@keystone/fedi'

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
    if (!child) continue
    const res = patchPost(child, id, fn)
    if (res === child) continue
    if (res !== null) {
      next = {...next, [k]: res}
      changed = true
      continue
    }
    // The nested original was removed (X8.3). A pure boost wrapper has no
    // own content to show: drop the row so a deleted original stops
    // rendering in feeds. A quote keeps its row with the packed target
    // nulled and `quoteUnavailable` set, so the card renders its honest
    // translated unavailable placeholder instead of stale content. A
    // packed reply parent is nulled the same way (the model already reads
    // a null reply as deleted, private, or unpacked).
    if (k === 'renote' && isPureRenote(next)) return null
    if (k === 'quote') {
      next = {...next, quote: null, quoteUnavailable: true}
    } else if (k === 'renote') {
      next = {...next, renote: null}
    } else {
      next = {...next, reply: null}
    }
    changed = true
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
    // A delete (fn returned null) on a single-post query must not keep
    // serving the old data: return null so the caller drops the query
    // (a remount refetches; the shadow's isDeleted covers the UI meanwhile
    // — see usePostShadow / NoteScreen goBack). Infinite lists drop the
    // row in the branch above; notification rows keep the row shell.
    if (res === null) return null
    return res
  }
  return data
}

/**
 * Apply `fn` to every cached copy of `postId` in `sessionId`'s queries.
 * Infinite lists drop rows `fn` deletes; single-post queries `fn` deletes
 * are removed (not left stale) so a remount refetches instead of rendering
 * a deleted post. Returns the number of queries changed.
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
      if (next === null) client.removeQueries({queryKey: query.queryKey, exact: true})
      else client.setQueryData(query.queryKey, next)
      changed++
    }
  }
  return changed
}
