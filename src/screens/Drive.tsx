// Drive as a library (`/drive`, clickstone §1.10): folders, folder-scoped
// files, upload from the screen itself, and file detail (`drive/files/show`
// + `drive/files/attached-notes`).
//
// Capability gating: the whole screen is honest "not available" without a
// `backend.drive` module (Pinetree/Mastodon). The folder section only
// renders when `drive.folders` exists. A detail endpoint that 404s at
// runtime keeps its section visible with the reason — never hidden, never
// an inert control, never a fake note count.
//
// Uploads use the composer's existing picker seam (expo-image-picker via
// `pickMedia`) and the required `Backend.uploadMedia`; neither transport
// reports bytes, so progress is per-file state ("Uploading…").

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {FlatList, RefreshControl, ScrollView, View} from 'react-native'

import {
  displayNameOf,
  handleOf,
  isPermissionError,
  isUnsupportedError,
  type Backend,
  type Cursor,
  type DriveFolder,
  type Media,
  type Post,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {pickMedia} from '#/components/Composer/pickMedia'
import {Dialog} from '#/components/Dialog'
import {TextField} from '#/components/forms/TextField'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {postBodyNodes} from '#/components/Post/body'
import {RichText} from '#/components/RichText'
import {SignInButton} from '#/components/SignInButton'
import type {UploadableFile} from '#/state/queries/composer'
import {useActiveBackend} from '#/screens/HomeFeed'

const FILES_PAGE = 20
const NOTES_PAGE = 10

/** Human byte size for the detail panel (`null` stays honestly unknown). */
function formatBytes(size: number | null): string {
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

function FolderRow({
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

function FolderScope({
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

function UploadPanel({
  targetLabel,
  staged,
  comment,
  uploading,
  error,
  success,
  onChoose,
  onCommentChange,
  onUpload,
  onCancel,
}: {
  targetLabel: string
  staged: UploadableFile | null
  comment: string
  uploading: boolean
  error: string | null
  success: string | null
  onChoose: () => void
  onCommentChange: (value: string) => void
  onUpload: () => void
  onCancel: () => void
}) {
  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID="drive-upload">
      <Caption color="faint">{targetLabel}</Caption>
      {staged ? (
        <View style={[atoms.gap_sm]}>
          <Body>{staged.name}</Body>
          <TextField
            label="Description (optional)"
            value={comment}
            onChangeText={onCommentChange}
            placeholder="Alt text or caption"
            testID="drive-upload-comment"
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={uploading ? 'Uploading…' : 'Upload'}
              variant="primary"
              disabled={uploading}
              onPress={onUpload}
              testID="drive-upload-submit"
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={uploading}
              onPress={onCancel}
              testID="drive-upload-cancel"
            />
          </View>
          {uploading ? (
            <Caption color="faint" testID="drive-upload-progress">
              {`Uploading “${staged.name}”…`}
            </Caption>
          ) : null}
        </View>
      ) : (
        <Button
          label="Choose file"
          variant="secondary"
          disabled={uploading}
          onPress={onChoose}
          testID="drive-upload-choose"
        />
      )}
      {error ? (
        <Caption color="faint" testID="drive-upload-error">
          {error}
        </Caption>
      ) : null}
      {success ? (
        <Caption color="faint" testID="drive-upload-success">
          {success}
        </Caption>
      ) : null}
    </View>
  )
}

function FileRow({
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
              label="Confirm delete"
              variant="secondary"
              disabled={busy}
              onPress={() => void onDelete()}
              testID={`drive-file-delete-confirm-${file.id}`}
            />
            <Button
              label="Keep"
              variant="secondary"
              disabled={busy}
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

function MetaRow({label, value, testID}: {label: string; value: string; testID?: string}) {
  return (
    <View style={[atoms.row, atoms.gap_sm]} testID={testID}>
      <Caption color="faint">{label}</Caption>
      <Body style={{flexShrink: 1}}>{value}</Body>
    </View>
  )
}

function AttachedNoteRow({post, sessionId}: {post: Post; sessionId: string}) {
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

type NotesState = 'loading' | 'ready' | 'unsupported' | 'denied' | 'error'

function FileDetailDialog({
  file,
  backend,
  sessionId,
  onClose,
}: {
  file: Media
  backend: Backend
  sessionId: string
  onClose: () => void
}) {
  const drive = backend.drive
  const [media, setMedia] = useState<Media>(file)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailUnsupported, setDetailUnsupported] = useState(false)
  const [notes, setNotes] = useState<Post[]>([])
  const [notesState, setNotesState] = useState<NotesState>('loading')
  const [notesError, setNotesError] = useState<string | null>(null)
  const [notesCursor, setNotesCursor] = useState<Cursor | null>(null)
  const [notesHasMore, setNotesHasMore] = useState(false)
  const [notesLoadingMore, setNotesLoadingMore] = useState(false)

  const loadDetail = useCallback(async () => {
    if (!drive) return
    setDetailError(null)
    setDetailUnsupported(false)
    try {
      setMedia(await drive.showFile(file.id))
    } catch (err) {
      if (isUnsupportedError(err)) setDetailUnsupported(true)
      else if (isPermissionError(err)) setDetailError('Your account cannot view this file.')
      else setDetailError(err instanceof Error ? err.message : 'Could not load file details.')
    }
  }, [drive, file.id])

  const loadNotes = useCallback(async () => {
    if (!drive) return
    setNotesState('loading')
    setNotesError(null)
    setNotes([])
    setNotesCursor(null)
    setNotesHasMore(false)
    try {
      const page = await drive.attachedNotes(file.id, {limit: NOTES_PAGE})
      setNotes(page.items)
      setNotesCursor(page.cursor)
      setNotesHasMore(!page.end)
      setNotesState('ready')
    } catch (err) {
      if (isUnsupportedError(err)) setNotesState('unsupported')
      else if (isPermissionError(err)) setNotesState('denied')
      else {
        setNotesState('error')
        setNotesError(err instanceof Error ? err.message : 'Could not load notes for this file.')
      }
    }
  }, [drive, file.id])

  useEffect(() => {
    setMedia(file)
    void loadDetail()
    void loadNotes()
  }, [file, loadDetail, loadNotes])

  const loadMoreNotes = async () => {
    if (!drive || !notesCursor || notesLoadingMore) return
    setNotesLoadingMore(true)
    setNotesError(null)
    try {
      const page = await drive.attachedNotes(file.id, {
        limit: NOTES_PAGE,
        cursor: notesCursor,
      })
      setNotes(prev => [...prev, ...page.items.filter(p => !prev.some(n => n.id === p.id))])
      setNotesCursor(page.cursor)
      setNotesHasMore(!page.end)
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : 'Could not load more notes.')
    } finally {
      setNotesLoadingMore(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={media.name} testID="drive-detail">
      <ScrollView style={{maxHeight: 420}} contentContainerStyle={[atoms.gap_sm]}>
        <MetaRow label="Name" value={media.name} testID="drive-detail-name" />
        <MetaRow label="Type" value={media.mimeType} testID="drive-detail-type" />
        <MetaRow label="Size" value={formatBytes(media.size)} testID="drive-detail-size" />
        <MetaRow
          label="Created"
          value={media.createdAt ?? 'Unknown'}
          testID="drive-detail-created"
        />
        <MetaRow
          label="Sensitive"
          value={media.isSensitive ? 'Yes' : 'No'}
          testID="drive-detail-sensitive"
        />
        <MetaRow
          label="Comment"
          value={media.description ?? 'No description'}
          testID="drive-detail-comment"
        />
        <MetaRow label="URL" value={media.url ?? 'Not processed yet'} testID="drive-detail-url" />
        {detailUnsupported ? (
          <Caption color="faint" testID="drive-detail-unsupported">
            This server does not support file details. Showing the values from the file list.
          </Caption>
        ) : null}
        {detailError ? (
          <View style={[atoms.gap_sm]}>
            <Caption color="faint" testID="drive-detail-error">
              {detailError}
            </Caption>
            <Button
              label="Retry"
              variant="secondary"
              onPress={() => void loadDetail()}
              testID="drive-detail-retry"
            />
          </View>
        ) : null}

        <View style={[atoms.gap_sm]} testID="drive-detail-notes">
          <Body>Notes using this file</Body>
          {notesState === 'loading' ? (
            <View style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
              <Loader testID="drive-detail-notes-loading" />
              <Caption color="faint">Loading notes…</Caption>
            </View>
          ) : notesState === 'unsupported' ? (
            <Caption color="faint" testID="drive-detail-notes-unsupported">
              This server does not support showing notes that use a file.
            </Caption>
          ) : notesState === 'denied' ? (
            <Caption color="faint" testID="drive-detail-notes-denied">
              Your account cannot view the notes for this file.
            </Caption>
          ) : notesState === 'error' ? (
            <View style={[atoms.gap_sm]}>
              <Caption color="faint" testID="drive-detail-notes-error">
                {notesError ?? 'Could not load notes for this file.'}
              </Caption>
              <Button
                label="Retry"
                variant="secondary"
                onPress={() => void loadNotes()}
                testID="drive-detail-notes-retry"
              />
            </View>
          ) : notes.length === 0 ? (
            <Caption color="faint" testID="drive-detail-notes-empty">
              No notes use this file.
            </Caption>
          ) : (
            <>
              {notes.map(post => (
                <AttachedNoteRow key={post.id} post={post} sessionId={sessionId} />
              ))}
              {notesError ? (
                <Caption color="faint" testID="drive-detail-notes-error">
                  {notesError}
                </Caption>
              ) : null}
              {notesHasMore ? (
                <Button
                  label={notesLoadingMore ? 'Loading…' : 'Load more notes'}
                  variant="secondary"
                  disabled={notesLoadingMore}
                  onPress={() => void loadMoreNotes()}
                  testID="drive-detail-notes-more"
                />
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </Dialog>
  )
}

export function DriveScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const [folders, setFolders] = useState<DriveFolder[] | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [files, setFiles] = useState<Media[]>([])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [denied, setDenied] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pendingFolderDeleteId, setPendingFolderDeleteId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [staged, setStaged] = useState<UploadableFile | null>(null)
  const [uploadComment, setUploadComment] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [detailFile, setDetailFile] = useState<Media | null>(null)

  const foldersSupported = backend?.drive?.folders != null
  const selectedFolder = (folders ?? []).find(folder => folder.id === selectedFolderId) ?? null

  const load = useCallback(async () => {
    if (!session || !backend) {
      setLoading(false)
      return
    }
    if (!backend.drive || backend.capabilities.drive === 'unsupported') {
      setUnsupported(true)
      setLoading(false)
      return
    }
    setFetching(true)
    setError(null)
    try {
      const [folderList, filePage] = await Promise.all([
        backend.drive.folders ? backend.drive.folders.list() : Promise.resolve(null),
        backend.drive.files({limit: FILES_PAGE, folderId: selectedFolderId}),
      ])
      setFolders(folderList)
      setFiles(filePage.items)
      setCursor(filePage.cursor)
      setHasMore(!filePage.end)
      setUnsupported(false)
      setDenied(false)
    } catch (err) {
      if (isUnsupportedError(err)) setUnsupported(true)
      else if (isPermissionError(err)) setDenied(true)
      else setError(err)
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }, [session, backend, selectedFolderId])

  // The upload flow refreshes whatever folder is on screen when it finishes,
  // even if the selection changed while the request was in flight.
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    setFolders(null)
    setFiles([])
    setCursor(null)
    setHasMore(false)
    setUnsupported(false)
    setDenied(false)
    setError(null)
    setLoading(true)
    void load()
  }, [load])

  const loadMore = useCallback(async () => {
    if (!backend?.drive || !cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await backend.drive.files({
        limit: FILES_PAGE,
        cursor,
        folderId: selectedFolderId,
      })
      setFiles(prev => [...prev, ...page.items.filter(p => !prev.some(f => f.id === p.id))])
      setCursor(page.cursor)
      setHasMore(!page.end)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not load more files.')
    } finally {
      setLoadingMore(false)
    }
  }, [backend, cursor, loadingMore, selectedFolderId])

  const chooseFile = useCallback(async () => {
    setUploadError(null)
    setUploadSuccess(null)
    try {
      const picked = await pickMedia({limit: 1})
      if (picked.length > 0) setStaged(picked[0])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not open the file picker.')
    }
  }, [])

  const uploadStaged = useCallback(async () => {
    if (!backend || !staged || uploading) return
    setUploading(true)
    setUploadError(null)
    setUploadSuccess(null)
    try {
      const comment = uploadComment.trim()
      const media = await backend.uploadMedia(staged.file, {
        ...(selectedFolderId ? {folderId: selectedFolderId} : {}),
        ...(comment ? {comment} : {}),
      })
      setUploadSuccess(`Uploaded “${media.name}”.`)
      setStaged(null)
      setUploadComment('')
      await loadRef.current()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not upload the file.')
    } finally {
      setUploading(false)
    }
  }, [backend, staged, uploading, uploadComment, selectedFolderId])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="drive-screen">
        <Pagehead title="Drive" />
        <Body>Sign in to see your drive.</Body>
        <Caption color="faint">Drive never shows sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (unsupported || (!backend.drive && !loading)) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="drive-screen">
        <Pagehead title="Drive" />
        <Body>Drive is not available on this server.</Body>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="drive-screen">
      <Pagehead title="Drive" />
      {actionError ? <Caption color="faint">{actionError}</Caption> : null}
      {loading ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Loader testID="drive-loading" />
          <Caption color="faint">Loading…</Caption>
        </View>
      ) : denied ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Your account cannot view drive here.</Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => void load()}
            testID="drive-retry"
          />
        </View>
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load drive.</Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => void load()}
            testID="drive-retry"
          />
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <FileRow
              file={item}
              onOpenDetails={() => setDetailFile(item)}
              onRename={async name => {
                if (!backend.drive) return
                setActionError(null)
                const updated = await backend.drive.updateFile(item.id, {name})
                setFiles(prev => prev.map(f => (f.id === item.id ? updated : f)))
                setDetailFile(prev => (prev?.id === item.id ? updated : prev))
              }}
              onToggleSensitive={async () => {
                if (!backend.drive) return
                setActionError(null)
                const updated = await backend.drive.updateFile(item.id, {
                  isSensitive: !item.isSensitive,
                })
                setFiles(prev => prev.map(f => (f.id === item.id ? updated : f)))
                setDetailFile(prev => (prev?.id === item.id ? updated : prev))
              }}
              onDelete={async () => {
                if (!backend.drive) return
                setActionError(null)
                try {
                  await backend.drive.deleteFile(item.id)
                  setFiles(prev => prev.filter(f => f.id !== item.id))
                  setPendingDeleteId(null)
                  setDetailFile(prev => (prev?.id === item.id ? null : prev))
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : 'Could not delete the file.')
                }
              }}
              pendingDelete={pendingDeleteId === item.id}
              onArmDelete={() => setPendingDeleteId(item.id)}
              onCancelDelete={() => setPendingDeleteId(null)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={fetching}
              onRefresh={() => void load()}
              testID="drive-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListHeaderComponent={
            <View style={[atoms.gap_sm, atoms.py_sm]} testID="drive-header">
              <UploadPanel
                targetLabel={
                  selectedFolder ? `Uploads go to “${selectedFolder.name}”.` : 'Uploads go to Root.'
                }
                staged={staged}
                comment={uploadComment}
                uploading={uploading}
                error={uploadError}
                success={uploadSuccess}
                onChoose={() => void chooseFile()}
                onCommentChange={setUploadComment}
                onUpload={() => void uploadStaged()}
                onCancel={() => {
                  setStaged(null)
                  setUploadComment('')
                  setUploadError(null)
                }}
              />
              {foldersSupported ? (
                <View style={[atoms.gap_sm]} testID="drive-folders">
                  <View style={[atoms.px_md]}>
                    <Caption color="faint">Folders</Caption>
                  </View>
                  <FolderScope
                    folders={folders ?? []}
                    selectedId={selectedFolderId}
                    onSelect={setSelectedFolderId}
                  />
                  {(folders ?? []).map(folder => (
                    <FolderRow
                      key={folder.id}
                      folder={folder}
                      onRename={async name => {
                        if (!backend.drive?.folders) return
                        setActionError(null)
                        const updated = await backend.drive.folders.update(folder.id, {name})
                        setFolders(prev =>
                          (prev ?? []).map(f => (f.id === folder.id ? updated : f)),
                        )
                      }}
                      onDelete={async () => {
                        if (!backend.drive?.folders) return
                        setActionError(null)
                        try {
                          await backend.drive.folders.delete(folder.id)
                          setFolders(prev => (prev ?? []).filter(f => f.id !== folder.id))
                          setPendingFolderDeleteId(null)
                          if (selectedFolderId === folder.id) setSelectedFolderId(null)
                        } catch (err) {
                          setActionError(
                            err instanceof Error ? err.message : 'Could not delete the folder.',
                          )
                        }
                      }}
                      pendingDelete={pendingFolderDeleteId === folder.id}
                      onArmDelete={() => setPendingFolderDeleteId(folder.id)}
                      onCancelDelete={() => setPendingFolderDeleteId(null)}
                    />
                  ))}
                  <View style={[atoms.gap_sm, atoms.px_md]}>
                    <TextField
                      label="New folder"
                      value={folderName}
                      onChangeText={setFolderName}
                      placeholder="Folder name"
                      error={folderError ?? undefined}
                      testID="drive-folder-create-input"
                    />
                    <Button
                      label={folderBusy ? 'Creating…' : 'Create folder'}
                      variant="primary"
                      disabled={folderBusy || folderName.trim().length === 0}
                      onPress={() => {
                        if (!backend.drive?.folders || folderBusy) return
                        const trimmed = folderName.trim()
                        if (trimmed.length === 0) return
                        setFolderBusy(true)
                        setFolderError(null)
                        void backend.drive.folders
                          .create(trimmed)
                          .then(created => {
                            setFolders(prev => (prev ? [...prev, created] : [created]))
                            setFolderName('')
                          })
                          .catch((err: unknown) => {
                            setFolderError(
                              err instanceof Error ? err.message : 'Could not create the folder.',
                            )
                          })
                          .finally(() => setFolderBusy(false))
                      }}
                      testID="drive-folder-create-submit"
                    />
                  </View>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>
                {selectedFolderId ? 'This folder has no files yet.' : 'You have no files yet.'}
              </Body>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <View style={[atoms.centered, atoms.py_sm]}>
                <Button
                  label={loadingMore ? 'Loading…' : 'Load more'}
                  variant="secondary"
                  disabled={loadingMore}
                  onPress={() => void loadMore()}
                  testID="drive-load-more"
                />
              </View>
            ) : null
          }
        />
      )}
      {detailFile && backend.drive ? (
        <FileDetailDialog
          file={detailFile}
          backend={backend}
          sessionId={session.id}
          onClose={() => setDetailFile(null)}
        />
      ) : null}
    </View>
  )
}
