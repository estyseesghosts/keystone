import {useCallback, useEffect, useRef, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'

import {
  NOTIFICATION_FILTER_PRESETS,
  appendOlder,
  displayNameOf,
  isUnsupportedError,
  type Cursor,
  type Notification,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {SignInButton} from '#/components/SignInButton'
import {useActiveBackend} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'

// Notifications: Mastodon grouped rows (v2, v1 fallback inside the
// backend) and Misskey flat/grouped rows. Filter chips map to
// include/exclude type presets — one list, never a second list UI.
// Mark-all-read is read-path only: it calls the backend's mutation when
// signed in, and renders disabled-with-reason otherwise.

function actorNames(notification: Notification): string {
  const names = notification.actors.map(a =>
    a.account ? displayNameOf(a.account) : `…${a.id.slice(-6)}`,
  )
  return names.length > 0 ? names.join(', ') : 'Someone'
}

function kindLabel(notification: Notification): string {
  switch (notification.kind) {
    case 'follow':
      return 'followed you'
    case 'mention':
      return 'mentioned you'
    case 'reply':
      return 'replied to you'
    case 'renote':
      return 'reposted your post'
    case 'quote':
      return 'quoted your post'
    case 'reaction':
      return notification.reaction ? `reacted ${notification.reaction}` : 'reacted to your post'
    case 'favourite':
      return 'liked your post'
    case 'pollVote':
      return 'voted in your poll'
    case 'pollEnded':
      return 'a poll ended'
    case 'receiveFollowRequest':
      return 'requested to follow you'
    case 'followRequestAccepted':
      return 'accepted your follow request'
    case 'achievement':
      return 'earned an achievement'
    case 'app':
      return 'sent an update'
    case 'unknown':
    default:
      return notification.rawType || 'sent a notification'
  }
}

export function NotificationRow({notification}: {notification: Notification}) {
  const excerpt = notification.post?.content.plain
  return (
    <View testID={`notification-${notification.id}`} style={[atoms.py_sm, atoms.px_md]}>
      <Body>{`${actorNames(notification)} ${kindLabel(notification)}`}</Body>
      {excerpt ? (
        <Caption color="faint" numberOfLines={2}>
          {excerpt.slice(0, 140)}
        </Caption>
      ) : null}
      <Caption color="faint">{notification.createdAt}</Caption>
      {notification.read === true ? <Caption color="faint">Read</Caption> : null}
      {notification.read === false ? <Caption color="faint">New</Caption> : null}
    </View>
  )
}

export function NotificationsScreen() {
  const {session, backend} = useActiveBackend()
  const [filterId, setFilterId] = useState('all')
  const [items, setItems] = useState<Notification[]>([])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [fetchingMore, setFetchingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [groupedMode, setGroupedMode] = useState<'grouped' | 'flat'>('grouped')
  const [markingRead, setMarkingRead] = useState(false)
  const [markError, setMarkError] = useState<string | null>(null)
  const generationRef = useRef(0)

  const preset = NOTIFICATION_FILTER_PRESETS.find(p => p.id === filterId) ?? NOTIFICATION_FILTER_PRESETS[0]

  const loadFirst = useCallback(async () => {
    if (!session || !backend) {
      setLoading(false)
      return
    }
    const generation = ++generationRef.current
    setFetching(true)
    setError(null)
    try {
      const base = {includeTypes: preset.includeTypes, excludeTypes: preset.excludeTypes}
      let page
      try {
        page = await backend.notifications({...base, grouped: true})
        if (generationRef.current !== generation) return
        setGroupedMode('grouped')
      } catch (err) {
        // Grouped rows are not universal: Misskey servers without
        // `i/notifications-grouped` and Mastodon servers without the v2
        // envelope fall back to the flat listing (the Mastodon backend
        // already prefers v2 with a v1 fallback internally).
        if (!isUnsupportedError(err)) throw err
        if (generationRef.current !== generation) return
        page = await backend.notifications({...base, grouped: false})
        if (generationRef.current !== generation) return
        setGroupedMode('flat')
      }
      setItems(page.items)
      setCursor(page.cursor)
      setHasMore(!page.end)
    } catch (err) {
      if (generationRef.current !== generation) return
      setError(err)
    } finally {
      if (generationRef.current === generation) {
        setLoading(false)
        setFetching(false)
      }
    }
  }, [session, backend, filterId])

  useEffect(() => {
    setItems([])
    setCursor(null)
    setHasMore(true)
    setLoading(true)
    setError(null)
    void loadFirst()
  }, [loadFirst])

  const fetchMore = useCallback(async () => {
    if (!session || !backend || fetchingMore || loading || !hasMore) return
    const generation = generationRef.current
    setFetchingMore(true)
    try {
      const page = await backend.notifications({
        includeTypes: preset.includeTypes,
        excludeTypes: preset.excludeTypes,
        grouped: groupedMode === 'grouped',
        cursor,
      })
      if (generationRef.current !== generation) return
      setItems(prev => appendOlder(prev, page.items).items)
      setCursor(page.cursor)
      setHasMore(!page.end)
    } catch {
      // Paging failures keep the loaded rows; refresh retries the head.
    } finally {
      if (generationRef.current === generation) setFetchingMore(false)
    }
  }, [session, backend, cursor, fetchingMore, loading, hasMore, groupedMode, filterId])

  const markAllRead = useCallback(async () => {
    if (!session || !backend || markingRead) return
    setMarkingRead(true)
    setMarkError(null)
    try {
      await backend.markNotificationsRead()
      await loadFirst()
    } catch (err) {
      setMarkError(
        isUnsupportedError(err)
          ? 'Mark-all-read is not on this server.'
          : 'Could not mark notifications read.',
      )
    } finally {
      setMarkingRead(false)
    }
  }, [session, backend, markingRead, loadFirst])

  return (
    <View style={atoms.flex1} testID="notifications-screen">
      <Pagehead title="Notifications" />
      {!session || !backend ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>Sign in to see notifications.</Body>
          <Caption color="faint">Notifications never show sample data when signed out.</Caption>
          <SignInButton />
        </View>
      ) : (
        <View style={atoms.flex1}>
          <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="notification-filters">
            {NOTIFICATION_FILTER_PRESETS.map(p => (
              <Button
                key={p.id}
                label={p.label}
                variant={p.id === filterId ? 'primary' : 'secondary'}
                onPress={() => setFilterId(p.id)}
                testID={`notification-filter-${p.id}`}
              />
            ))}
          </View>
          <View style={[atoms.px_md, atoms.py_sm]}>
            <Button
              label={markingRead ? 'Marking read…' : 'Mark all read'}
              variant="secondary"
              onPress={() => void markAllRead()}
              disabled={markingRead}
              disabledReason="Marking notifications read."
              testID="notifications-mark-read"
            />
            {markError ? <Caption color="faint">{markError}</Caption> : null}
          </View>
          {loading ? (
            <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
              <Loader testID="notifications-loading" />
              <Caption color="faint">Loading…</Caption>
            </View>
          ) : error ? (
            <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
              <Body>Could not load notifications.</Body>
              <Button label="Retry" variant="secondary" onPress={() => void loadFirst()} testID="notifications-retry" />
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={item => item.id}
              renderItem={({item}) => <NotificationRow notification={item} />}
              refreshControl={
                <RefreshControl refreshing={fetching} onRefresh={() => void loadFirst()} />
              }
              onEndReached={() => void fetchMore()}
              onEndReachedThreshold={0.5}
              ListEmptyComponent={
                <View style={[atoms.centered, atoms.p_md]}>
                  <Body>No notifications.</Body>
                </View>
              }
              ListFooterComponent={
                fetchingMore ? (
                  <View style={[atoms.centered, atoms.py_sm]}>
                    <Loader testID="notifications-more-loading" />
                  </View>
                ) : null
              }
            />
          )}
        </View>
      )}
    </View>
  )
}
