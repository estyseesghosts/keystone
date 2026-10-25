import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'

import {
  attachmentCapFor,
  attachmentSizeError,
  FediError,
  fetchComposeLimits,
  formatByteLimit,
  isUploadFileRef,
  kindOfMime,
  type AttachmentCaps,
  type Backend,
  type ComposeLimits,
  type CustomEmoji,
  type KeyValueStore,
  type Page,
  type Post,
  type PostDraft,
  type ScheduledNote,
  type ServerDraft,
  type Session,
  type UploadFileRef,
  type UploadRequestImpl,
  type UploadRequestOpts,
  type UploadRequestResult,
} from '@keystone/fedi'

// Byte-cap helpers live in fedi (`api/composer`, repair X6.2 step 2); the
// composer re-exports them so existing import sites keep working. The
// effective cap is per-kind from the server limits, else the client heap
// bound — never a hard-coded server number.
export {
  attachmentCapFor,
  attachmentSizeError,
  formatByteLimit,
  kindOfMime,
  MAX_MEDIA_BYTES,
  type AttachmentCaps,
  type AttachmentKind,
} from '@keystone/fedi'

import {patchPostInCaches} from '#/state/cache'

import {msg} from '@lingui/macro'

import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'

import {createQueryKey, feedQueryKey} from './keys'
import {throwIfAborted} from './retry'

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

/** Server character/attachment limits for the session's instance.
 * Retry lives in fedi (`fetchComposeLimits` backs off internally), so the
 * query itself does not retry — a dead server surfaces fallback limits
 * once instead of storming it. */
export function useComposeLimits(session: Session | null) {
  return useQuery<ComposeLimits>({
    queryKey: composeLimitsKey(session?.id ?? 'signed-out'),
    enabled: !!session,
    staleTime: LIMITS_STALE,
    retry: false,
    queryFn: ({signal}) => {
      // No signal bag on the limits fetch (repair X3.1): honour a
      // pre-abort, then read (it never throws — defaults on failure).
      throwIfAborted(signal)
      return fetchComposeLimits({origin: session!.origin, family: session!.family})
    },
  })
}

/** The session's own custom emoji (autocomplete source; the standalone
 * EmojiPicker is a separate component with its own data). */
export function useSessionCustomEmojis(session: Session | null, backend: Backend | null) {
  return useQuery<CustomEmoji[]>({
    queryKey: customEmojisKey(session?.id ?? 'signed-out'),
    enabled: !!session && !!backend,
    staleTime: LIMITS_STALE,
    queryFn: ({signal}) => {
      // No signal bag on the emoji read (repair X3.1): honour a pre-abort.
      throwIfAborted(signal)
      return backend!.customEmojis()
    },
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
 * the session's home timeline and the author's own profile tab. Only keys
 * of THIS session are written. Direct and followers-only posts never enter
 * a shared timeline cache; replies go only to the profile/thread caches
 * (never Home/Social); quiet posts (`home`/`unlisted`) never enter Social.
 * A reply also bumps the parent's reply count wherever the parent is
 * cached. Returns the keys written.
 */
export function insertCreatedPost(
  client: QueryClient,
  sessionId: string,
  post: Post,
  replyToId?: string | null,
): string[] {
  const kind = post.visibility?.kind
  const isReply = replyToId != null
  const descriptors: string[] = []
  // Public posts land in Home + Social; quiet stays out of Social; DMs,
  // followers-only, and any reply stay out of both shared timelines.
  if (!isReply && kind !== 'direct' && kind !== 'followers') {
    descriptors.push('timeline|home')
    if (kind !== 'quiet') descriptors.push('timeline|social')
  }
  descriptors.push(`user|${post.author.id}|${replyToId ? 'replies' : 'posts'}`)
  const written: string[] = []
  for (const d of descriptors) {
    // A page fetch racing this insert must not clobber it: cancel first,
    // then write (both run sync here, so no fetch can interleave).
    void client.cancelQueries({queryKey: feedQueryKey(sessionId, d)})
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

/** The create-post mutation, separated from React for tests. */
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

/** Lifecycle of one staged attachment (repair X7.4): `processing` is a
 * real state — the server stored the file but its URL is not ready
 * (Mastodon async media). A row is never `done` with a null URL. */
export type UploadStatus = 'staged' | 'uploading' | 'processing' | 'done' | 'error'

export interface UploadItem {
  key: string
  name: string
  previewUri: string | null
  status: UploadStatus
  /** Server media id once uploaded (including while `processing`). */
  mediaId: string | null
  /** Alt text / description, sent WITH the upload (the Misskey-family
   * `comment` / Mastodon `description`). */
  alt: string
  /** The alt text as it was when the file finished uploading. A later edit
   * is saved through `Backend.updateMedia` on submit (clickstone §1.7), so
   * this is the "what the server already holds" baseline. */
  altAtUpload?: string
  /** Per-attachment sensitive flag, sent WITH the upload on families that
   * take it (`drive/files/create` `isSensitive`). The composer disables
   * the toggle where the server only has status-level `sensitive`, so
   * this is never invented for those servers. */
  sensitive: boolean
  error: string | null
  /** Byte progress of the in-flight upload (repair X7.4 step 1); null when
   * idle or when the transport reports no bytes (honest indeterminate). */
  progress: {loaded: number; total: number | null} | null
  /** MIME of the staged file (repair X7.4 steps 6-7: strip eligibility +
   * the alt-text reminder counts images only). Null when unknown. */
  mimeType: string | null
  /** D9 opt-out (repair X7.4 step 6): when true the original bytes upload
   * unchanged; default false (strip + re-encode). Warns on GPS. */
  keepOriginal: boolean
  /** GPS EXIF seen at pick time (repair X7.4 step 6); null = unknown
   * (no EXIF block to read). Drives the Keep-original warning. */
  hadGps: boolean | null
}

export interface UploadableFile {
  /** Web `File`, or a native `{uri, name, type}` reference (repair X7.4
   * step 3: native uploads never read the whole file into JS). */
  file: File | UploadFileRef
  name: string
  previewUri: string | null
  /** MIME of the source (repair X7.4 steps 6-7). Falls back to the
   * source's own type when omitted. */
  mimeType?: string | null
  /** GPS EXIF seen at pick time; null/omitted = unknown. */
  hadGps?: boolean | null
}

/** MIME of an upload source, preferring the picker's explicit value. */
export function sourceMimeType(
  source: File | UploadFileRef,
  override?: string | null,
): string | null {
  if (override) return override
  if (isUploadFileRef(source)) return source.type || null
  return (source as File).type || null
}

/** Byte size of an upload source, or NaN when unknown (the size guard
 * treats unknown as "server decides", never blocked here). */
export function sourceSize(source: File | UploadFileRef): number {
  if (isUploadFileRef(source)) {
    return typeof source.size === 'number' && Number.isFinite(source.size) && source.size > 0
      ? source.size
      : NaN
  }
  const size = (source as File).size
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : NaN
}

/** Drive targeting for an upload batch (Misskey family). Omitted/`null`
 * folderId means the Drive root, which is the default — the wire field is
 * never sent for root (Sharkey rejects empty fields). `force` is likewise
 * opt-in and keeps the server's duplicate detection when unset. */
export interface UploadTarget {
  folderId?: string | null
  force?: boolean
}

/** MIME types the D9 strip + re-encode applies to (repair X7.4 step 6):
 * JPEG/HEIC stills and PNG (all → JPEG q0.92, orientation baked, metadata
 * dropped). GIF/WebP pass through untouched — animation must survive and
 * stillness is not cheaply knowable. Video/audio pass through (never
 * re-encoded; the once-per-session notice covers them). */
export function strippableMime(mime: string | null | undefined): boolean {
  if (!mime) return false
  const m = mime.toLowerCase().split(';')[0].trim()
  return m === 'image/jpeg' || m === 'image/heic' || m === 'image/heif' || m === 'image/png'
}

/** True for a `blob:`/`data:` URI (web picker output). Anything else
 * (`file://`, `ph://`, `content://`) is a native reference that must
 * never be `fetch`ed whole into JS (repair X7.4 step 3). Pure. */
export function isWebAssetUri(uri: string): boolean {
  return uri.startsWith('blob:') || uri.startsWith('data:')
}

/** Best-effort byte count for a native URI (repair X7.4 step 3: the
 * picker's `fileSize` is absent for some library assets). `expo-file-system`
 * is a TRANSITIVE dep (undeclared) — it is dynamically imported and never
 * relied on: absence (or any failure) resolves null (unknown), and the
 * upload-time guard + server stay the verdict. Pure-ish (one guarded
 * import, no state). */
export async function probeNativeFileSize(uri: string): Promise<number | null> {
  try {
    const FS = (await import('expo-file-system')) as unknown as {
      getInfoAsync?: (uri: string) => Promise<{exists?: boolean; size?: number} | null>
    }
    if (typeof FS?.getInfoAsync !== 'function') return null
    const info = await FS.getInfoAsync(uri)
    return typeof info?.size === 'number' && info.size > 0 ? info.size : null
  } catch {
    return null
  }
}

function createObjectUrl(file: File): string | null {
  try {
    const URL_ = (
      globalThis as unknown as {URL?: {createObjectURL?: (f: Blob) => string}}
    ).URL
    return URL_?.createObjectURL?.(file) ?? null
  } catch {
    return null
  }
}

function revokeObjectUrl(url: string): void {
  try {
    const URL_ = (
      globalThis as unknown as {URL?: {revokeObjectURL?: (u: string) => void}}
    ).URL
    URL_?.revokeObjectURL?.(url)
  } catch {
    // Best-effort: a leaked object URL is reclaimed with the document.
  }
}

/** Re-encode one image through `expo-image-manipulator` (JPEG q0.92),
 * which drops EXIF/GPS metadata and bakes the orientation in (repair X7.4
 * step 6, D9 default ON). Non-strippable sources pass through untouched.
 * A missing/failed manipulator falls back to the original source (an
 * upload proceeds with original bytes rather than failing the post).
 * Web Files round-trip through an object URL; native references stay
 * references (the manipulator output URI becomes the new reference). */
export async function stripImageForUpload(
  source: File | UploadFileRef,
  name: string,
  mime: string | null | undefined,
): Promise<{source: File | UploadFileRef; stripped: boolean}> {
  if (!strippableMime(mime)) return {source, stripped: false}
  let Manip: typeof import('expo-image-manipulator')
  try {
    Manip = await import('expo-image-manipulator')
  } catch {
    return {source, stripped: false}
  }
  const base = name.replace(/\.[a-z0-9]+$/i, '') || 'upload'
  const outName = `${base}.jpg`
  const inUri = isUploadFileRef(source) ? source.uri : createObjectUrl(source)
  if (!inUri) return {source, stripped: false}
  const isRef = isUploadFileRef(source)
  try {
    const out = await Manip.manipulateAsync(inUri, [], {
      compress: 0.92,
      format: Manip.SaveFormat.JPEG,
    })
    if (!out?.uri || out.uri === inUri) return {source, stripped: false}
    if (isRef) {
      const size = await probeNativeFileSize(out.uri)
      return {
        source: {uri: out.uri, name: outName, type: 'image/jpeg', size},
        stripped: true,
      }
    }
    const res = await fetch(out.uri)
    const blob = await res.blob()
    return {source: new File([blob], outName, {type: 'image/jpeg'}), stripped: true}
  } catch {
    return {source, stripped: false}
  } finally {
    if (!isRef) revokeObjectUrl(inUri)
  }
}

/** Minimal structural XHR surface (repair X7.4 step 1): declared locally
 * so this file typechecks for native targets too — the implementation
 * only ever runs on web. */
interface XhrSender {
  open(method: string, url: string): void
  setRequestHeader(name: string, value: string): void
  send(body: unknown): void
  abort(): void
  status: number
  responseText: string
  responseURL: string
  upload?: {onprogress: ((ev: {loaded: number; total: number}) => void) | null} | undefined
  onload: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
}

function xhrAbortError(): Error {
  const err = new Error('Request was cancelled.')
  err.name = 'AbortError'
  return err
}

/** Web multipart sender over `XMLHttpRequest` (repair X7.4 step 1): the
 * only path with byte progress (`upload.onprogress`). XHR follows
 * redirects itself, so the final URL rides along for the transport's
 * origin check. Honors `signal`; the deadline/stall timers stay with the
 * transport (no `xhr.timeout` — one owner for the deadline). Rejects with
 * an `AbortError`-named error on cancel so the transport maps it exactly
 * like a fetch abort. */
export function webXhrUpload(req: UploadRequestOpts): Promise<UploadRequestResult> {
  return new Promise((resolve, reject) => {
    const Ctor = (
      globalThis as unknown as {XMLHttpRequest?: new () => XhrSender}
    ).XMLHttpRequest
    if (!Ctor) {
      reject(
        new FediError(
          `Could not upload to ${req.url} (no XMLHttpRequest on this web runtime).`,
          'errors.network.unreachableBare',
          {origin: req.url, reason: 'no XMLHttpRequest'},
        ),
      )
      return
    }
    const xhr = new Ctor()
    let settled = false
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true
        fn()
      }
    }
    const detach = () => req.signal?.removeEventListener('abort', onAbort)
    const onAbort = () => {
      try {
        xhr.abort()
      } catch {
        // Already settled: `onabort` below still maps the outcome.
      }
    }
    if (req.signal?.aborted) {
      reject(xhrAbortError())
      return
    }
    xhr.open(req.method, req.url)
    for (const [k, v] of Object.entries(req.headers)) {
      try {
        xhr.setRequestHeader(k, v)
      } catch {
        // A forbidden header (e.g. set by the transport on a locked-down
        // WebView): the send still goes; auth comes from the form fields
        // on the Misskey family.
      }
    }
    req.signal?.addEventListener('abort', onAbort, {once: true})
    if (xhr.upload) {
      xhr.upload.onprogress = ev => {
        try {
          req.onProgress?.(ev.loaded, ev.total > 0 ? ev.total : null)
        } catch {
          // A throwing listener must not fail the upload.
        }
      }
    }
    xhr.onload = () => {
      detach()
      settle(() =>
        resolve({
          status: xhr.status,
          bodyText: xhr.responseText,
          responseUrl: xhr.responseURL || undefined,
        }),
      )
    }
    xhr.onerror = () => {
      detach()
      settle(() =>
        reject(
          new FediError(
            `Could not reach ${req.url} (network error).`,
            'errors.network.unreachableBare',
            {origin: req.url, reason: 'network error'},
          ),
        ),
      )
    }
    xhr.onabort = () => {
      detach()
      settle(() => reject(xhrAbortError()))
    }
    try {
      xhr.send(req.body)
    } catch (err) {
      detach()
      settle(() => reject(err instanceof Error ? err : new Error('Upload failed.')))
    }
  })
}

/** "Remind me to add alt text" pref (repair X7.4 step 7, default off): a
 * single device-global key — NOT the versioned device schema, so no
 * schema migration and no churn in the schema/appearance suites. Survives
 * sign-out like other device prefs; best-effort on write failure. */
const REMIND_ALT_KEY = 'keystone.remindAltText'

export function readRemindAltText(store: KeyValueStore): boolean {
  try {
    return store.getItem(REMIND_ALT_KEY) === '1'
  } catch {
    return false
  }
}

export function writeRemindAltText(store: KeyValueStore, value: boolean): void {
  try {
    if (value) store.setItem(REMIND_ALT_KEY, '1')
    else store.removeItem(REMIND_ALT_KEY)
  } catch {
    // Best-effort (repair X1.3 S12 discipline): the in-memory choice still
    // applies for this mount.
  }
}

/** Once-per-session video-metadata notice (repair X7.4 step 6): videos are
 * never re-encoded, so their metadata ships unchanged — said once, then
 * dismissed for the session. Module state keyed by session id (no store
 * shape change); the test seam resets it. */
const videoNoticedSessions = new Set<string>()

export function shouldShowVideoNotice(sessionId: string, hasVideo: boolean): boolean {
  return hasVideo && !videoNoticedSessions.has(sessionId)
}

export function dismissVideoNotice(sessionId: string): void {
  videoNoticedSessions.add(sessionId)
}

export function resetVideoNoticesForTests(): void {
  videoNoticedSessions.clear()
}

/** True for a caller-cancellation failure in either fedi error class
 * (`kind: 'aborted'` survives the transports' adaptation). Pure. */
function isAbortedUpload(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as {kind?: unknown; code?: unknown}).kind === 'aborted'
  )
}

/** Upload one file through the owning session's backend. The per-file
 * `sensitive` flag rides WITH the upload (Misskey-family `isSensitive`);
 * when false/absent the field is never sent, so a default upload keeps the
 * server's non-sensitive default. */
export async function uploadOne(
  backend: Backend,
  file: File | UploadFileRef,
  opts: {
    alt?: string
    sensitive?: boolean
    target?: UploadTarget
    /** Display name (drives the stripped output name); defaults to the
     * source's own name. */
    name?: string
    /** MIME override (the picker's explicit value); defaults to the
     * source's own type. */
    mimeType?: string | null
    /** D9 opt-out (repair X7.4 step 6): skip the strip + re-encode. */
    keepOriginal?: boolean
    signal?: AbortSignal
    onProgress?: (loaded: number, total: number | null) => void
    uploadImpl?: UploadRequestImpl
  } = {},
): Promise<{id: string; processing: boolean}> {
  const {alt = '', sensitive = false, target = {}} = opts
  const mime = sourceMimeType(file, opts.mimeType)
  // D9 default (repair X7.4 step 6): strip + re-encode unless the upload
  // opted out with Keep-original. The stripped source (smaller, metadata-
  // free) is what the guards and the transport see.
  const finalSource = opts.keepOriginal
    ? file
    : (
        await stripImageForUpload(file, opts.name ?? file.name ?? 'upload', mime)
      ).source
  const media = await backend.uploadMedia(finalSource, {
    ...(alt ? {comment: alt} : {}),
    ...(sensitive ? {isSensitive: true} : {}),
    ...(target.folderId ? {folderId: target.folderId} : {}),
    ...(target.force !== undefined ? {force: target.force} : {}),
    ...(opts.signal ? {signal: opts.signal} : {}),
    ...(opts.onProgress ? {onProgress: opts.onProgress} : {}),
    ...(opts.uploadImpl ? {uploadImpl: opts.uploadImpl} : {}),
  })
  // A null URL IS the processing state (Mastodon async media, M13) — the
  // caller renders "still processing", never `done`.
  return {id: media.id, processing: media.url == null}
}

/** Per-run hooks for `uploadAll` (repair X7.4): cancellation, progress,
 * and the sender override are supplied by the owning hook (`useUploads`);
 * direct callers (tests, Drive) omit them for the sequential default. */
export interface UploadRunOpts {
  /** Max parallel uploads (repair X7.4 step 4); default 3, minimum 1. */
  concurrency?: number
  /** Per-item abort signal (repair X7.4 step 1); absent = not cancellable. */
  signalFor?: (key: string) => AbortSignal | undefined
  /** Per-item byte progress (repair X7.4 step 1). */
  onProgress?: (key: string, loaded: number, total: number | null) => void
  /** Per-item sender override (web XHR for byte progress). */
  implFor?: (key: string, source: File | UploadFileRef) => UploadRequestImpl | undefined
}

/**
 * Upload every not-yet-done item with up to `concurrency` parallel
 * requests (repair X7.4 step 4), reporting per-item status (`onUpdate`).
 * Returns the media ids in ITEM order, or null if any failed (the failure
 * stays on its item for retry; successful items are never re-sent —
 * `uploadAll` keeps successes on retry).
 *
 * Neither transport reports bytes, so progress is per-file state unless
 * the run supplies `onProgress` (web XHR).
 *
 * `processing` rows (M13: stored, URL not ready) are re-checked through
 * `Backend.updateMedia` when the backend offers it — the description write
 * doubles as the read-back, so a finished row flips to `done` with its
 * current alt text and no extra request shape is needed. A row that is
 * still processing keeps its id (the server accepts processing
 * attachments) but is never marked `done` with a null URL.
 *
 * `target` carries the Drive folder (and optional `force`) for this batch;
 * the default is the Drive root.
 */
export async function uploadAll(
  backend: Backend,
  items: UploadItem[],
  files: Map<string, File | UploadFileRef>,
  onUpdate: (key: string, patch: Partial<UploadItem>) => void,
  target: UploadTarget = {},
  caps: AttachmentCaps | null = null,
  run: UploadRunOpts = {},
): Promise<string[] | null> {
  const live = items.filter(i => files.has(i.key))
  const idFor = new Map<string, string>()
  for (const item of live) {
    if ((item.status === 'done' || item.status === 'processing') && item.mediaId) {
      idFor.set(item.key, item.mediaId)
    }
  }
  // Repair X6.1 F3: keys no longer in `files` (removed while the submit was
  // in flight) are skipped below — a removed upload never attaches its id
  // and never fails the submit with an error on a row that no longer
  // exists. Edit-only in intent (the composer disables Remove while
  // busy); safe for create mode too — a removed file must never send.
  let failed = false
  // Phase 1 — re-check `processing` rows (M13): one description write per
  // row doubles as the freshness read. Sequential and cheap; a row the
  // server now has ready flips to `done`, the rest keep their ids.
  if (backend.updateMedia) {
    for (const item of live) {
      if (item.status !== 'processing' || !item.mediaId) continue
      try {
        const fresh = await backend.updateMedia(item.mediaId, {description: item.alt})
        if (fresh?.url != null) {
          onUpdate(item.key, {status: 'done', altAtUpload: item.alt, progress: null})
        }
      } catch {
        // Best-effort: the id stays attachable; the row stays `processing`
        // and the post still goes through with the honest label.
      }
    }
  }
  // Phase 2 — upload what still needs bytes, up to `concurrency` at once.
  const pending = live.filter(i => !idFor.has(i.key))
  const limit = Math.max(1, Math.floor(run.concurrency ?? 3) || 3)
  const progressHook = run.onProgress
  let cursor = 0
  const uploadNext = async (): Promise<void> => {
    const item = pending[cursor++]
    if (!item) return
    const file = files.get(item.key)
    if (!file) {
      // Unreachable after the `live` filter (a present key always has its
      // source); kept as an honest fallback that never attaches.
      await uploadNext()
      return
    }
    // Client bound (R2.3 + repair X6.2 step 2): a known over-cap size never
    // reaches the transport — the failure stays on its item for the user
    // to remove, like any error. The cap is per-kind from the server
    // limits, else the client heap bound; the message carries the real
    // number that applied.
    const mime = item.mimeType ?? sourceMimeType(file, null)
    const kind = kindOfMime(mime)
    const tooBig = attachmentSizeError(item.name, sourceSize(file), caps, kind)
    if (tooBig) {
      // The fedi message stays unrendered (never display text from the
      // data layer): the row shows the same localized refusal the picker
      // path renders, with the real cap that applied.
      onUpdate(item.key, {
        status: 'error',
        error: i18n._(msg`"${item.name}" is too large to attach (limit ${formatByteLimit(attachmentCapFor(kind, caps))}).`),
        progress: null,
      })
      failed = true
      await uploadNext()
      return
    }
    onUpdate(item.key, {status: 'uploading', error: null, progress: null})
    try {
      const {id, processing} = await uploadOne(backend, file, {
        alt: item.alt,
        sensitive: item.sensitive,
        target,
        name: item.name,
        mimeType: mime,
        keepOriginal: item.keepOriginal,
        signal: run.signalFor?.(item.key),
        onProgress: progressHook ? (loaded, total) => progressHook(item.key, loaded, total) : undefined,
        uploadImpl: run.implFor?.(item.key, file),
      })
      if (processing) {
        onUpdate(item.key, {status: 'processing', mediaId: id, altAtUpload: item.alt, progress: null})
      } else {
        onUpdate(item.key, {status: 'done', mediaId: id, altAtUpload: item.alt, progress: null})
      }
      idFor.set(item.key, id)
    } catch (err) {
      if (isAbortedUpload(err)) {
        // Explicit Cancel (repair X7.4 step 1): back to staged for retry.
        // The batch still fails so the post never drops the file silently.
        onUpdate(item.key, {status: 'staged', error: null, progress: null})
      } else {
        onUpdate(item.key, {
          status: 'error',
          error: errorText(i18n, err, i18n._(msg`Upload failed.`)),
          progress: null,
        })
      }
      failed = true
    }
    await uploadNext()
  }
  await Promise.all(Array.from({length: Math.min(limit, pending.length)}, () => uploadNext()))
  const ids: string[] = []
  for (const item of live) {
    const id = idFor.get(item.key)
    if (id) ids.push(id)
  }
  return failed ? null : ids
}

export function useUploads(
  backend: Backend | null,
  target: UploadTarget = {},
  caps: AttachmentCaps | null = null,
) {
  const [items, setItems] = useState<UploadItem[]>([])
  const files = useMemo(() => new Map<string, File | UploadFileRef>(), [])
  const itemsRef = useRef(items)
  itemsRef.current = items
  // Per-item abort controllers (repair X7.4 step 1): one live controller
  // per key, created at upload start and replaced after it settles or
  // aborts, so Cancel/Remove always reach the in-flight request and a
  // retry never reuses a dead signal.
  const controllers = useMemo(() => new Map<string, AbortController>(), [])
  // The batch target is read at upload time (a folder chosen after staging
  // still applies); a fresh object literal from the caller never re-creates
  // `ensureUploaded`.
  const targetRef = useRef(target)
  targetRef.current = target
  // Server caps move with the limits query; the ref keeps `add` and
  // `ensureUploaded` stable while the numbers stay current.
  const capsRef = useRef(caps)
  capsRef.current = caps
  const backendRef = useRef(backend)
  backendRef.current = backend

  const patch = useCallback((key: string, p: Partial<UploadItem>) => {
    setItems(cur => cur.map(i => (i.key === key ? {...i, ...p} : i)))
  }, [])

  const signalFor = useCallback(
    (key: string): AbortSignal => {
      const cur = controllers.get(key)
      if (cur && !cur.signal.aborted) return cur.signal
      const fresh = new AbortController()
      controllers.set(key, fresh)
      return fresh.signal
    },
    [controllers],
  )

  // Abort every in-flight upload on unmount (repair X7.4 step 1): uploads
  // belong to this composer — navigating away never leaves them running
  // against state that is gone.
  useEffect(
    () => () => {
      for (const c of controllers.values()) {
        try {
          c.abort()
        } catch {
          // Already settled: nothing to cancel.
        }
      }
      controllers.clear()
    },
    [controllers],
  )

  const add = useCallback(
    (picked: UploadableFile[]): Array<{name: string; limit: number; reason: 'too-large'}> => {
      // Client bound (R2.3 + repair X6.2 step 2): over-cap Files are refused
      // before staging — they never enter `files`, so `ensureUploaded`
      // cannot send them. Returns the refused names WITH the cap that
      // applied so the caller reports the real number honestly.
      const refused: Array<{name: string; limit: number; reason: 'too-large'}> = []
      const created: Array<{key: string; p: UploadableFile}> = []
      for (const [i, p] of picked.entries()) {
        const mime = p.mimeType ?? sourceMimeType(p.file, null)
        const kind = kindOfMime(mime)
        const tooBig = attachmentSizeError(p.name, sourceSize(p.file), capsRef.current, kind)
        if (tooBig) {
          refused.push({name: p.name, limit: attachmentCapFor(kind, capsRef.current), reason: 'too-large'})
          continue
        }
        created.push({
          key: `u${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 5)}`,
          p,
        })
      }
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
            sensitive: false,
            error: null,
            progress: null,
            mimeType: p.mimeType ?? sourceMimeType(p.file, null),
            keepOriginal: false,
            hadGps: p.hadGps ?? null,
          }),
        ),
      ])
      return refused
    },
    [files],
  )

  /** Cancel one in-flight upload (repair X7.4 step 1): the request aborts
   * and the row returns to `staged` for retry (the worker maps the abort).
   * An idle row is untouched. */
  const cancel = useCallback(
    (key: string) => {
      controllers.get(key)?.abort()
    },
    [controllers],
  )

  const remove = useCallback(
    (key: string) => {
      // Removing an item aborts its request (repair X7.4 step 1) ...
      controllers.get(key)?.abort()
      controllers.delete(key)
      const item = itemsRef.current.find(i => i.key === key)
      files.delete(key)
      setItems(cur => cur.filter(i => i.key !== key))
      // ... and, when the server already stored it, issues a best-effort
      // delete. Misskey removes the Drive file; Mastodon has no media
      // delete, so the id is just dropped. Never blocks the UI.
      const mediaId = item?.mediaId
      if (mediaId && (item?.status === 'done' || item?.status === 'processing')) {
        void backendRef.current?.drive?.deleteFile(mediaId)?.catch(() => {})
      }
    },
    [controllers, files],
  )

  /** Alt text: sent with the upload, and — where the backend exposes
   * `updateMedia` — still editable afterwards (saved on submit). */
  const setAlt = useCallback((key: string, alt: string) => patch(key, {alt}), [patch])

  /** Per-file sensitive flag; applied when the upload runs. */
  const setSensitive = useCallback(
    (key: string, sensitive: boolean) => patch(key, {sensitive}),
    [patch],
  )

  /** D9 opt-out (repair X7.4 step 6): send this upload's original bytes
   * unchanged. Applies to the next upload run; fixed once sent. */
  const setKeepOriginal = useCallback(
    (key: string, keepOriginal: boolean) => patch(key, {keepOriginal}),
    [patch],
  )

  const ensureUploaded = useCallback(async (): Promise<string[] | null> => {
    if (!backend) return null
    return uploadAll(backend, itemsRef.current, files, patch, targetRef.current, capsRef.current, {
      concurrency: 3,
      signalFor,
      onProgress: (key, loaded, total) => patch(key, {progress: {loaded, total}}),
      implFor: (_key, source) => (isUploadFileRef(source) ? undefined : webXhrUpload),
    })
  }, [backend, files, patch, signalFor])

  const clear = useCallback(() => {
    for (const c of controllers.values()) {
      try {
        c.abort()
      } catch {
        // Already settled.
      }
    }
    controllers.clear()
    files.clear()
    setItems([])
  }, [controllers, files])

  return {items, add, remove, cancel, setAlt, setSensitive, setKeepOriginal, ensureUploaded, clear}
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
    queryFn: ({signal}) => backend!.scheduled!.list({...(signal ? {signal} : {})}),
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
    queryFn: ({signal}) => backend!.serverDrafts!.list({...(signal ? {signal} : {})}),
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
