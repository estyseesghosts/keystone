// Single-image Drive picker (P6.5 Pages, slice 4): Browse (folder
// navigation + image files) + Upload (library pick + server upload).
// Returns one `Media` via `onPick`. Disabled with a reason where `drive`
// is unsupported — never an inert control.

import {useCallback, useEffect, useState} from 'react'
import {FlatList, View} from 'react-native'
import {msg} from '@lingui/macro'

import type {Backend, Cursor, DriveFolder, Media} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {AppImage} from '#/components/Image'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {Pressable} from '#/components/Pressable'
import {SkeletonList} from '#/components/Skeleton'
import {Tabs} from '#/components/Tabs'
import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'
import {showToast} from '#/lib/toast'
import {pickMedia} from '#/components/Composer/pickMedia'

const PAGE_SIZE = 20

function isImage(file: {mimeType: string | null; name: string}): boolean {
  if (file.mimeType) return file.mimeType.startsWith('image/')
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name)
}

function BrowseTab({
  backend,
  onPick,
  testID,
}: {
  backend: NonNullable<Backend['drive']>
  onPick: (file: Media) => void
  testID: string
}) {
  const [folders, setFolders] = useState<DriveFolder[] | null>(null)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [files, setFiles] = useState<Media[]>([])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const canFolders = backend.folders != null

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [folderList, filePage] = await Promise.all([
        backend.folders ? backend.folders.list() : Promise.resolve(null),
        backend.files({limit: PAGE_SIZE, folderId}),
      ])
      setFolders(folderList)
      // Image-only picker: filter client-side (server `type` varies).
      setFiles(filePage.items.filter(isImage))
      setCursor(filePage.cursor)
      setHasMore(!filePage.end)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [backend, folderId])

  useEffect(() => {
    setFolders(null)
    setFiles([])
    void load()
  }, [load])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await backend.files({limit: PAGE_SIZE, cursor, folderId})
      setFiles(prev => [...prev, ...page.items.filter(f => isImage(f) && !prev.some(p => p.id === f.id))])
      setCursor(page.cursor)
      setHasMore(!page.end)
    } catch (err) {
      showToast(errorText(i18n, err, i18n._(msg`Could not load more files.`)))
    } finally {
      setLoadingMore(false)
    }
  }, [backend, cursor, folderId, loadingMore])

  if (loading) return <SkeletonList variant="row" testID={`${testID}-loading`} />
  if (error)
    return (
      <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{i18n._(msg`Could not load Drive files.`)}</Body>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => void load()} testID={`${testID}-retry`} />
      </View>
    )
  return (
    <View style={atoms.flex1}>
      {canFolders ? (
        <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]}>
          <Button
            label={i18n._(msg`Root`)}
            variant="secondary"
            compact
            disabled={folderId === null}
            onPress={() => setFolderId(null)}
            testID={`${testID}-folder-root`}
          />
          {(folders ?? []).map(f => (
            <Button
              key={f.id}
              label={f.name}
              variant="secondary"
              compact
              disabled={folderId === f.id}
              onPress={() => setFolderId(f.id)}
              testID={`${testID}-folder-${f.id}`}
            />
          ))}
        </View>
      ) : null}
      {files.length === 0 ? (
        <View style={[atoms.centered, atoms.p_md]} testID={`${testID}-empty`}>
          <Body>{i18n._(msg`No images here yet.`)}</Body>
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <Pressable
              onPress={() => onPick(item)}
              accessibilityRole="button"
              accessibilityLabel={i18n._(msg`Choose ${item.name}`)}
              testID={`${testID}-file-${item.id}`}>
              <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]}>
                <AppImage uri={item.previewUrl ?? item.url} contentFit="cover" style={{width: 56, height: 56, borderRadius: 8}} />
                <View style={atoms.flex1}>
                  <Body numberOfLines={1}>{item.name}</Body>
                  <Caption color="faint" numberOfLines={1}>{item.mimeType ?? ''}</Caption>
                </View>
              </View>
            </Pressable>
          )}
          onEndReached={() => {
            if (hasMore) void loadMore()
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <Loader testID={`${testID}-more`} /> : null}
          testID={testID}
        />
      )}
    </View>
  )
}

function UploadTab({
  backend,
  onPick,
  testID,
}: {
  backend: Backend
  onPick: (file: Media) => void
  testID: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await pickMedia({limit: 1})
      if (result.kind === 'denied') {
        setError(
          result.canAskAgain
            ? i18n._(msg`Media library access was denied. Allow access to pick a file.`)
            : i18n._(msg`Media library access was denied. Enable it in the system settings to pick a file.`),
        )
        return
      }
      if (result.kind === 'cancelled') return
      if (result.rejected.length > 0 || result.files.length === 0) {
        setError(i18n._(msg`That file could not be read. Try another.`))
        return
      }
      const staged = result.files[0]!
      if (staged.file.type && !staged.file.type.startsWith('image/')) {
        setError(i18n._(msg`Choose an image file. Pages only embed images.`))
        return
      }
      const media = await backend.uploadMedia(staged.file, {})
      onPick(media)
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not upload the file.`)))
    } finally {
      setBusy(false)
    }
  }, [backend, busy, onPick])

  return (
    <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]} testID={testID}>
      <Body>{i18n._(msg`Upload an image from your device.`)}</Body>
      {error ? <Caption color="faint">{error}</Caption> : null}
      <Button
        label={busy ? i18n._(msg`Uploading…`) : i18n._(msg`Choose image`)}
        variant="primary"
        disabled={busy}
        onPress={() => void run()}
        testID={`${testID}-choose`}
      />
    </View>
  )
}

export function DrivePicker({
  backend,
  onPick,
  testID,
}: {
  backend: Backend | null
  onPick: (file: Media) => void
  testID?: string
}) {
  const [tab, setTab] = useState<'browse' | 'upload'>('browse')
  if (!backend?.drive) {
    return (
      <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]} testID={testID}>
        <Body>{i18n._(msg`Drive is not available on this server.`)}</Body>
        <Caption color="faint">{i18n._(msg`Image blocks need a server with Drive support.`)}</Caption>
      </View>
    )
  }
  const drive = backend.drive
  return (
    <View style={atoms.flex1} testID={testID}>
      <Tabs
        tabs={[
          {key: 'browse', label: i18n._(msg`Browse`)},
          {key: 'upload', label: i18n._(msg`Upload`)},
        ]}
        active={tab}
        onChange={setTab}
        testID={`${testID}-tabs`}
        testIDPrefix={`${testID}-tab`}
        accessibilityLabel={i18n._(msg`Drive picker`)}
      />
      {tab === 'browse' ? (
        <BrowseTab backend={drive} onPick={onPick} testID={`${testID}-browse`} />
      ) : (
        <UploadTab backend={backend} onPick={onPick} testID={`${testID}-upload`} />
      )}
    </View>
  )
}
