// Drive file detail dialog (D3.7 split of `src/screens/Drive.tsx`):
// metadata (`show`) + attached notes (`attached-notes`), including the
// honest empty/unsupported states. A detail endpoint that 404s at runtime
// keeps its section visible with the reason — never hidden, never an
// inert control, never a fake note count. Moved verbatim.

import {useCallback, useEffect, useState} from 'react'
import {ScrollView, View} from 'react-native'

import {
  isPermissionError,
  isUnsupportedError,
  type Backend,
  type Cursor,
  type Media,
  type Post,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {Loader} from '#/components/Loader'

import {AttachedNoteRow, MetaRow, formatBytes} from './rows'

const NOTES_PAGE = 10

type NotesState = 'loading' | 'ready' | 'unsupported' | 'denied' | 'error'

export function FileDetailDialog({
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
