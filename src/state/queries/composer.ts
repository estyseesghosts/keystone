import {useCallback, useMemo, useRef, useState} from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'

import {
  fetchComposeLimits,
  type Backend,
  type ComposeLimits,
  type CustomEmoji,
  type Page,
  type Post,
  type PostDraft,
  type ScheduledNote,
  type ServerDraft,
  type Session,
} from '@keystone/fedi'

import {patchPostInCaches} from '#/state/cache'

import {createQueryKey, feedQueryKey} from './keys'

// Composer queries and the create-post mutation (slice 4.3). Every key
// carries the sessionId first, and every request goes through the backend
// built for THAT session only.

const LIMITS_STALE = 10 * 60_000

export function composeLimitsKey(sessionId: string) {
  return createQueryKey(sessionId, 'compose-limits')
}

export function customEmojisKey(sessionId: string) {
  return createQueryKey(sessionId, 'custom-emojis')
}

/** Server character/attachment limits for the session's instance. */
export function useComposeLimits(session: Session | null) {
  return useQuery<ComposeLimits>({
    queryKey: composeLimitsKey(session?.id ?? 'signed-out'),
    enabled: !!session,
    staleTime: LIMITS_STALE,
    queryFn: () => fetchComposeLimits({origin: session!.origin, family: session!.family}),
  })
}

/** The session's own custom emoji (autocomplete source; the standalone
 * EmojiPicker is a separate component with its own data). */
export function useSessionCustomEmojis(session: Session | null, backend: Backend | null) {
  return useQuery<CustomEmoji[]>({
    queryKey: customEmojisKey(session?.id ?? 'signed-out'),
    enabled: !!session && !!backend,
    staleTime: LIMITS_STALE,
    queryFn: () => backend!.customEmojis(),
  })
}

// --- Cache insertion -----------------------------------------------------------

type FeedData = InfiniteData<Page<Post>>

function prependToQuery(client: QueryClient, key: readonly unknown[], post: Post): boolean {
  const data = client.getQueryData<FeedData>(key)
  if (!data || !Array.isArray(data.pages) || data.pages.length === 0) return false
  if (data.pages.some(p => p.items.some(i => i.id === post.id))) return false
  const [first, ...rest] = data.pages
  client.setQueryData<FeedData>(key, {
    ...data,
    pages: [{...first, items: [post, ...first.items]}, ...rest],
  })
  return true
}

/**
 * Put a freshly created post at the head of the feeds that would show it:
 * the session's home and social timelines and the author's own profile tab.
 * Only keys of THIS session are written. A reply also bumps the parent's
 * reply count wherever the parent is cached. Returns the keys written.
 */
export function insertCreatedPost(
  client: QueryClient,
  sessionId: string,
  post: Post,
  replyToId?: string | null,
): string[] {
  const descriptors = ['timeline|home', 'timeline|social']
  descriptors.push(`user|${post.author.id}|${replyToId ? 'replies' : 'posts'}`)
  const written: string[] = []
  for (const d of descriptors) {
    if (prependToQuery(client, feedQueryKey(sessionId, d), post)) written.push(d)
  }
  if (replyToId) {
    patchPostInCaches(client, sessionId, replyToId, p => ({
      ...p,
      counts: {...p.counts, replies: p.counts.replies + 1},
    }))
  }
  if (post.renote || post.quote) {
    const target = post.quote?.id
    if (target) {
      patchPostInCaches(client, sessionId, target, p => ({
        ...p,
        counts: {...p.counts, quotes: p.counts.quotes + 1},
      }))
    }
  }
  return written
}

// --- Create-post mutation ----------------------------------------------------------

export interface CreatePostInput {
  draft: PostDraft
  /** ISO time: schedule instead of posting now (gated by the caller). */
  scheduledAt?: string | null
}

export type CreatePostResult =
  | {kind: 'posted'; post: Post}
  | {kind: 'scheduled'; scheduled: ScheduledNote}

/** The create call, separated from React for tests. */
export async function submitPost(
  backend: Backend,
  input: CreatePostInput,
): Promise<CreatePostResult> {
  if (input.scheduledAt) {
    if (!backend.scheduled) throw new Error('This server does not support scheduled posts.')
    const scheduled = await backend.scheduled.create({
      ...input.draft,
      scheduledAt: input.scheduledAt,
    })
    return {kind: 'scheduled', scheduled}
  }
  return {kind: 'posted', post: await backend.createPost(input.draft)}
}

export function useCreatePost(session: Session | null, backend: Backend | null) {
  const client = useQueryClient()
  const sessionId = session?.id ?? null
  const mutation = useMutation<CreatePostResult, unknown, CreatePostInput>({
    mutationFn: input => {
      if (!backend || !sessionId) throw new Error('Sign in to post.')
      return submitPost(backend, input)
    },
    onSuccess: (result, input) => {
      if (!sessionId || result.kind !== 'posted') return
      insertCreatedPost(client, sessionId, result.post, input.draft.replyId)
    },
  })
  return mutation
}

// --- Upload tracking -----------------------------------------------------------

export type UploadStatus = 'staged' | 'uploading' | 'done' | 'error'

export interface UploadItem {
  key: string
  name: string
  previewUri: string | null
  status: UploadStatus
  /** Server media id once done. */
  mediaId: string | null
  /** Alt text / description, sent WITH the upload (neither family can be
   * edited afterwards through the Backend surface). */
  alt: string
  error: string | null
}

export interface UploadableFile {
  file: File
  name: string
  previewUri: string | null
}

/** Drive targeting for an upload batch (Misskey family). Omitted/`null`
 * folderId means the Drive root, which is the default — the wire field is
 * never sent for root (Sharkey rejects empty fields). `force` is likewise
 * opt-in and keeps the server's duplicate detection when unset. */
export interface UploadTarget {
  folderId?: string | null
  force?: boolean
}

/** Upload one file through the owning session's backend. */
export async function uploadOne(
  backend: Backend,
  file: File,
  alt: string,
  target: UploadTarget = {},
): Promise<{id: string}> {
  const media = await backend.uploadMedia(file, {
    ...(alt ? {comment: alt} : {}),
    ...(target.folderId ? {folderId: target.folderId} : {}),
    ...(target.force !== undefined ? {force: target.force} : {}),
  })
  return {id: media.id}
}

/**
 * Upload every not-yet-done item sequentially, reporting per-item status
 * (`onUpdate`). Returns the media ids in order, or null if any failed (the
 * failure stays on its item for retry; successful items are not re-sent).
 * Neither transport reports bytes, so progress is per-file state.
 *
 * `target` carries the Drive folder (and optional `force`) for this batch;
 * the default is the Drive root.
 */
export async function uploadAll(
  backend: Backend,
  items: UploadItem[],
  files: Map<string, File>,
  onUpdate: (key: string, patch: Partial<UploadItem>) => void,
  target: UploadTarget = {},
): Promise<string[] | null> {
  const ids: string[] = []
  let failed = false
  for (const item of items) {
    if (item.status === 'done' && item.mediaId) {
      ids.push(item.mediaId)
      continue
    }
    const file = files.get(item.key)
    if (!file) {
      onUpdate(item.key, {status: 'error', error: 'File is no longer available.'})
      failed = true
      continue
    }
    onUpdate(item.key, {status: 'uploading', error: null})
    try {
      const {id} = await uploadOne(backend, file, item.alt, target)
      onUpdate(item.key, {status: 'done', mediaId: id})
      ids.push(id)
    } catch (err) {
      onUpdate(item.key, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed.',
      })
      failed = true
    }
  }
  return failed ? null : ids
}

export function useUploads(backend: Backend | null, target: UploadTarget = {}) {
  const [items, setItems] = useState<UploadItem[]>([])
  const files = useMemo(() => new Map<string, File>(), [])
  const itemsRef = useRef(items)
  itemsRef.current = items
  // The batch target is read at upload time (a folder chosen after staging
  // still applies); a fresh object literal from the caller never re-creates
  // `ensureUploaded`.
  const targetRef = useRef(target)
  targetRef.current = target

  const patch = useCallback((key: string, p: Partial<UploadItem>) => {
    setItems(cur => cur.map(i => (i.key === key ? {...i, ...p} : i)))
  }, [])

  const add = useCallback(
    (picked: UploadableFile[]) => {
      const created = picked.map((p, i) => ({
        key: `u${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 5)}`,
        p,
      }))
      for (const {key, p} of created) files.set(key, p.file)
      setItems(cur => [
        ...cur,
        ...created.map(
          ({key, p}): UploadItem => ({
            key,
            name: p.name,
            previewUri: p.previewUri,
            status: 'staged',
            mediaId: null,
            alt: '',
            error: null,
          }),
        ),
      ])
    },
    [files],
  )

  const remove = useCallback(
    (key: string) => {
      files.delete(key)
      setItems(cur => cur.filter(i => i.key !== key))
    },
    [files],
  )

  /** Alt text can change until the file is uploaded. */
  const setAlt = useCallback((key: string, alt: string) => patch(key, {alt}), [patch])

  const ensureUploaded = useCallback(async (): Promise<string[] | null> => {
    if (!backend) return null
    return uploadAll(backend, itemsRef.current, files, patch, targetRef.current)
  }, [backend, files, patch])

  const clear = useCallback(() => {
    files.clear()
    setItems([])
  }, [files])

  return {items, add, remove, setAlt, ensureUploaded, clear}
}

// --- Edit post (C7) ------------------------------------------------------------

export interface EditPostInput {
  id: string
  draft: PostDraft
}

/** Edit a post through the owning session's backend, then patch every cached
 * copy of it for THIS session only. */
export function useEditPost(session: Session | null, backend: Backend | null) {
  const client = useQueryClient()
  const sessionId = session?.id ?? null
  return useMutation<Post, unknown, EditPostInput>({
    mutationFn: async input => {
      if (!backend || !sessionId) throw new Error('Sign in to post.')
      return backend.editPost(input.id, input.draft)
    },
    onSuccess: (updated, input) => {
      if (!sessionId) return
      patchPostInCaches(client, sessionId, input.id, () => updated)
    },
  })
}

// --- Scheduled posts (C8b) -----------------------------------------------------

export function scheduledPostsKey(sessionId: string) {
  return createQueryKey(sessionId, 'scheduled-posts')
}

/** The session's scheduled posts. Disabled unless the backend offers the
 * `scheduled` sub-module — never a faked list. */
export function useScheduledPosts(session: Session | null, backend: Backend | null) {
  return useQuery<ScheduledNote[]>({
    queryKey: scheduledPostsKey(session?.id ?? 'signed-out'),
    enabled: !!session && !!backend?.scheduled,
    queryFn: () => backend!.scheduled!.list(),
  })
}

/** Cancel one scheduled post, then invalidate the session's scheduled list. */
export function useCancelScheduled(session: Session | null, backend: Backend | null) {
  const client = useQueryClient()
  const sessionId = session?.id ?? null
  return useMutation<void, unknown, string>({
    mutationFn: async id => {
      if (!backend || !sessionId) throw new Error('Sign in to manage scheduled posts.')
      if (!backend.scheduled) throw new Error('This server does not support scheduled posts.')
      await backend.scheduled.delete(id)
    },
    onSuccess: () => {
      if (!sessionId) return
      void client.invalidateQueries({queryKey: scheduledPostsKey(sessionId)})
    },
  })
}

// --- Server drafts (C9/MK5) ----------------------------------------------------

export function serverDraftsKey(sessionId: string) {
  return createQueryKey(sessionId, 'server-drafts')
}

/** The session's server-side drafts. Disabled unless the backend offers the
 * `serverDrafts` sub-module — family-agnostic (a backend without it, e.g.
 * Mastodon, simply leaves the query disabled). */
export function useServerDrafts(session: Session | null, backend: Backend | null) {
  return useQuery<ServerDraft[]>({
    queryKey: serverDraftsKey(session?.id ?? 'signed-out'),
    enabled: !!session && !!backend?.serverDrafts,
    queryFn: () => backend!.serverDrafts!.list(),
  })
}

export interface SaveServerDraftInput {
  /** When present the draft is updated, otherwise it is created. */
  id?: string | null
  draft: PostDraft & {scheduledAt?: string | null}
}

/** Create-or-update a server draft, then invalidate the session's draft list. */
export function useSaveServerDraft(session: Session | null, backend: Backend | null) {
  const client = useQueryClient()
  const sessionId = session?.id ?? null
  return useMutation<ServerDraft, unknown, SaveServerDraftInput>({
    mutationFn: async input => {
      if (!backend || !sessionId) throw new Error('Sign in to manage drafts.')
      if (!backend.serverDrafts) throw new Error('This server does not support drafts.')
      if (input.id) return backend.serverDrafts.update(input.id, input.draft)
      return backend.serverDrafts.create(input.draft)
    },
    onSuccess: () => {
      if (!sessionId) return
      void client.invalidateQueries({queryKey: serverDraftsKey(sessionId)})
    },
  })
}

/** Delete a server draft, then invalidate the session's draft list. */
export function useDeleteServerDraft(session: Session | null, backend: Backend | null) {
  const client = useQueryClient()
  const sessionId = session?.id ?? null
  return useMutation<void, unknown, string>({
    mutationFn: async id => {
      if (!backend || !sessionId) throw new Error('Sign in to manage drafts.')
      if (!backend.serverDrafts) throw new Error('This server does not support drafts.')
      await backend.serverDrafts.delete(id)
    },
    onSuccess: () => {
      if (!sessionId) return
      void client.invalidateQueries({queryKey: serverDraftsKey(sessionId)})
    },
  })
}
