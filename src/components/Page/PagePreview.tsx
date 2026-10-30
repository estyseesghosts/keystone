// Page preview (P6.5 Pages, slice 6): the draft rendered with the exact
// reader component (`PageView`, PG-7). `formToPreviewPage` is pure
// (author = current account, timestamps = now/saved); image metadata
// resolves through the editor's picked media + `drive.showFile` and lands
// in `attachedFiles`/`eyeCatchingImage` so the default resolver applies.

import {useEffect, useMemo, useState} from 'react'
import {View} from 'react-native'

import type {Account, Backend, Media, PageModel} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Caption} from '#/alf/typography'
import {PageView} from '#/components/Page/PageView'
import {i18n} from '#/locale/i18n'
import {msg} from '@lingui/macro'

import type {PageForm} from '#/state/pageEditor'

/** Draft → publish-shaped page. Pure (timestamps injectable for tests). */
export function formToPreviewPage(
  form: PageForm,
  author: Account,
  saved: PageModel | null,
  now: number,
  media: Map<string, Media>,
): PageModel {
  const attachedFiles = [...media.values()]
  return {
    id: saved?.id ?? 'preview',
    createdAt: saved?.createdAt ?? new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    author,
    title: form.title,
    name: form.name,
    summary: form.summary,
    font: form.font,
    alignCenter: form.alignCenter,
    hideTitleWhenPinned: form.hideTitleWhenPinned,
    eyeCatchingImageId: form.eyeCatchingImageId,
    eyeCatchingImage: form.eyeCatchingImageId ? (media.get(form.eyeCatchingImageId) ?? null) : null,
    attachedFiles,
    blocks: form.blocks,
    likedCount: saved?.likedCount ?? 0,
    isLiked: saved?.isLiked,
    hasLegacyScript: saved?.hasLegacyScript ?? false,
    url: saved?.url ?? '',
  }
}

/** Every file id the draft references (blocks + eye-catch). Pure. */
export function draftFileIds(form: PageForm): string[] {
  const ids: string[] = []
  const walk = (blocks: PageForm['blocks']): void => {
    for (const block of blocks) {
      if (block.kind === 'image' && block.fileId && !ids.includes(block.fileId)) ids.push(block.fileId)
      if (block.kind === 'section') walk(block.children)
    }
  }
  walk(form.blocks)
  if (form.eyeCatchingImageId && !ids.includes(form.eyeCatchingImageId)) ids.push(form.eyeCatchingImageId)
  return ids
}

export function PagePreview({
  form,
  saved,
  author,
  sessionId,
  backend,
  mediaById,
  dirty,
  testID,
}: {
  form: PageForm
  saved: PageModel | null
  author: Account
  sessionId: string | null
  backend: Backend | null
  /** Media picked this session (editor thumbnails). */
  mediaById: Map<string, Media>
  dirty: boolean
  testID?: string
}) {
  const [driveMedia, setDriveMedia] = useState<Map<string, Media>>(new Map())
  const ids = useMemo(() => draftFileIds(form), [form])
  useEffect(() => {
    if (!backend?.drive) return
    let cancelled = false
    const missing = ids.filter(id => !mediaById.has(id))
    if (missing.length === 0) return
    void (async () => {
      const next = new Map<string, Media>()
      for (const id of missing) {
        try {
          const file = await backend.drive!.showFile(id)
          if (!cancelled) next.set(id, file)
        } catch {
          // Unresolvable files render the honest box (slice 2).
        }
      }
      if (!cancelled && next.size > 0) setDriveMedia(next)
    })()
    return () => {
      cancelled = true
    }
  }, [backend, ids, mediaById])
  const media = useMemo(() => new Map([...driveMedia, ...mediaById]), [driveMedia, mediaById])
  const page = useMemo(
    () => formToPreviewPage(form, author, saved, Date.now(), media),
    [form, author, saved, media],
  )
  return (
    <View style={[atoms.flex1, atoms.gap_sm]} testID={testID}>
      <View style={[atoms.px_md, atoms.py_sm]} testID={testID ? `${testID}-banner` : undefined}>
        <Caption color="faint">
          {dirty
            ? i18n._(msg`Preview — not published (unsaved changes)`)
            : i18n._(msg`Preview — not published`)}
        </Caption>
      </View>
      <PageView page={page} sessionId={sessionId} testID={testID ? `${testID}-view` : undefined} />
    </View>
  )
}
