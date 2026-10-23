// Announcements (`/announcements`, clickstone §1.12): the instance notices
// both families publish. The Misskey family serves `announcements` (public,
// paged) + `i/read-announcement`; Mastodon/Akkoma serve
// `GET /api/v1/announcements` + `POST /api/v1/announcements/:id/dismiss`.
//
// Newest first: the Misskey family already answers newest-first, Mastodon
// answers `published.chronological` (oldest first), so the screen sorts by
// `createdAt` descending — a view decision, never a rewrite of server rows.
//
// Read state is rendered only as far as the server reports it (`isRead`
// null = "unknown", never a guessed "unread"). Dismiss is offered only on
// rows the server says are unread; when the family has no dismiss member,
// or the endpoint 404s on a fork, the button is DISABLED with the reason —
// never inert, never a fake success.
//
// Gated on `capabilities.announcements === "supported"` AND a present
// module. Admin create/edit is Wave 3 (out of scope): this screen never
// shows an authoring control.

import {useCallback, useEffect, useMemo, useState} from 'react'
import {FlatList, Image, RefreshControl, View} from 'react-native'

import {
  contentFromHtml,
  contentFromMfm,
  isUnsupportedError,
  t,
  type Announcement,
  type ContentNode,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {RichText} from '#/components/RichText'
import {SignInButton} from '#/components/SignInButton'
import {formatRelativeTime} from '#/components/Post/time'
import {useActiveBackend} from '#/screens/HomeFeed'

const PAGE_SIZE = 50

/** Body nodes for one announcement: the family's source through the ONE
 * allow-listed AST (MFM on the Misskey family, server HTML on Mastodon),
 * never raw markup. Pure. */
export function announcementNodes(announcement: Announcement): ContentNode[] {
  const c = announcement.content
  if (c.mfm) return contentFromMfm(c.mfm)
  if (c.html) return contentFromHtml(c.html)
  return c.plain ? [t(c.plain)] : []
}

/** Newest-first view order. Invalid/missing dates sort last rather than
 * being treated as "now"; ties keep server order (stable sort). Pure. */
export function sortAnnouncementsNewestFirst(items: readonly Announcement[]): Announcement[] {
  const at = (iso: string): number => {
    const ms = Date.parse(iso)
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
  }
  return [...items].sort((a, b) => {
    const ta = at(a.createdAt)
    const tb = at(b.createdAt)
    if (ta === tb) return 0
    return tb - ta
  })
}

/** The read indicator the server supports: a known state, or "unknown"
 * when the pack carried no read flag (signed-out/fork). */
export function announcementReadLabel(announcement: Announcement): string {
  if (announcement.isRead === true) return 'Read'
  if (announcement.isRead === false) return 'Unread'
  return 'Read state unknown'
}

function AnnouncementRow({
  announcement,
  dismissable,
  dismissUnsupported,
  busy,
  onDismiss,
}: {
  announcement: Announcement
  /** Does this family expose `dismiss` at all? */
  dismissable: boolean
  /** Did the endpoint answer 404/405 for this server? */
  dismissUnsupported: boolean
  busy: boolean
  onDismiss: () => void
}) {
  const nodes = useMemo(() => announcementNodes(announcement), [announcement])
  const unread = announcement.isRead === false
  const disabledReason = !dismissable
    ? 'This server does not support marking announcements as read.'
    : dismissUnsupported
      ? 'This server does not provide the announcement dismiss endpoint.'
      : undefined
  return (
    <View
      style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}
      testID={`announcements-row-${announcement.id}`}>
      {announcement.title ? <Body>{announcement.title}</Body> : null}
      {nodes.length > 0 ? (
        <RichText nodes={nodes} testID={`announcements-body-${announcement.id}`} />
      ) : null}
      {announcement.imageUrl ? (
        <Image
          source={{uri: announcement.imageUrl}}
          style={{width: '100%', height: 160}}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          testID={`announcements-image-${announcement.id}`}
        />
      ) : null}
      <View style={[atoms.row, atoms.gap_sm]}>
        <Caption color="faint">{formatRelativeTime(announcement.createdAt)}</Caption>
        <Caption
          color="faint"
          testID={`announcements-state-${announcement.id}`}>
          {announcementReadLabel(announcement)}
        </Caption>
        {announcement.endsAt ? (
          <Caption color="faint">
            Until {new Date(announcement.endsAt).toLocaleDateString()}
            {announcement.allDay ? ' (all day)' : ''}
          </Caption>
        ) : null}
      </View>
      {unread ? (
        <View style={[atoms.row, atoms.gap_sm]}>
          <Button
            label={busy ? 'Marking…' : 'Mark as read'}
            variant="secondary"
            disabled={busy || disabledReason !== undefined}
            disabledReason={disabledReason}
            onPress={onDismiss}
            testID={`announcements-dismiss-${announcement.id}`}
          />
        </View>
      ) : null}
    </View>
  )
}

export function AnnouncementsScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [dismissError, setDismissError] = useState<string | null>(null)
  const [dismissUnsupported, setDismissUnsupported] = useState(false)

  const announcementsApi = backend?.announcements
  const capable = backend?.capabilities.announcements === 'supported'

  const load = useCallback(async () => {
    if (!session || !announcementsApi || !capable) {
      setLoading(false)
      return
    }
    setFetching(true)
    setError(null)
    try {
      // One page is the whole surface: the Misskey family caps at 100 and
      // Mastodon has no cursor at all. 50 covers the published list a
      // server actually posts; "load more" would be a lie on Mastodon.
      setItems(await announcementsApi.list({limit: PAGE_SIZE}))
      setUnsupported(false)
    } catch (err) {
      if (isUnsupportedError(err)) setUnsupported(true)
      else setError(err)
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }, [session, announcementsApi, capable])

  useEffect(() => {
    setItems(null)
    setUnsupported(false)
    setError(null)
    setDismissError(null)
    setDismissUnsupported(false)
    setLoading(true)
    void load()
  }, [load])

  const dismiss = useCallback(
    async (id: string) => {
      const api = backend?.announcements
      if (!api?.dismiss || dismissing) return
      setDismissing(id)
      setDismissError(null)
      try {
        await api.dismiss(id)
        // The server only records "read"; mirror exactly that.
        setItems(prev => (prev ?? []).map(a => (a.id === id ? {...a, isRead: true} : a)))
      } catch (err) {
        if (isUnsupportedError(err)) setDismissUnsupported(true)
        else setDismissError('Could not mark the announcement as read.')
      } finally {
        setDismissing(null)
      }
    },
    [backend, dismissing],
  )

  const sorted = useMemo(() => sortAnnouncementsNewestFirst(items ?? []), [items])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="announcements-screen">
        <Pagehead title="Announcements" />
        <Body>Sign in to read server announcements.</Body>
        <Caption color="faint">Announcements never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  // `unknown` deliberately does not unlock the surface: an unverified fork
  // gets the same honest answer as one with no announcements endpoint.
  if (unsupported || !announcementsApi || !capable) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="announcements-screen">
        <Pagehead title="Announcements" />
        <Body>Announcements are not available on this server.</Body>
        <Caption color="faint">
          This server does not publish the announcement endpoints Keystone reads.
        </Caption>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="announcements-screen">
      <Pagehead title="Announcements" />
      {dismissError ? <Caption color="faint">{dismissError}</Caption> : null}
      {loading ? (
        <SkeletonList variant="row" testID="announcements-loading" />
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load announcements.</Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => {
              setLoading(true)
              void load()
            }}
            testID="announcements-retry"
          />
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <AnnouncementRow
              announcement={item}
              dismissable={typeof announcementsApi.dismiss === 'function'}
              dismissUnsupported={dismissUnsupported}
              busy={dismissing === item.id}
              onDismiss={() => void dismiss(item.id)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={fetching}
              onRefresh={() => void load()}
              testID="announcements-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>No announcements from this server.</Body>
            </View>
          }
        />
      )}
    </View>
  )
}
