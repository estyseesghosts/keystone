// Drive rows (D3.7 split of `src/screens/Drive.tsx`): folder + file rows,
// the folder scope picker, and the detail-panel primitives. The R2.2
// delete-confirm busy guard (`deleting` in `FileRow`) is preserved
// verbatim — the confirm fires one async `onDelete` and disables itself
// until the promise settles, so a double-tap cannot fire two deletes.

import {useMemo, useState} from 'react'
import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  displayNameOf,
  handleOf,
  type DriveFolder,
  type Media,
  type Post,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {postBodyNodes} from '#/components/Post/body'
import {RichText} from '#/components/RichText'
import {i18n} from '#/locale/i18n'

/** Human byte size for the detail panel (`null` stays honestly unknown). */
export function formatBytes(size: number | null): string {
  if (size == null || !Number.isFinite(size) || size < 0) return 'Unknown'
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function FolderRow({
  folder,
  onRename,
  onDelete,
  pendingDelete,
  onArmDelete,
  onCancelDelete,
}: {
  folder: DriveFolder
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  pendingDelete: boolean
  onArmDelete: () => void
  onCancelDelete: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(folder.name)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await onRename(trimmed)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n._(msg`Could not rename the folder.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`drive-folder-${folder.id}`}>
      <Body>{folder.name}</Body>
      {editing ? (
        <View style={[atoms.gap_sm]}>
          <TextField
            label={i18n._(msg({message: 'Folder name', context: 'drive folder name input'}))}
            value={draft}
            onChangeText={setDraft}
            placeholder={i18n._(msg({message: 'Folder name', context: 'drive folder name input'}))}
            error={error ?? undefined}
            testID={`drive-folder-rename-input-${folder.id}`}
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={
                busy
                  ? i18n._(msg({message: 'Saving…', context: 'button'}))
                  : i18n._(msg({message: 'Save', context: 'button'}))
              }
              variant="primary"
              disabled={busy || draft.trim().length === 0}
              onPress={() => void save()}
              testID={`drive-folder-rename-save-${folder.id}`}
            />
            <Button
              label={i18n._(msg({message: 'Cancel', context: 'button'}))}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setEditing(false)
                setDraft(folder.name)
              }}
              testID={`drive-folder-rename-cancel-${folder.id}`}
            />
          </View>
        </View>
      ) : null}
      {error && !editing ? <Caption color="faint">{error}</Caption> : null}
      {editing ? null : pendingDelete ? (
        <View style={[atoms.gap_sm]}>
          <Caption color="faint">
            {i18n._(msg`Delete “${folder.name}”? This cannot be undone.`)}
          </Caption>
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={i18n._(msg({message: 'Confirm delete', context: 'button'}))}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setBusy(true)
                void onDelete().finally(() => setBusy(false))
              }}
              testID={`drive-folder-delete-confirm-${folder.id}`}
            />
            <Button
              label={i18n._(msg({message: 'Keep', context: 'button', comment: 'Keep the folder; cancel deletion'}))}
              variant="secondary"
              disabled={busy}
              onPress={onCancelDelete}
              testID={`drive-folder-delete-cancel-${folder.id}`}
            />
          </View>
        </View>
      ) : (
        <View style={[atoms.row, atoms.gap_sm]}>
          <Button
            label={i18n._(msg({message: 'Rename', context: 'button'}))}
            variant="secondary"
            disabled={busy}
            onPress={() => setEditing(true)}
            testID={`drive-folder-rename-${folder.id}`}
          />
          <Button
            label={i18n._(msg({message: 'Delete', context: 'button'}))}
            variant="secondary"
            disabled={busy}
            onPress={onArmDelete}
            testID={`drive-folder-delete-${folder.id}`}
          />
        </View>
      )}
    </View>
  )
}

export function FolderScope({
  folders,
  selectedId,
  onSelect,
}: {
  folders: DriveFolder[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <View
      style={[atoms.row, atoms.gap_sm, atoms.px_md, {flexWrap: 'wrap'}]}
      testID="drive-folder-scope">
      <Button
        label={i18n._(msg({message: 'Root', context: 'drive root folder'}))}
        variant={selectedId === null ? 'primary' : 'secondary'}
        onPress={() => onSelect(null)}
        testID="drive-folder-scope-root"
      />
      {folders.map(folder => (
        <Button
          key={folder.id}
          label={folder.name}
          variant={selectedId === folder.id ? 'primary' : 'secondary'}
          onPress={() => onSelect(folder.id)}
          testID={`drive-folder-scope-${folder.id}`}
        />
      ))}
    </View>
  )
}

export function FileRow({
  file,
  onRename,
  onToggleSensitive,
  onDelete,
  onOpenDetails,
  pendingDelete,
  onArmDelete,
  onCancelDelete,
}: {
  file: Media
  onRename: (name: string) => Promise<void>
  onToggleSensitive: () => Promise<void>
  onDelete: () => Promise<void>
  onOpenDetails: () => void
  pendingDelete: boolean
  onArmDelete: () => void
  onCancelDelete: () => void
}) {
  const [draft, setDraft] = useState(file.name)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  // Delete-confirm busy guard: the confirm fires one async `onDelete` and
  // disables itself until the promise settles, so a double-tap cannot fire
  // two `deleteFile` calls. `busy` belongs to the rename flow; delete gets
  // its own flag.
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await onRename(trimmed)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n._(msg`Could not rename the file.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`drive-file-${file.id}`}>
      <Body>{file.name}</Body>
      <Caption color="faint">{`${file.kind} · ${file.mimeType}`}</Caption>
      {file.isSensitive ? (
        <Caption color="faint">{i18n._(msg({message: 'Sensitive', context: 'drive file flag'}))}</Caption>
      ) : null}
      {editing ? (
        <View style={[atoms.gap_sm]}>
          <TextField
            label={i18n._(msg({message: 'File name', context: 'drive file name input'}))}
            value={draft}
            onChangeText={setDraft}
            placeholder={i18n._(msg({message: 'File name', context: 'drive file name input'}))}
            error={error ?? undefined}
            testID={`drive-file-rename-input-${file.id}`}
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={
                busy
                  ? i18n._(msg({message: 'Saving…', context: 'button'}))
                  : i18n._(msg({message: 'Save', context: 'button'}))
              }
              variant="primary"
              disabled={busy || draft.trim().length === 0}
              onPress={() => void save()}
              testID={`drive-file-rename-save-${file.id}`}
            />
            <Button
              label={i18n._(msg({message: 'Cancel', context: 'button'}))}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setEditing(false)
                setDraft(file.name)
              }}
              testID={`drive-file-rename-cancel-${file.id}`}
            />
          </View>
        </View>
      ) : (
        <View style={[atoms.row, atoms.gap_sm, {flexWrap: 'wrap'}]}>
          <Button
            label={i18n._(msg({message: 'Details', context: 'button', comment: 'Open file details'}))}
            variant="secondary"
            disabled={busy}
            onPress={onOpenDetails}
            testID={`drive-file-details-${file.id}`}
          />
          <Button
            label={i18n._(msg({message: 'Rename', context: 'button'}))}
            variant="secondary"
            disabled={busy}
            onPress={() => setEditing(true)}
            testID={`drive-file-rename-${file.id}`}
          />
          <Button
            label={
              file.isSensitive
                ? i18n._(msg`Mark not sensitive`)
                : i18n._(msg`Mark sensitive`)
            }
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setBusy(true)
              setError(null)
              void onToggleSensitive()
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : i18n._(msg`Could not update the file.`))
                })
                .finally(() => setBusy(false))
            }}
            testID={`drive-file-sensitive-${file.id}`}
          />
        </View>
      )}
      {pendingDelete ? (
        <View style={[atoms.gap_sm]}>
          <Caption color="faint">
            {i18n._(msg`Delete “${file.name}”? This cannot be undone.`)}
          </Caption>
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={
                deleting
                  ? i18n._(msg({message: 'Deleting…', context: 'button'}))
                  : i18n._(msg({message: 'Confirm delete', context: 'button'}))
              }
              variant="secondary"
              disabled={busy || deleting}
              onPress={() => {
                if (deleting) return
                setDeleting(true)
                void onDelete().finally(() => setDeleting(false))
              }}
              testID={`drive-file-delete-confirm-${file.id}`}
            />
            <Button
              label={i18n._(msg({message: 'Keep', context: 'button', comment: 'Keep the file; cancel deletion'}))}
              variant="secondary"
              disabled={busy || deleting}
              onPress={onCancelDelete}
              testID={`drive-file-delete-cancel-${file.id}`}
            />
          </View>
        </View>
      ) : (
        <View style={[atoms.row, atoms.gap_sm]}>
          <Button
            label={i18n._(msg({message: 'Delete', context: 'button'}))}
            variant="secondary"
            disabled={busy}
            onPress={onArmDelete}
            testID={`drive-file-delete-${file.id}`}
          />
        </View>
      )}
      {error && !editing ? <Caption color="faint">{error}</Caption> : null}
    </View>
  )
}

export function MetaRow({label, value, testID}: {label: string; value: string; testID?: string}) {
  return (
    <View style={[atoms.row, atoms.gap_sm]} testID={testID}>
      <Caption color="faint">{label}</Caption>
      <Body style={{flexShrink: 1}}>{value}</Body>
    </View>
  )
}

export function AttachedNoteRow({post, sessionId}: {post: Post; sessionId: string}) {
  const nodes = useMemo(() => postBodyNodes(post), [post])
  return (
    <View style={[atoms.gap_sm]} testID={`drive-detail-note-${post.id}`}>
      <Caption color="faint">
        {`${displayNameOf(post.author)} ${handleOf(post.author)} · ${post.createdAt}`}
      </Caption>
      <RichText nodes={nodes} sessionId={sessionId} authorHost={post.author.host} />
    </View>
  )
}
