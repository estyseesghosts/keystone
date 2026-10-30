// Page image + note + unknown blocks (P6.5 Pages, slice 2).
//
// Image resolves through the page's `attachedFiles` (reader) or a
// drive-file query (preview); a file the server dropped renders a
// bordered "Image unavailable" box, never empty. Notes render through
// the shared PostCard (`foldBody={false}` = the expanded Note-screen
// variant); a missing/deleted note renders "Note unavailable". Unknown
// (legacy AiScript) blocks render the placeholder from the plan and are
// never executed.

import {StyleSheet, View} from 'react-native'
import {msg} from '@lingui/macro'

import type {Media, Post} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {AppImage} from '#/components/Image'
import {PostCard} from '#/components/Post/index'
import {i18n} from '#/locale/i18n'
import {usePageNote} from '#/state/queries/pages'

const styles = StyleSheet.create({
  frame: {borderWidth: 1, borderRadius: 8, overflow: 'hidden', minHeight: 120},
  missing: {alignItems: 'center', justifyContent: 'center', padding: 16, gap: 4, minHeight: 120},
})

export function ImageBlock({
  fileId,
  image,
  testID,
}: {
  /** Wire `fileId` (kept for the testID/a11y label even when unresolved). */
  fileId: string | null
  /** Resolved media, or null when the server dropped the file. */
  image: Media | null
  testID?: string
}) {
  const theme = useTheme()
  if (!image?.url) {
    return (
      <View
        testID={testID}
        accessibilityLabel={i18n._(msg`Image unavailable`)}
        style={[styles.missing, {borderColor: theme.palette.edge, backgroundColor: theme.palette.bgSoft}]}>
        <Body>{i18n._(msg`Image unavailable`)}</Body>
        <Caption color="faint">
          {i18n._(msg`The attached file is missing from the server.`)}
        </Caption>
      </View>
    )
  }
  return (
    <View testID={testID} style={[styles.frame, {borderColor: theme.palette.edge}]}>
      <AppImage
        uri={image.url}
        blurhash={image.blurhash}
        contentFit="contain"
        alt={image.description ?? undefined}
        accessibilityLabel={image.description ?? i18n._(msg`Page image${fileId ? ` ${fileId}` : ''}`)}
        style={{width: '100%', minHeight: 200}}
      />
    </View>
  )
}

export function NoteBlock({
  noteId,
  detailed,
  sessionId,
  testID,
}: {
  noteId: string | null
  detailed: boolean
  sessionId: string | null
  testID?: string
}) {
  if (!noteId) {
    return <NoteMissing testID={testID} />
  }
  if (!sessionId) {
    // No guest backend exists in the query layer (every hook is disabled
    // signed out), so an embedded note cannot load without a session.
    return <NoteMissing testID={testID} />
  }
  return <NoteBlockLoaded noteId={noteId} detailed={detailed} sessionId={sessionId} testID={testID} />
}

function NoteBlockLoaded({
  noteId,
  detailed,
  sessionId,
  testID,
}: {
  noteId: string
  detailed: boolean
  sessionId: string
  testID?: string
}) {
  const note = usePageNote(sessionId, noteId)
  if (note.isPending) {
    return (
      <View testID={testID} style={[atoms.centered, atoms.p_md]}>
        <Caption color="faint">{i18n._(msg`Loading note…`)}</Caption>
      </View>
    )
  }
  if (note.isError || !note.data) {
    return <NoteMissing testID={testID} />
  }
  const post: Post = note.data
  return (
    <View testID={testID}>
      {/* `detailed` off = feed-compact rows, on = the expanded Note-screen rows. */}
      <PostCard post={post} sessionId={sessionId} foldBody={!detailed} />
    </View>
  )
}

function NoteMissing({testID}: {testID?: string}) {
  return (
    <View testID={testID} style={[atoms.centered, atoms.gap_sm, atoms.p_md]}>
      <Body>{i18n._(msg`Note unavailable`)}</Body>
      <Caption color="faint">{i18n._(msg`The embedded note is missing or deleted.`)}</Caption>
    </View>
  )
}

export function UnknownBlock({blockType, testID}: {blockType: string; testID?: string}) {
  return (
    <View testID={testID} style={[atoms.gap_sm, atoms.py_sm]}>
      <Body>{i18n._(msg`This block type is not supported`)}</Body>
      <Caption color="faint">{blockType}</Caption>
    </View>
  )
}
