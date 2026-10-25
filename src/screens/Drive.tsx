// Drive as a library (`/drive`, clickstone §1.10): folders, folder-scoped
// files, upload from the screen itself, and file detail (`drive/files/show`
// + `drive/files/attached-notes`).
//
// Split (D3.7): rows + scope picker in `./Drive/rows`, the upload panel in
// `./Drive/upload`, and the detail dialog in `./Drive/detail`. This file
// keeps the `DriveScreen` composer: loading, listing, pagination, folder
// CRUD, upload flow, and dialog state.
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

import {useCallback, useEffect, useRef, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  formatByteLimit,
  isPermissionError,
  isUnsupportedError,
  type Cursor,
  type DriveFolder,
  type Media,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {pickMedia} from '#/components/Composer/pickMedia'
import {TextField} from '#/components/forms/TextField'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import type {UploadableFile} from '#/state/queries/composer'
import {useActiveBackend} from '#/screens/HomeFeed'
import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'

import {FileRow, FolderRow, FolderScope} from './Drive/rows'
import {UploadPanel} from './Drive/upload'
import {FileDetailDialog} from './Drive/detail'

const FILES_PAGE = 20

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

  // Repair X7.4 step 1: the in-flight Drive upload is cancellable — the
  // request aborts on unmount (leaving the screen never leaks it). The
  // panel keeps its staged/failed states; only the network work stops.
  const uploadCtrl = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      try {
        uploadCtrl.current?.abort()
      } catch {
        // Already settled.
      }
      uploadCtrl.current = null
    },
    [],
  )

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
      setActionError(errorText(i18n, err, i18n._(msg`Could not load more files.`)))
    } finally {
      setLoadingMore(false)
    }
  }, [backend, cursor, loadingMore, selectedFolderId])

  const chooseFile = useCallback(async () => {
    setUploadError(null)
    setUploadSuccess(null)
    try {
      const result = await pickMedia({limit: 1})
      // Typed outcome (R2.3): denied is shown, never a silent cancel.
      if (result.kind === 'denied') {
        setUploadError(
          result.canAskAgain
            ? i18n._(msg`Media library access was denied. Allow access to pick a file.`)
            : i18n._(msg`Media library access was denied. Enable it in the system settings to pick a file.`),
        )
        return
      }
      if (result.kind === 'cancelled') return
      if (result.rejected.length > 0) {
        // Per-kind server cap, else the client heap bound (repair X6.2 step
        // 2) — never a literal.
        const rejected = result.rejected[0]
        setUploadError(
          i18n._(msg`"${rejected.name}" is too large to upload (limit ${formatByteLimit(rejected.limit)}).`),
        )
        return
      }
      if (result.files.length > 0) setStaged(result.files[0])
    } catch (err) {
      setUploadError(errorText(i18n, err, i18n._(msg`Could not open the file picker.`)))
    }
  }, [])

  const uploadStaged = useCallback(async () => {
    if (!backend || !staged || uploading) return
    setUploading(true)
    setUploadError(null)
    setUploadSuccess(null)
    const ctrl = new AbortController()
    uploadCtrl.current = ctrl
    try {
      const comment = uploadComment.trim()
      const media = await backend.uploadMedia(staged.file, {
        ...(selectedFolderId ? {folderId: selectedFolderId} : {}),
        ...(comment ? {comment} : {}),
        signal: ctrl.signal,
      })
      setUploadSuccess(i18n._(msg`Uploaded “${media.name}”.`))
      setStaged(null)
      setUploadComment('')
      await loadRef.current()
    } catch (err) {
      setUploadError(errorText(i18n, err, i18n._(msg`Could not upload the file.`)))
    } finally {
      if (uploadCtrl.current === ctrl) uploadCtrl.current = null
      setUploading(false)
    }
  }, [backend, staged, uploading, uploadComment, selectedFolderId])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="drive-screen">
        <Pagehead title={i18n._(msg({id: 'drive.title', message: 'Drive', context: 'file storage screen title'}))} />
        <Body>{i18n._(msg({id: 'drive.signedOut', message: 'Sign in to see your drive.'}))}</Body>
        <Caption color="faint">
          {i18n._(msg`Drive never shows sample data when signed out.`)}
        </Caption>
        <SignInButton />
      </View>
    )
  }

  if (unsupported || (!backend.drive && !loading)) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="drive-screen">
        <Pagehead title={i18n._(msg({id: 'drive.title', message: 'Drive', context: 'file storage screen title'}))} />
        <Body>{i18n._(msg`Drive is not available on this server.`)}</Body>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="drive-screen">
      <Pagehead title={i18n._(msg({id: 'drive.title', message: 'Drive', context: 'file storage screen title'}))} />
      {actionError ? <Caption color="faint">{actionError}</Caption> : null}
      {loading ? (
        <SkeletonList variant="row" testID="drive-loading" />
      ) : denied ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Your account cannot view drive here.`)}</Body>
          <Button
            label={i18n._(msg({message: 'Retry', context: 'button', comment: 'Retry loading the drive'}))}
            variant="secondary"
            onPress={() => void load()}
            testID="drive-retry"
          />
        </View>
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Could not load drive.`)}</Body>
          <Button
            label={i18n._(msg({message: 'Retry', context: 'button', comment: 'Retry loading the drive'}))}
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
                  setActionError(errorText(i18n, err, i18n._(msg`Could not delete the file.`)))
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
                  selectedFolder
                    ? i18n._(msg`Uploads go to “${selectedFolder.name}”.`)
                    : i18n._(msg`Uploads go to Root.`)
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
                    <Caption color="faint">
                      {i18n._(msg({message: 'Folders', context: 'drive section header'}))}
                    </Caption>
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
                            errorText(i18n, err, i18n._(msg`Could not delete the folder.`))
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
                      label={i18n._(msg({message: 'New folder', context: 'drive folder creation'}))}
                      value={folderName}
                      onChangeText={setFolderName}
                      placeholder={i18n._(msg({message: 'Folder name', context: 'drive folder name input'}))}
                      error={folderError ?? undefined}
                      testID="drive-folder-create-input"
                    />
                    <Button
                      label={
                        folderBusy
                          ? i18n._(msg({message: 'Creating…', context: 'button'}))
                          : i18n._(msg({message: 'Create folder', context: 'button'}))
                      }
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
                              errorText(i18n, err, i18n._(msg`Could not create the folder.`))
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
                {selectedFolderId
                  ? i18n._(msg`This folder has no files yet.`)
                  : i18n._(msg`You have no files yet.`)}
              </Body>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <View style={[atoms.centered, atoms.py_sm]}>
                <Button
                  label={
                    loadingMore
                      ? i18n._(msg({message: 'Loading…', context: 'button'}))
                      : i18n._(msg({message: 'Load more', context: 'button'}))
                  }
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
