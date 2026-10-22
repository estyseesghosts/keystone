// Delete-and-redraft (clickstone §1.7). The flow is delete FIRST, then open
// the composer seeded with the deleted post's payload: a delete that fails
// must never seat a composer as if it worked (the post would still exist and
// the "redraft" would be a duplicate).
//
// The seed travels through a small in-memory handoff keyed by the post id,
// not route params: a `Post` is a large object graph, and the Compose route
// is also reachable from a cold start where no handoff exists — that case
// shows the honest "nothing to redraft" state instead of a blank composer.
//
// Misskey already had a redraft helper (`redraftPayload` in
// `misskey/noteEdit.ts`, ids only); the core `redraftSeedOf` replaces it for
// BOTH families because it carries a full composer seed (text/CW/visibility/
// localOnly/media with alt/reply/quote).

import {redraftSeedOf, type Backend, type ComposeState, type Post} from '@keystone/fedi'

/** The composer seed produced by a redraft (a partial ComposeState). */
export type RedraftSeed = Partial<ComposeState>

const seeds = new Map<string, RedraftSeed>()

/** Hand a seed to the composer that is about to open for `postId`. */
export function putRedraftSeed(postId: string, seed: RedraftSeed): void {
  seeds.set(postId, seed)
}

/** Read the seed for `postId` and drop it: a handoff is consumed once, so a
 * second composer opening for the same id cannot re-post a stale payload. */
export function takeRedraftSeed(postId: string): RedraftSeed | null {
  const seed = seeds.get(postId) ?? null
  if (seed) seeds.delete(postId)
  return seed
}

/** Test-only reset (jest runs many cases in one module registry). */
export function clearRedraftSeeds(): void {
  seeds.clear()
}

/**
 * Delete `post` (keeping its media alive) and hand the composer its payload.
 * Order matters and is pinned by tests:
 *
 * 1. `backend.deletePost(id, {keepMedia: true})` — the ONLY step allowed to
 *    abort the flow. A rejection propagates and NOTHING is seeded.
 * 2. A reply target the post did not pack is re-resolved by id for the seed.
 *    It may legitimately be gone: the lookup is best-effort and a failure
 *    just drops that context (never invents it). A quote cannot be re-resolved
 *    by id at all (`Post` carries the target object or its honest
 *    `quoteUnavailable` flag, no id), so only a packed quote is carried.
 * 3. The seed is stored for the composer.
 *
 * `onDeleted` runs right after a successful delete (before the seed): the
 * caller uses it to drop the post from its cached feeds, exactly where a
 * plain delete would. It is never called on a failed delete.
 */
export async function deleteAndRedraft(
  backend: Backend,
  post: Post,
  opts: {onDeleted?: (post: Post) => void} = {},
): Promise<void> {
  await backend.deletePost(post.id, {keepMedia: true})
  opts.onDeleted?.(post)
  const replyTo = post.reply ?? (await resolveTarget(backend, post.replyToId))
  putRedraftSeed(post.id, redraftSeedOf(post, {replyTo, quote: post.quote}))
}

async function resolveTarget(backend: Backend, id: string | null): Promise<Post | null> {
  if (!id) return null
  try {
    return await backend.post(id)
  } catch {
    // Deleted/hidden/unreachable target: the composer still opens, just
    // without that context row.
    return null
  }
}
