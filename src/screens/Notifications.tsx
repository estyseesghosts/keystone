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
import {useQueryClient, type InfiniteData} from '@tanstack/react-query'

import {msg, plural} from '@lingui/macro'

import {
  handleOf,
  httpStatusOf,
  isUnsupportedError,
  notificationFilterPresets,
  type Backend,
  type Cursor,
  type Notification,
  type NotificationPolicy,
  type NotificationPolicyPatch,
  type NotificationRequest,
  type Page,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {Loader} from '#/components/Loader'
import {SkeletonList} from '#/components/Skeleton'
import {SignInButton} from '#/components/SignInButton'
import {Tabs} from '#/components/Tabs'
import {i18n} from '#/locale/i18n'
import {useActiveBackend} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {useLiveNotifications} from '#/state/streaming'
import {usePagedLoad, useRefreshFirstPage} from '#/state/queries/usePagedLoad'
import {
  notificationsItems,
  useClearNotifications,
  useDismissNotification,
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

function receiveOptionLabel(value: string): string {
  switch (value) {
    case 'never':
      return i18n._(msg`Never`);
    case 'following':
      return i18n._(msg`Following`);
    case 'follower':
      return i18n._(msg`Follower`);
    case 'mutualFollow':
      return i18n._(msg`Mutual`);
    case 'followingOrFollower':
      return i18n._(msg`Either`);
    case 'list':
      return i18n._(msg`List`);
    default:
      return i18n._(msg`Default`);
  }
}

const RECEIVE_OPTIONS: Array<{value: string}> = [
  {value: ''},
  {value: 'never'},
  {value: 'following'},
  {value: 'follower'},
  {value: 'mutualFollow'},
  {value: 'followingOrFollower'},
  {value: 'list'},
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
          label={i18n._(msg`Notification settings`)}
          variant="secondary"
          onPress={() => {}}
          disabled
          disabledReason={i18n._(msg`Per-type notification settings are only available on Misskey-family servers.`)}
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
          ? i18n._(msg`Notification settings are not on this server.`)
          : i18n._(msg`Could not load notification settings.`),
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
          ? i18n._(msg`Notification settings are not on this server.`)
          : i18n._(msg`Could not save notification settings.`),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={[atoms.px_md, atoms.py_sm]}>
      <Button
        label={loading ? i18n._(msg`Loading settings…`) : i18n._(msg`Notification settings`)}
        variant="secondary"
        onPress={() => {
          if (open) setOpen(false)
          else void load()
        }}
        disabled={loading}
        disabledReason={i18n._(msg`Loading notification settings.`)}
        testID="notifications-settings"
      />
      {error ? <Caption color="faint">{error}</Caption> : null}
      {open ? (
        <View testID="notifications-settings-panel">
          <Caption color="faint">
            {i18n._(msg`Choose who notifies you, per type. Empty means the server default.`)}
          </Caption>
          {notificationFilterPresets(backend.family).filter(p => p.id !== 'all').map(preset => (
            <View key={preset.id} testID={`notifications-settings-row-${preset.id}`}>
              <Caption>{preset.label}</Caption>
              <Tabs
                tabs={RECEIVE_OPTIONS.map(opt => ({
                  key: opt.value || 'default',
                  label: receiveOptionLabel(opt.value),
                }))}
                active={config[preset.id] ?? 'default'}
                onChange={key =>
                  setConfig(c => ({...c, [preset.id]: key === 'default' ? '' : key}))
                }
                testID={`notifications-settings-options-${preset.id}`}
                testIDPrefix={`notifications-settings-option-${preset.id}`}
                accessibilityLabel={preset.label}
              />
            </View>
          ))}
          <Button
            label={saving ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
            variant="primary"
            onPress={() => void save()}
            disabled={saving}
            disabledReason={i18n._(msg`Saving notification settings.`)}
            testID="notifications-settings-save"
          />
        </View>
      ) : null}
    </View>
  )
}

// --- Filtered notification requests (Mastodon 4.3+, repair X4.5) -------------
//
// Mastodon 4.3+ files notifications from filtered accounts under "requests"
// instead of the main list; without support every filtered item stays in
// the MAIN list, so nothing ever silently vanishes. Support is probed,
// never flavor-guessed: the entry shows while unknown, hides WITH a reason
// when a requests/policy call 404/405s, and opens the inbox + policy
// editor when the server answers.
//
// State here is per-screen (the section remounts per session via `key` at
// the call site) — the queries directory is owned by other slices, so no
// cached query keys are added and switching accounts refetches from
// scratch. Dismiss/clear regions below belong to X4.1 and are untouched.

type PolicyFilterKey = keyof NotificationPolicyPatch

function NotificationRequestsSection({backend, sessionId}: {backend: Backend; sessionId: string}) {
  const api = backend.notificationRequests ?? null
  const [support, setSupport] = useState<'unknown' | 'supported' | 'unsupported'>(() => {
    if (api == null) return 'unsupported'
    const probed = api.isSupported()
    return probed === true ? 'supported' : probed === false ? 'unsupported' : 'unknown'
  })
  const [open, setOpen] = useState(false)
  const [policy, setPolicy] = useState<NotificationPolicy | null>(null)
  const [draft, setDraft] = useState<NotificationPolicyPatch>({})
  const [policyLoading, setPolicyLoading] = useState(false)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [items, setItems] = useState<NotificationRequest[]>([])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [end, setEnd] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [actionError, setActionError] = useState<string | null>(null)

  // Probe-on-mount via the policy read (one request per origin per launch
  // at most: the verdict caches in the backend module). No member (Misskey
  // family) never probes — there is nothing to ask.
  useEffect(() => {
    if (api == null) return
    if (api.isSupported() === false) {
      setSupport('unsupported')
      return
    }
    let cancelled = false
    setPolicyLoading(true)
    setPolicyError(null)
    void api
      .policy()
      .then(p => {
        if (cancelled) return
        setPolicy(p)
        setDraft({
          ...(p.filterNotFollowing == null ? {} : {filterNotFollowing: p.filterNotFollowing}),
          ...(p.filterNotFollowers == null ? {} : {filterNotFollowers: p.filterNotFollowers}),
          ...(p.filterNewAccounts == null ? {} : {filterNewAccounts: p.filterNewAccounts}),
          ...(p.filterPrivateMentions == null ? {} : {filterPrivateMentions: p.filterPrivateMentions}),
        })
        setSupport('supported')
      })
      .catch(err => {
        if (cancelled) return
        if (isUnsupportedError(err)) setSupport('unsupported')
        else setPolicyError(i18n._(msg`Could not load the filter policy.`))
      })
      .finally(() => {
        if (!cancelled) setPolicyLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, sessionId])

  const loadList = (nextCursor: Cursor | null, append: boolean) => {
    if (api == null || listLoading) return
    setListLoading(true)
    setListError(null)
    void api
      .list({cursor: nextCursor, limit: 20})
      .then(page => {
        setItems(prev =>
          append
            ? [...prev, ...page.items.filter(i => !prev.some(p => p.id === i.id))]
            : page.items,
        )
        setCursor(page.cursor)
        setEnd(page.end)
        setSupport('supported')
      })
      .catch(err => {
        if (isUnsupportedError(err)) setSupport('unsupported')
        else setListError(i18n._(msg`Could not load filtered notifications.`))
      })
      .finally(() => setListLoading(false))
  }

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    if (next && items.length === 0 && !listLoading) loadList(null, false)
  }

  const runRequestAction = (id: string, kind: 'accept' | 'dismiss') => {
    if (api == null || pendingIds.includes(id)) return
    setPendingIds(prev => [...prev, id])
    setActionError(null)
    void (kind === 'accept' ? api.accept(id) : api.dismiss(id))
      .then(() => {
        setItems(prev => prev.filter(i => i.id !== id))
        // The badge count is server state: refetch it, never a local guess.
        return api.policy()
      })
      .then(p => setPolicy(p))
      .catch(err => {
        if (isUnsupportedError(err)) setSupport('unsupported')
        else
          setActionError(
            kind === 'accept'
              ? i18n._(msg`Could not accept that request.`)
              : i18n._(msg`Could not dismiss that request.`),
          )
      })
      .finally(() => setPendingIds(prev => prev.filter(x => x !== id)))
  }

  const savePolicy = () => {
    if (api == null || saving) return
    const patch: NotificationPolicyPatch = {
      ...(policy?.filterNotFollowing == null || draft.filterNotFollowing === undefined
        ? {}
        : {filterNotFollowing: draft.filterNotFollowing}),
      ...(policy?.filterNotFollowers == null || draft.filterNotFollowers === undefined
        ? {}
        : {filterNotFollowers: draft.filterNotFollowers}),
      ...(policy?.filterNewAccounts == null || draft.filterNewAccounts === undefined
        ? {}
        : {filterNewAccounts: draft.filterNewAccounts}),
      ...(policy?.filterPrivateMentions == null || draft.filterPrivateMentions === undefined
        ? {}
        : {filterPrivateMentions: draft.filterPrivateMentions}),
    }
    setSaving(true)
    setSaveError(null)
    void api
      .updatePolicy(patch)
      .then(p => {
        setPolicy(p)
        setDraft({
          ...(p.filterNotFollowing == null ? {} : {filterNotFollowing: p.filterNotFollowing}),
          ...(p.filterNotFollowers == null ? {} : {filterNotFollowers: p.filterNotFollowers}),
          ...(p.filterNewAccounts == null ? {} : {filterNewAccounts: p.filterNewAccounts}),
          ...(p.filterPrivateMentions == null ? {} : {filterPrivateMentions: p.filterPrivateMentions}),
        })
      })
      .catch(err => {
        if (isUnsupportedError(err)) setSupport('unsupported')
        else setSaveError(i18n._(msg`Could not save the filter policy.`))
      })
      .finally(() => setSaving(false))
  }

  if (api == null) {
    return (
      <View style={[atoms.px_md, atoms.py_sm]}>
        <Caption color="faint" testID="notifications-requests-unavailable">
          {i18n._(msg`Filtered notifications are only on Mastodon-family servers. Everything stays in the main list.`)}
        </Caption>
      </View>
    )
  }

  if (support === 'unsupported') {
    return (
      <View style={[atoms.px_md, atoms.py_sm]}>
        <Caption color="faint" testID="notifications-requests-unavailable">
          {i18n._(msg`Filtered notifications are not on this server. Everything stays in the main list.`)}
        </Caption>
      </View>
    )
  }

  const policyRows: Array<{key: PolicyFilterKey; label: string}> = [
    {key: 'filterNotFollowing', label: i18n._(msg`From people you don't follow`)},
    {key: 'filterNotFollowers', label: i18n._(msg`From people who don't follow you`)},
    {key: 'filterNewAccounts', label: i18n._(msg`From new accounts`)},
    {key: 'filterPrivateMentions', label: i18n._(msg`Private mentions`)},
  ]
  const pending = policy?.pendingRequestsCount

  return (
    <View style={[atoms.px_md, atoms.py_sm]}>
      <Button
        label={i18n._(msg`Filtered notifications`)}
        variant="secondary"
        onPress={toggleOpen}
        disabled={policyLoading}
        disabledReason={i18n._(msg`Loading the filter policy.`)}
        testID="notifications-requests-entry"
      />
      {typeof pending === 'number' && pending > 0 ? (
        <Caption color="faint" testID="notifications-requests-count">
          {i18n._(
            plural(pending, {
              one: '# filtered notification',
              other: '# filtered notifications',
            }),
          )}
        </Caption>
      ) : null}
      {policyLoading ? <Loader testID="notifications-requests-policy-loading" /> : null}
      {policyError ? <Caption color="faint">{policyError}</Caption> : null}
      {policyError ? (
        <Button
          label={i18n._(msg`Retry`)}
          variant="secondary"
          onPress={() => {
            if (api.isSupported() === false) setSupport('unsupported')
            else {
              setPolicyLoading(true)
              setPolicyError(null)
              void api
                .policy()
                .then(p => {
                  setPolicy(p)
                  setDraft({
                    ...(p.filterNotFollowing == null
                      ? {}
                      : {filterNotFollowing: p.filterNotFollowing}),
                    ...(p.filterNotFollowers == null
                      ? {}
                      : {filterNotFollowers: p.filterNotFollowers}),
                    ...(p.filterNewAccounts == null ? {} : {filterNewAccounts: p.filterNewAccounts}),
                    ...(p.filterPrivateMentions == null
                      ? {}
                      : {filterPrivateMentions: p.filterPrivateMentions}),
                  })
                  setSupport('supported')
                })
                .catch(err => {
                  if (isUnsupportedError(err)) setSupport('unsupported')
                  else setPolicyError(i18n._(msg`Could not load the filter policy.`))
                })
                .finally(() => setPolicyLoading(false))
            }
          }}
          testID="notifications-requests-policy-retry"
        />
      ) : null}
      {policy != null && !policyLoading ? (
        <View testID="notifications-requests-policy">
          <Caption color="faint">
            {i18n._(msg`Choose which notifications wait here instead of the main list.`)}
          </Caption>
          {policyRows.map(row => (
            <View key={row.key} testID={`notifications-requests-policy-${row.key}`}>
              <Caption>{row.label}</Caption>
              {policy[row.key] == null ? (
                <Caption color="faint" testID={`notifications-requests-policy-${row.key}-unknown`}>
                  {i18n._(msg`Not reported by this server.`)}
                </Caption>
              ) : (
                <Tabs
                  tabs={[
                    {key: 'on', label: i18n._(msg`On`)},
                    {key: 'off', label: i18n._(msg`Off`)},
                  ]}
                  active={(draft[row.key] ?? policy[row.key] ?? false) ? 'on' : 'off'}
                  onChange={key => setDraft(d => ({...d, [row.key]: key === 'on'}))}
                  testID={`notifications-requests-policy-${row.key}-options`}
                  testIDPrefix={`notifications-requests-policy-${row.key}-option`}
                  accessibilityLabel={row.label}
                />
              )}
            </View>
          ))}
          <Button
            label={saving ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
            variant="primary"
            onPress={savePolicy}
            disabled={saving}
            disabledReason={i18n._(msg`Saving the filter policy.`)}
            testID="notifications-requests-policy-save"
          />
          {saveError ? <Caption color="faint">{saveError}</Caption> : null}
        </View>
      ) : null}
      {open ? (
        <View testID="notifications-requests-list">
          {listLoading && items.length === 0 ? (
            <Loader testID="notifications-requests-loading" />
          ) : null}
          {listError ? <Caption color="faint">{listError}</Caption> : null}
          {listError ? (
            <Button
              label={i18n._(msg`Retry`)}
              variant="secondary"
              onPress={() => loadList(null, false)}
              testID="notifications-requests-retry"
            />
          ) : null}
          {items.map(req => {
            const busy = pendingIds.includes(req.id)
            return (
              <View key={req.id} testID={`notification-request-${req.id}`}>
                <Body>{req.account ? handleOf(req.account) : i18n._(msg`Someone`)}</Body>
                <Button
                  label={busy ? i18n._(msg`Accepting…`) : i18n._(msg`Accept`)}
                  variant="secondary"
                  onPress={() => runRequestAction(req.id, 'accept')}
                  disabled={busy}
                  disabledReason={i18n._(msg`Working on this request.`)}
                  testID={`notification-request-accept-${req.id}`}
                />
                <Button
                  label={busy ? i18n._(msg`Dismissing…`) : i18n._(msg`Dismiss`)}
                  variant="secondary"
                  onPress={() => runRequestAction(req.id, 'dismiss')}
                  disabled={busy}
                  disabledReason={i18n._(msg`Working on this request.`)}
                  testID={`notification-request-dismiss-${req.id}`}
                />
              </View>
            )
          })}
          {!listLoading && items.length === 0 && listError == null ? (
            <Body>{i18n._(msg`No filtered notifications.`)}</Body>
          ) : null}
          {!end && !listLoading ? (
            <Button
              label={i18n._(msg`Show more`)}
              variant="secondary"
              onPress={() => loadList(cursor, true)}
              testID="notifications-requests-more"
            />
          ) : null}
          {listLoading && items.length > 0 ? (
            <Loader testID="notifications-requests-more-loading" />
          ) : null}
          {actionError ? <Caption color="faint">{actionError}</Caption> : null}
        </View>
      ) : null}
    </View>
  )
}

// --- Screen ------------------------------------------------------------------

export function NotificationsScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const [filterId, setFilterId] = useState('all')
  const [groupedPref, setGroupedPref] = useState(true)
  const [groupedUnsupported, setGroupedUnsupported] = useState(false)
  // Dismiss/clear are Mastodon-family actions (clickstone §1.11). Clear
  // still hides with a reason when the server answers 404/405 (a fork
  // without the route never gets an error wall or an inert button);
  // dismiss never hides from errors — a 404 on one id is "already gone".
  const [dismissUnsupported, setDismissUnsupported] = useState(false)
  const [clearUnsupported, setClearUnsupported] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const presets = useMemo(
    () => notificationFilterPresets(backend?.family ?? 'misskey'),
    [backend?.family],
  )
  const preset = presets.find(p => p.id === filterId) ?? presets[0]

  const query = useNotificationsQuery(
    session?.id ?? null,
    filterId,
    {includeTypes: preset.includeTypes, excludeTypes: preset.excludeTypes},
    groupedPref,
    {backend: backend ?? null},
  )
  // Live notification channel (WS-G S4): arrivals ingest into the
  // session's caches, so the unread badge and the `all` listing update
  // without a reload. Paging-only when streaming is unsupported.
  useLiveNotifications(session?.id ?? null, backend ?? null)
  const items = useMemo(() => notificationsItems(query.data), [query.data])
  const unread = useUnreadNotificationsCount(session?.id ?? null)
  const markRead = useMarkNotificationsRead(session?.id ?? null, {backend: backend ?? null})
  const dismiss = useDismissNotification(session?.id ?? null, {backend: backend ?? null})
  const clear = useClearNotifications(session?.id ?? null, {backend: backend ?? null})
  const queryClient = useQueryClient()

  // Paging (X3.3): both auto-load sites go through the shared gate, so
  // a failed page or a 429 cooldown never loops — only the footer Retry
  // fetches again. Refresh trims to the first page first (one request).
  const paged = usePagedLoad(query)
  const onRefresh = useRefreshFirstPage(query.queryKey, query.refetch)

  const family = backend?.family ?? null
  const canDismiss =
    family === 'mastodon' && !dismissUnsupported && typeof backend?.dismissNotification === 'function'
  const canClear =
    family === 'mastodon' && !clearUnsupported && typeof backend?.clearNotifications === 'function'

  /** One dismiss: a 404 on the id means the row is already gone
   * server-side, so it is dropped from this session's cached pages (never
   * an "unsupported" hiding — support is never decided from errors);
   * anything else is surfaced as a message beside the list (never a faked
   * success). */
  const runDismiss = (id: string) => {
    setActionError(null)
    dismiss.mutate(id, {
      onError: err => {
        if (httpStatusOf(err) === 404) {
          // Already gone: the server confirmed the absence, so pruning
          // the row is convergence, not a lie. No refetch is forced —
          // the next focus/pull converges the rest of the list.
          const cached =
            queryClient.getQueryData<InfiniteData<Page<Notification>>>(query.queryKey)
          if (cached) {
            queryClient.setQueryData<InfiniteData<Page<Notification>>>(query.queryKey, {
              ...cached,
              pages: cached.pages.map(page => ({
                ...page,
                items: page.items.filter(item => item.id !== id),
              })),
            })
          }
          return
        }
        setActionError(i18n._(msg`Could not dismiss that notification.`))
      },
    })
  }

  const runClear = () => {
    setClearOpen(false)
    setActionError(null)
    clear.mutate(undefined, {
      onError: err => {
        if (isUnsupportedError(err)) {
          setClearUnsupported(true)
          return
        }
        setActionError(i18n._(msg`Could not clear notifications.`))
      },
    })
  }

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

  // A preset the current family cannot serve (Misskey `system`/`notes`
  // after switching to a Mastodon account) falls back to "All" — the chip
  // is gone, so the selection must not stay on a filter that is not there.
  useEffect(() => {
    if (!presets.some(p => p.id === filterId)) setFilterId('all')
  }, [presets, filterId])

  // Endpoint support is per SERVER: a new session starts from "unknown but
  // offered", never from the previous server's 404.
  useEffect(() => {
    setDismissUnsupported(false)
    setClearUnsupported(false)
    setActionError(null)
  }, [session?.id])

  const markError = markRead.error
    ? isUnsupportedError(markRead.error)
      ? i18n._(msg`Mark-all-read is not on this server.`)
      : markRead.error.message === 'Sign in to mark notifications read.'
        ? i18n._(msg`Sign in to mark notifications read.`)
        : i18n._(msg`Could not mark notifications read.`)
    : null

  return (
    <View style={atoms.flex1} testID="notifications-screen">
      <Pagehead title="Notifications" />
      {!session || !backend ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>{i18n._(msg`Sign in to see notifications.`)}</Body>
          <Caption color="faint">{i18n._(msg`Notifications never show sample data when signed out.`)}</Caption>
          <SignInButton />
        </View>
      ) : (
        <View style={atoms.flex1}>
          <Tabs
            tabs={presets.map(p => ({key: p.id, label: p.label}))}
            active={filterId}
            onChange={setFilterId}
            testID="notification-filters"
            testIDPrefix="notification-filter"
            accessibilityLabel="Notification filters"
          />
          <Tabs
            tabs={[
              {key: 'grouped', label: i18n._(msg`Grouped`)},
              {key: 'flat', label: i18n._(msg`Flat`)},
            ]}
            active={groupedPref ? 'grouped' : 'flat'}
            onChange={key => {
              if (key === 'grouped') {
                setGroupedPref(true)
                setGroupedUnsupported(false)
              } else {
                setGroupedPref(false)
              }
            }}
            testID="notification-grouping"
            testIDPrefix="notification-grouping"
            accessibilityLabel="Notification grouping"
          />
          {groupedUnsupported ? (
            <View style={[atoms.px_md]}>
              <Caption color="faint" testID="notification-grouping-fallback">
                {i18n._(msg`Grouped rows are not on this server — showing a flat list.`)}
              </Caption>
            </View>
          ) : null}
          {unread != null && unread > 0 ? (
            <View style={[atoms.px_md]}>
              <Caption color="faint" testID="notifications-unread">
                {i18n._(msg`${unread} new`)}
              </Caption>
            </View>
          ) : null}
          <View style={[atoms.px_md, atoms.py_sm]}>
            <Button
              label={markRead.isPending ? i18n._(msg`Marking read…`) : i18n._(msg`Mark all read`)}
              variant="secondary"
              onPress={() => markRead.mutate()}
              disabled={markRead.isPending}
              disabledReason={i18n._(msg`Marking notifications read.`)}
              testID="notifications-mark-read"
            />
            {canClear ? (
              <Button
                label={clear.isPending ? i18n._(msg`Clearing…`) : i18n._(msg`Clear all`)}
                variant="secondary"
                onPress={() => setClearOpen(true)}
                disabled={clear.isPending || items.length === 0}
                disabledReason={
                  items.length === 0
                    ? i18n._(msg`There are no notifications to clear.`)
                    : i18n._(msg`Clearing notifications.`)
                }
                testID="notifications-clear"
              />
            ) : null}
            {markError ? <Caption color="faint">{markError}</Caption> : null}
            {family === 'mastodon' && dismissUnsupported ? (
              <Caption color="faint" testID="notifications-dismiss-unsupported">
                {i18n._(msg`Dismissing a notification is not on this server.`)}
              </Caption>
            ) : null}
            {family === 'mastodon' && clearUnsupported ? (
              <Caption color="faint" testID="notifications-clear-unsupported">
                {i18n._(msg`Clearing notifications is not on this server.`)}
              </Caption>
            ) : null}
            {actionError ? <Caption color="faint">{actionError}</Caption> : null}
          </View>
          <ReceiveConfigSection backend={backend} />
          <NotificationRequestsSection
            key={session.id}
            backend={backend}
            sessionId={session.id}
          />
          {query.isPending ? (
            <SkeletonList variant="account" testID="notifications-loading" />
          ) : query.isError && items.length === 0 ? (
            <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
              <Body>{i18n._(msg`Could not load notifications.`)}</Body>
              <Button
                label={i18n._(msg`Retry`)}
                variant="secondary"
                onPress={() => void query.refetch()}
                testID="notifications-retry"
              />
            </View>
          ) : (
            <FlatList
              data={items}
              testID="notifications-list"
              keyExtractor={(item: Notification) => item.id}
              renderItem={({item}) => (
                <NotificationRow
                  notification={item}
                  onDismiss={canDismiss ? () => runDismiss(item.id) : null}
                />
              )}
              refreshControl={
                <RefreshControl
                  refreshing={query.isRefetching}
                  onRefresh={onRefresh}
                  tintColor={theme.palette.muted}
                  colors={[theme.palette.muted]}
                  progressBackgroundColor={theme.palette.bg}
                />
              }
              onEndReached={paged.onEndReached}
              onEndReachedThreshold={2.5}
              ListEmptyComponent={
                <View style={[atoms.centered, atoms.p_md]}>
                  <Body>{i18n._(msg`No notifications.`)}</Body>
                </View>
              }
              ListFooterComponent={
                query.isFetchingNextPage ? (
                  <View style={[atoms.centered, atoms.py_sm]}>
                    <Loader testID="notifications-more-loading" />
                  </View>
                ) : query.isFetchNextPageError ? (
                  <View style={[atoms.centered, atoms.gap_sm, atoms.py_sm]}>
                    <Caption color="faint">{i18n._(msg`Could not load more.`)}</Caption>
                    {paged.cooldownLabel ? (
                      <Caption color="faint" testID="notifications-more-cooldown">
                        {paged.cooldownLabel}
                      </Caption>
                    ) : null}
                    <Button
                      label={i18n._(msg`Retry`)}
                      variant="secondary"
                      onPress={() => void query.fetchNextPage()}
                      testID="notifications-more-retry"
                    />
                  </View>
                ) : null
              }
            />
          )}
          {clearOpen ? (
            <Dialog
              open
              onClose={() => setClearOpen(false)}
              title={i18n._(msg`Clear all notifications?`)}
              testID="notifications-clear-confirm">
              <Body>{i18n._(msg`Every notification is deleted on the server. This cannot be undone.`)}</Body>
              <View style={[atoms.row, atoms.gap_sm]}>
                <Button
                  label={i18n._(msg`Cancel`)}
                  variant="secondary"
                  onPress={() => setClearOpen(false)}
                  testID="notifications-clear-cancel"
                />
                <Button label={i18n._(msg`Clear all`)} onPress={runClear} testID="notifications-clear-confirm-action" />
              </View>
            </Dialog>
          ) : null}
        </View>
      )}
    </View>
  )
}
