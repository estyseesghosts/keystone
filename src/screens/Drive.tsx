// Drive browser (`/drive`, v1 `Drive` parity without uploads): the
// viewer's folders (only when `backend.drive.folders` exists — the
// section hides entirely otherwise) with create/rename/two-tap delete,
// and files newest-first. File rows show name/type/sensitivity with
// rename, sensitivity toggle, and two-tap delete. Uploads are out of
// scope: the composer owns them.
// Gated on `backend.drive`; every `DriveApi` member is required, so the
// controls are never disabled by capability.

import {useCallback, useEffect, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'

import {isPermissionError, isUnsupportedError, type Cursor, type DriveFolder, type Media} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {useActiveBackend} from '#/screens/HomeFeed'

const FILES_PAGE = 20

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

function FileRow({
  file,
  onRename,
  onToggleSensitive,
  onDelete,
  pendingDelete,
  onArmDelete,
  onCancelDelete,
}: {
  file: Media
  onRename: (name: string) => Promise<void>
  onToggleSensitive: () => Promise<void>
  onDelete: () => Promise<void>
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
        <View style={[atoms.row, atoms.gap_sm]}>
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

export function DriveScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const [folders, setFolders] = useState<DriveFolder[] | null>(null)
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

  const foldersSupported = backend?.drive?.folders != null

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
        backend.drive.files({limit: FILES_PAGE}),
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
  }, [session, backend])

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
      const page = await backend.drive.files({limit: FILES_PAGE, cursor})
      setFiles(prev => [...prev, ...page.items.filter(p => !prev.some(f => f.id === p.id))])
      setCursor(page.cursor)
      setHasMore(!page.end)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not load more files.')
    } finally {
      setLoadingMore(false)
    }
  }, [backend, cursor, loadingMore])

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
          <Button label="Retry" variant="secondary" onPress={() => void load()} testID="drive-retry" />
        </View>
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load drive.</Body>
          <Button label="Retry" variant="secondary" onPress={() => void load()} testID="drive-retry" />
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <FileRow
              file={item}
              onRename={async name => {
                if (!backend.drive) return
                setActionError(null)
                const updated = await backend.drive.updateFile(item.id, {name})
                setFiles(prev => prev.map(f => (f.id === item.id ? updated : f)))
              }}
              onToggleSensitive={async () => {
                if (!backend.drive) return
                setActionError(null)
                const updated = await backend.drive.updateFile(item.id, {
                  isSensitive: !item.isSensitive,
                })
                setFiles(prev => prev.map(f => (f.id === item.id ? updated : f)))
              }}
              onDelete={async () => {
                if (!backend.drive) return
                setActionError(null)
                try {
                  await backend.drive.deleteFile(item.id)
                  setFiles(prev => prev.filter(f => f.id !== item.id))
                  setPendingDeleteId(null)
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
            foldersSupported ? (
              <View style={[atoms.gap_sm, atoms.py_sm]} testID="drive-folders">
                <View style={[atoms.px_md]}>
                  <Caption color="faint">Folders</Caption>
                </View>
                {(folders ?? []).map(folder => (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    onRename={async name => {
                      if (!backend.drive?.folders) return
                      setActionError(null)
                      const updated = await backend.drive.folders.update(folder.id, {name})
                      setFolders(prev => (prev ?? []).map(f => (f.id === folder.id ? updated : f)))
                    }}
                    onDelete={async () => {
                      if (!backend.drive?.folders) return
                      setActionError(null)
                      try {
                        await backend.drive.folders.delete(folder.id)
                        setFolders(prev => (prev ?? []).filter(f => f.id !== folder.id))
                        setPendingFolderDeleteId(null)
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
                          setFolderError(err instanceof Error ? err.message : 'Could not create the folder.')
                        })
                        .finally(() => setFolderBusy(false))
                    }}
                    testID="drive-folder-create-submit"
                  />
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>You have no files yet.</Body>
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
    </View>
  )
}
