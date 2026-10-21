// Notifications screen (W4): filter chips over one list, a visible
// grouped/flat toggle (grouped where the backend supports it, flat fallback
// as before), per-type receive config on the Misskey family (via the
// existing `me()`/`updateProfile` ext-bag surface — no invented wire
// calls), a live unread counter from the query cache (N18), and list state
// in react-query (`useNotificationsQuery`, keyed by
// `notificationsQueryKey` — sessionId FIRST, so switching accounts never
// shows the previous account's rows).

import {useEffect, useMemo, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'

import {
  NOTIFICATION_FILTER_PRESETS,
  isUnsupportedError,
  type Backend,
  type Notification,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {SignInButton} from '#/components/SignInButton'
import {useActiveBackend} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {
  notificationsItems,
  useMarkNotificationsRead,
  useNotificationsQuery,
  useUnreadNotificationsCount,
} from '#/state/queries/notifications'

// Kept for existing co-located tests importing the row from this module.
export {NotificationRow} from '#/components/Notification/NotificationRow'
import {NotificationRow} from '#/components/Notification/NotificationRow'

// --- Per-type receive config (Misskey family) -------------------------------
//
// v1 behavior (`routes/Notifications.tsx`): the viewer carries
// `notificationRecieveConfig` (wire spelling) in the `i` bag; the panel
// edits it per filter preset and saves through `updateProfile({ext})`.
// Both surfaces already exist on `Backend` (`me()` packs the full `i` bag
// into `ext.me`; `updateProfile` passes `ext` through verbatim), so this is
// backend-only transport — no invented wire calls. The Mastodon backend
// ignores `ext` (no such surface), so there the toggle renders honestly
// disabled with a reason.

const RECEIVE_OPTIONS: Array<{value: string; label: string}> = [
  {value: '', label: 'Default'},
  {value: 'never', label: 'Never'},
  {value: 'following', label: 'Following'},
  {value: 'follower', label: 'Follower'},
  {value: 'mutualFollow', label: 'Mutual'},
  {value: 'followingOrFollower', label: 'Either'},
  {value: 'list', label: 'List'},
]

function readReceiveConfig(me: {ext: {me?: Record<string, unknown>}} | null): Record<string, string> {
  const raw = me?.ext.me?.['notificationRecieveConfig']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function ReceiveConfigSection({backend}: {backend: Backend}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (backend.family !== 'misskey') {
    return (
      <View style={[atoms.px_md, atoms.py_sm]}>
        <Button
          label="Notification settings"
          variant="secondary"
          onPress={() => {}}
          disabled
          disabledReason="Per-type notification settings are only available on Misskey-family servers."
          testID="notifications-settings"
        />
      </View>
    )
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const me = await backend.me()
      setConfig(readReceiveConfig(me))
      setOpen(true)
    } catch (err) {
      setError(
        isUnsupportedError(err)
          ? 'Notification settings are not on this server.'
          : 'Could not load notification settings.',
      )
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await backend.updateProfile({ext: {notificationRecieveConfig: config}})
      setOpen(false)
    } catch (err) {
      setError(
        isUnsupportedError(err)
          ? 'Notification settings are not on this server.'
          : 'Could not save notification settings.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={[atoms.px_md, atoms.py_sm]}>
      <Button
        label={loading ? 'Loading settings…' : 'Notification settings'}
        variant="secondary"
        onPress={() => {
          if (open) setOpen(false)
          else void load()
        }}
        disabled={loading}
        disabledReason="Loading notification settings."
        testID="notifications-settings"
      />
      {error ? <Caption color="faint">{error}</Caption> : null}
      {open ? (
        <View testID="notifications-settings-panel">
          <Caption color="faint">
            Choose who notifies you, per type. Empty means the server default.
          </Caption>
          {NOTIFICATION_FILTER_PRESETS.filter(p => p.id !== 'all').map(preset => (
            <View key={preset.id} testID={`notifications-settings-row-${preset.id}`}>
              <Caption>{preset.label}</Caption>
              <View style={[atoms.row, atoms.gap_sm]}>
                {RECEIVE_OPTIONS.map(opt => {
                  const selected = (config[preset.id] ?? '') === opt.value
                  return (
                    <Button
                      key={opt.value || 'default'}
                      label={opt.label}
                      variant={selected ? 'primary' : 'secondary'}
                      onPress={() =>
                        setConfig(c => ({...c, [preset.id]: opt.value}))
                      }
                      testID={`notifications-settings-option-${preset.id}-${opt.value || 'default'}`}
                    />
                  )
                })}
              </View>
            </View>
          ))}
          <Button
            label={saving ? 'Saving…' : 'Save'}
            variant="primary"
            onPress={() => void save()}
            disabled={saving}
            disabledReason="Saving notification settings."
            testID="notifications-settings-save"
          />
        </View>
      ) : null}
    </View>
  )
}

// --- Screen ------------------------------------------------------------------

export function NotificationsScreen() {
  const {session, backend} = useActiveBackend()
  const [filterId, setFilterId] = useState('all')
  const [groupedPref, setGroupedPref] = useState(true)
  const [groupedUnsupported, setGroupedUnsupported] = useState(false)

  const preset = NOTIFICATION_FILTER_PRESETS.find(p => p.id === filterId) ?? NOTIFICATION_FILTER_PRESETS[0]

  const query = useNotificationsQuery(
    session?.id ?? null,
    filterId,
    {includeTypes: preset.includeTypes, excludeTypes: preset.excludeTypes},
    groupedPref,
    {backend: backend ?? null},
  )
  const items = useMemo(() => notificationsItems(query.data), [query.data])
  const unread = useUnreadNotificationsCount(session?.id ?? null)
  const markRead = useMarkNotificationsRead(session?.id ?? null, {backend: backend ?? null})

  // Grouped rows are not universal: Misskey servers without
  // `i/notifications-grouped` answer unsupported (the Mastodon backend
  // already prefers v2 with a v1 fallback internally). Fall back to the
  // flat listing and say so — never an error wall.
  useEffect(() => {
    if (groupedPref && query.isError && isUnsupportedError(query.error)) {
      setGroupedPref(false)
      setGroupedUnsupported(true)
    }
  }, [groupedPref, query.isError, query.error])

  const markError = markRead.error
    ? isUnsupportedError(markRead.error)
      ? 'Mark-all-read is not on this server.'
      : markRead.error.message === 'Sign in to mark notifications read.'
        ? 'Sign in to mark notifications read.'
        : 'Could not mark notifications read.'
    : null

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
          <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="notification-grouping">
            <Button
              label="Grouped"
              variant={groupedPref ? 'primary' : 'secondary'}
              onPress={() => {
                setGroupedPref(true)
                setGroupedUnsupported(false)
              }}
              testID="notification-grouping-grouped"
            />
            <Button
              label="Flat"
              variant={groupedPref ? 'secondary' : 'primary'}
              onPress={() => setGroupedPref(false)}
              testID="notification-grouping-flat"
            />
          </View>
          {groupedUnsupported ? (
            <View style={[atoms.px_md]}>
              <Caption color="faint" testID="notification-grouping-fallback">
                Grouped rows are not on this server — showing a flat list.
              </Caption>
            </View>
          ) : null}
          {unread != null && unread > 0 ? (
            <View style={[atoms.px_md]}>
              <Caption color="faint" testID="notifications-unread">
                {`${unread} new`}
              </Caption>
            </View>
          ) : null}
          <View style={[atoms.px_md, atoms.py_sm]}>
            <Button
              label={markRead.isPending ? 'Marking read…' : 'Mark all read'}
              variant="secondary"
              onPress={() => markRead.mutate()}
              disabled={markRead.isPending}
              disabledReason="Marking notifications read."
              testID="notifications-mark-read"
            />
            {markError ? <Caption color="faint">{markError}</Caption> : null}
          </View>
          <ReceiveConfigSection backend={backend} />
          {query.isPending ? (
            <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
              <Loader testID="notifications-loading" />
              <Caption color="faint">Loading…</Caption>
            </View>
          ) : query.isError && items.length === 0 ? (
            <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
              <Body>Could not load notifications.</Body>
              <Button
                label="Retry"
                variant="secondary"
                onPress={() => void query.refetch()}
                testID="notifications-retry"
              />
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item: Notification) => item.id}
              renderItem={({item}) => <NotificationRow notification={item} />}
              refreshControl={
                <RefreshControl
                  refreshing={query.isRefetching}
                  onRefresh={() => void query.refetch()}
                />
              }
              onEndReached={() => {
                if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
              }}
              onEndReachedThreshold={0.5}
              ListEmptyComponent={
                <View style={[atoms.centered, atoms.p_md]}>
                  <Body>No notifications.</Body>
                </View>
              }
              ListFooterComponent={
                query.isFetchingNextPage ? (
                  <View style={[atoms.centered, atoms.py_sm]}>
                    <Loader testID="notifications-more-loading" />
                  </View>
                ) : query.isFetchNextPageError ? (
                  <View style={[atoms.centered, atoms.gap_sm, atoms.py_sm]}>
                    <Caption color="faint">Could not load more.</Caption>
                    <Button
                      label="Retry"
                      variant="secondary"
                      onPress={() => void query.fetchNextPage()}
                      testID="notifications-more-retry"
                    />
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
