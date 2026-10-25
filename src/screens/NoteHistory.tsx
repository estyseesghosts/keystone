// Edit history (`/notes/:id/history`, clickstone §1.7): one post's
// revisions, newest-first, reached from the Edited badge.
//
// Data: `Backend.editHistory` (Mastodon `GET /api/v1/statuses/:id/history`,
// adapted to `PostRevision[]`). The Misskey family has NO history endpoint
// (upstream Misskey has no `notes/edit` at all and packs no revision list;
// Sharkey edits in place and keeps only `updatedAt`), so the backend leaves
// `editHistory` undefined and this screen says so — it never fabricates a
// single "revision" from the current post.
//
// Rendering: every revision body goes through the shared `RichText` over the
// allow-listed AST (`revisionNodes`), the same pipeline a post body uses. No
// HTML string ever reaches a renderer directly.

import {StyleSheet, View} from 'react-native'
import {msg, plural} from '@lingui/macro'
import {useI18n} from '#/locale/i18n'

import {useRoute, type RouteProp} from '@react-navigation/native'

import {isUnsupportedError, type PostRevision} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {RichText} from '#/components/RichText'
import {revisionNodes} from '#/components/Post/body'
import {formatRelativeTime} from '#/components/Post/time'
import {useNow} from '#/locale/ticker'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useEditHistoryQuery} from '#/state/queries'

const styles = StyleSheet.create({
  card: {gap: 6, paddingHorizontal: 16, paddingVertical: 12},
})

/** One revision row: who/when + the body that revision carried. */
export function RevisionRow({
  revision,
  testID,
}: {
  revision: PostRevision
  testID?: string
}) {
  const theme = useTheme()
  const i18n = useI18n()
  const nowMs = useNow()
  const nodes = revisionNodes(revision)
  return (
    <View
      testID={testID}
      style={[styles.card, {borderBottomWidth: 1, borderBottomColor: theme.palette.border}]}>
      <Caption color="muted" testID={`${testID ?? 'revision'}-label`}>
        {revision.original
          ? i18n._(msg`Original · ${formatRelativeTime(revision.createdAt, nowMs)}`)
          : i18n._(msg`Edited · ${formatRelativeTime(revision.createdAt, nowMs)}`)}
      </Caption>
      {revision.cw ? (
        <Caption color="muted" testID={`${testID ?? 'revision'}-cw`}>
          {revision.cw}
        </Caption>
      ) : null}
      {nodes.length > 0 ? (
        <RichText nodes={nodes} size={15} testID={`${testID ?? 'revision'}-body`} />
      ) : (
        <Caption color="faint">{i18n._(msg`No text in this revision.`)}</Caption>
      )}
      {revision.media.map((m, i) => (
        <Caption key={m.id} color="muted" testID={`${testID ?? 'revision'}-media-${i}`}>
          {m.description && m.description.trim() !== ''
            ? i18n._(msg`Attachment ${i + 1}: ${m.description}`)
            : i18n._(msg`Attachment ${i + 1}: no description`)}
        </Caption>
      ))}
    </View>
  )
}

export function NoteHistoryScreen() {
  const route = useRoute<RouteProp<RootParamList, 'NoteHistory'>>()
  const id = route.params.id
  const {session, backend} = useActiveBackend()
  const sessionId = session?.id ?? null
  const supported = typeof backend?.editHistory === 'function'
  const i18n = useI18n()
  const history = useEditHistoryQuery(sessionId, id, {
    ...(backend ? {backend} : {}),
    // A fork without the endpoint answers 404/405 — never retry a wall.
    retry: false,
  })
  const editCount = (history.data?.length ?? 1) - 1

  return (
    <View style={atoms.flex1} testID="note-history-screen">
      <Pagehead title={i18n._(msg`Edit history`)} />
      {!session || !backend || !sessionId ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Sign in to see this history.`)}</Body>
          <SignInButton />
        </View>
      ) : !supported ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]} testID="note-history-unsupported">
          <Body>{i18n._(msg`This server keeps no edit history.`)}</Body>
          <Caption color="faint">
            {i18n._(
              msg`The post is marked as edited, but this server does not expose the revisions. Keystone shows no invented history.`,
            )}
          </Caption>
        </View>
      ) : history.isPending ? (
        <SkeletonList variant="row" testID="note-history-loading" />
      ) : history.isError ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]} testID="note-history-error">
          <Body>
            {isUnsupportedError(history.error)
              ? i18n._(msg`This server keeps no edit history.`)
              : i18n._(msg`Could not load the edit history.`)}
          </Body>
          <Button
            label={i18n._(msg`Retry`)}
            variant="secondary"
            onPress={() => void history.refetch()}
            testID="note-history-retry"
          />
        </View>
      ) : (history.data?.length ?? 0) === 0 ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]} testID="note-history-empty">
          <Body>{i18n._(msg`No revisions on this server.`)}</Body>
        </View>
      ) : (
        <View testID="note-history-list">
          <View style={[atoms.px_md, atoms.py_sm]}>
            <Caption color="faint" testID="note-history-count">
              {i18n._(plural(editCount, {one: '# edit', other: '# edits'}))}
            </Caption>
          </View>
          {(history.data ?? []).map((revision, i) => (
            <RevisionRow
              key={`${revision.createdAt}-${i}`}
              revision={revision}
              testID={`revision-${i}`}
            />
          ))}
        </View>
      )}
    </View>
  )
}
