// Drive rows (D3.7 split of `src/screens/Drive.tsx`): folder + file rows,
// the folder scope picker, and the detail-panel primitives. The R2.2
// delete-confirm busy guard (`deleting` in `FileRow`) is preserved
// verbatim — the confirm fires one async `onDelete` and disables itself
// until the promise settles, so a double-tap cannot fire two deletes.

import {useMemo, useState} from 'react'
import {View} from 'react-native'

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
      setError(err instanceof Error ? err.message : 'Could not rename the folder.')
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
            label="Folder name"
            value={draft}
            onChangeText={setDraft}
            placeholder="Folder name"
            error={error ?? undefined}
            testID={`drive-folder-rename-input-${folder.id}`}
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={busy ? 'Saving…' : 'Save'}
              variant="primary"
              disabled={busy || draft.trim().length === 0}
              onPress={() => void save()}
              testID={`drive-folder-rename-save-${folder.id}`}
            />
            <Button
              label="Cancel"
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
          <Caption color="faint">Delete “{folder.name}”? This cannot be undone.</Caption>
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label="Confirm delete"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setBusy(true)
                void onDelete().finally(() => setBusy(false))
              }}
              testID={`drive-folder-delete-confirm-${folder.id}`}
            />
            <Button
              label="Keep"
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
            label="Rename"
            variant="secondary"
            disabled={busy}
            onPress={() => setEditing(true)}
            testID={`drive-folder-rename-${folder.id}`}
          />
          <Button
            label="Delete"
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
        label="Root"
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
      setError(err instanceof Error ? err.message : 'Could not rename the file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`drive-file-${file.id}`}>
      <Body>{file.name}</Body>
      <Caption color="faint">{`${file.kind} · ${file.mimeType}`}</Caption>
      {file.isSensitive ? <Caption color="faint">Sensitive</Caption> : null}
      {editing ? (
        <View style={[atoms.gap_sm]}>
          <TextField
            label="File name"
            value={draft}
            onChangeText={setDraft}
            placeholder="File name"
            error={error ?? undefined}
            testID={`drive-file-rename-input-${file.id}`}
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={busy ? 'Saving…' : 'Save'}
              variant="primary"
              disabled={busy || draft.trim().length === 0}
              onPress={() => void save()}
              testID={`drive-file-rename-save-${file.id}`}
            />
            <Button
              label="Cancel"
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
            label="Details"
            variant="secondary"
            disabled={busy}
            onPress={onOpenDetails}
            testID={`drive-file-details-${file.id}`}
          />
          <Button
            label="Rename"
            variant="secondary"
            disabled={busy}
            onPress={() => setEditing(true)}
            testID={`drive-file-rename-${file.id}`}
          />
          <Button
            label={file.isSensitive ? 'Mark not sensitive' : 'Mark sensitive'}
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setBusy(true)
              setError(null)
              void onToggleSensitive()
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Could not update the file.')
                })
                .finally(() => setBusy(false))
            }}
            testID={`drive-file-sensitive-${file.id}`}
          />
        </View>
      )}
      {pendingDelete ? (
        <View style={[atoms.gap_sm]}>
          <Caption color="faint">Delete “{file.name}”? This cannot be undone.</Caption>
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={deleting ? 'Deleting…' : 'Confirm delete'}
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
              label="Keep"
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
            label="Delete"
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
