// Lists index (`/lists`, v1 `Lists` parity): the viewer's user lists,
// create, rename (inline), and delete (two-tap confirm). Tapping a row
// navigates to `List` with `{id}`. Gated on `backend.lists`; the
// create/update/delete members are OPTIONAL additions — when absent the
// controls render disabled with a reason, never omitted, never inert.

import {useCallback, useEffect, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {isPermissionError, isUnsupportedError} from '@keystone/fedi'
import type {
  Capabilities,
  ListFields,
  ListRepliesPolicy,
  ListSummary,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Chip} from '#/components/Composer/Chip'
import {TextField} from '#/components/forms/TextField'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'

// List reply policies (Mastodon `replies_policy`). The labels are Mastodon
// web's own (`lists.replies_policy.*`). The Misskey family has no
// equivalent and its capability flag is `unsupported`, so these render
// disabled with a reason rather than as an inert no-op.
const REPLIES_POLICIES: ReadonlyArray<{value: ListRepliesPolicy; label: string}> = [
  {value: 'list', label: 'Members of the list'},
  {value: 'followed', label: 'Any followed user'},
  {value: 'none', label: 'No one'},
]

type ListFieldGate = {enabled: true} | {enabled: false; reason: string}

function fieldGate(
  support: Capabilities[keyof Capabilities] | undefined,
  unsupportedReason: string,
  unknownReason: string,
): ListFieldGate {
  if (support === 'supported') return {enabled: true}
  return {enabled: false, reason: support === 'unsupported' ? unsupportedReason : unknownReason}
}

function repliesPolicyGate(caps: Capabilities | null | undefined): ListFieldGate {
  return fieldGate(
    caps?.lists_replies_policy,
    'This server cannot choose who replies are shown from.',
    'This server has not reported list reply settings.',
  )
}

function exclusiveGate(caps: Capabilities | null | undefined): ListFieldGate {
  return fieldGate(
    caps?.lists_exclusive,
    'This server cannot hide list members from Home.',
    'This server has not reported exclusive lists.',
  )
}

/** Only the fields the server says it supports ride along. The backend
 * repeats this check; the UI does it too so the user's choice is never
 * silently accepted and then dropped. */
function chosenListFields(
  caps: Capabilities | null | undefined,
  policy: ListRepliesPolicy,
  exclusive: boolean,
): ListFields {
  const out: ListFields = {}
  if (repliesPolicyGate(caps).enabled) out.repliesPolicy = policy
  if (exclusiveGate(caps).enabled) out.exclusive = exclusive
  return out
}

function ListFieldsEditor({
  idPrefix,
  caps,
  policy,
  exclusive,
  onPolicy,
  onExclusive,
}: {
  idPrefix: string
  caps: Capabilities | null | undefined
  policy: ListRepliesPolicy
  exclusive: boolean
  onPolicy: (value: ListRepliesPolicy) => void
  onExclusive: (value: boolean) => void
}) {
  const reply = repliesPolicyGate(caps)
  const excl = exclusiveGate(caps)
  return (
    <View style={[atoms.gap_sm]} testID={`${idPrefix}-fields`}>
      <Caption color="muted">Show replies from</Caption>
      <View style={[atoms.row, atoms.gap_sm]}>
        {REPLIES_POLICIES.map(p => (
          <Chip
            key={p.value}
            label={p.label}
            selected={policy === p.value}
            disabled={!reply.enabled}
            disabledReason={reply.enabled ? undefined : reply.reason}
            onPress={() => onPolicy(p.value)}
            testID={`${idPrefix}-policy-${p.value}`}
          />
        ))}
      </View>
      {reply.enabled ? null : <Caption color="faint">{reply.reason}</Caption>}
      <View style={[atoms.row, atoms.gap_sm]}>
        <Chip
          label="Hide members in Home"
          selected={exclusive}
          disabled={!excl.enabled}
          disabledReason={excl.enabled ? undefined : excl.reason}
          onPress={() => onExclusive(!exclusive)}
          testID={`${idPrefix}-exclusive`}
        />
      </View>
      {excl.enabled ? null : <Caption color="faint">{excl.reason}</Caption>}
    </View>
  )
}

function CreateRow({
  onCreate,
}: {
  onCreate: (name: string, fields: ListFields) => Promise<void>
}) {
  const {backend} = useActiveBackend()
  const caps = backend?.capabilities
  const [name, setName] = useState('')
  const [policy, setPolicy] = useState<ListRepliesPolicy>('list')
  const [exclusive, setExclusive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canCreate = !!backend?.lists?.create
  const submit = async () => {
    const trimmed = name.trim()
    if (trimmed.length === 0 || busy || !canCreate) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(trimmed, chosenListFields(caps, policy, exclusive))
      setName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the list.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={[atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="lists-create">
      <TextField
        label="New list"
        value={name}
        onChangeText={setName}
        placeholder="List name"
        error={error ?? undefined}
        testID="lists-create-input"
      />
      <ListFieldsEditor
        idPrefix="lists-create"
        caps={caps}
        policy={policy}
        exclusive={exclusive}
        onPolicy={setPolicy}
        onExclusive={setExclusive}
      />
      <Button
        label={busy ? 'Creating…' : 'Create list'}
        variant="primary"
        disabled={!canCreate || busy || name.trim().length === 0}
        disabledReason={
          !canCreate ? 'This server build cannot create lists.' : undefined
        }
        onPress={() => void submit()}
        testID="lists-create-submit"
      />
      {!canCreate ? (
        <Caption color="faint">This server build cannot create lists.</Caption>
      ) : null}
    </View>
  )
}

function ListRow({
  list,
  onRename,
  onDelete,
  pendingDelete,
  onArmDelete,
  onCancelDelete,
  onOpen,
}: {
  list: ListSummary
  onRename: (name: string, fields: ListFields) => Promise<void>
  onDelete: () => Promise<void>
  pendingDelete: boolean
  onArmDelete: () => void
  onCancelDelete: () => void
  onOpen: () => void
}) {
  const {backend} = useActiveBackend()
  const caps = backend?.capabilities
  const canRename = !!backend?.lists?.update
  const canDelete = !!backend?.lists?.delete
  const [draft, setDraft] = useState(list.name)
  // Seeded from what the server reported. Mastodon's default policy is
  // `list`; a row that does not report the field keeps the default but the
  // gate below decides whether it is sent at all.
  const [policy, setPolicy] = useState<ListRepliesPolicy>(list.repliesPolicy ?? 'list')
  const [exclusive, setExclusive] = useState(list.exclusive ?? false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openEditor = () => {
    setDraft(list.name)
    setPolicy(list.repliesPolicy ?? 'list')
    setExclusive(list.exclusive ?? false)
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || busy || !canRename) return
    setBusy(true)
    setError(null)
    try {
      await onRename(trimmed, chosenListFields(caps, policy, exclusive))
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the list.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`lists-row-${list.id}`}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={`${list.name}. Open list.`}
        testID={`lists-open-${list.id}`}>
        <Body>{list.name}</Body>
      </Pressable>
      {editing ? (
        <View style={[atoms.gap_sm]}>
          <TextField
            label="List name"
            value={draft}
            onChangeText={setDraft}
            placeholder="List name"
            error={error ?? undefined}
            testID={`lists-rename-input-${list.id}`}
          />
          <ListFieldsEditor
            idPrefix={`lists-edit-${list.id}`}
            caps={caps}
            policy={policy}
            exclusive={exclusive}
            onPolicy={setPolicy}
            onExclusive={setExclusive}
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={busy ? 'Saving…' : 'Save'}
              variant="primary"
              disabled={busy || draft.trim().length === 0}
              onPress={() => void save()}
              testID={`lists-rename-save-${list.id}`}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setEditing(false)
                setDraft(list.name)
              }}
              testID={`lists-rename-cancel-${list.id}`}
            />
          </View>
        </View>
      ) : (
        <View style={[atoms.row, atoms.gap_sm]}>
          <Button
            label="Rename"
            variant="secondary"
            disabled={!canRename || busy}
            disabledReason={!canRename ? 'This server build cannot rename lists.' : undefined}
            onPress={openEditor}
            testID={`lists-rename-${list.id}`}
          />
          {!canRename ? (
            <Caption color="faint">This server build cannot rename lists.</Caption>
          ) : null}
        </View>
      )}
      {pendingDelete ? (
        <View style={[atoms.gap_sm]}>
          <Caption color="faint">Delete “{list.name}”? This cannot be undone.</Caption>
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label="Confirm delete"
              variant="secondary"
              disabled={!canDelete || busy}
              onPress={() => void onDelete()}
              testID={`lists-delete-confirm-${list.id}`}
            />
            <Button
              label="Keep"
              variant="secondary"
              disabled={busy}
              onPress={onCancelDelete}
              testID={`lists-delete-cancel-${list.id}`}
            />
          </View>
        </View>
      ) : (
        <View style={[atoms.row, atoms.gap_sm]}>
          <Button
            label="Delete"
            variant="secondary"
            disabled={!canDelete || busy}
            disabledReason={!canDelete ? 'This server build cannot delete lists.' : undefined}
            onPress={onArmDelete}
            testID={`lists-delete-${list.id}`}
          />
          {!canDelete ? (
            <Caption color="faint">This server build cannot delete lists.</Caption>
          ) : null}
        </View>
      )}
      {error && !editing ? <Caption color="faint">{error}</Caption> : null}
    </View>
  )
}

export function ListsScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const [lists, setLists] = useState<ListSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [denied, setDenied] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session || !backend) {
      setLoading(false)
      return
    }
    if (!backend.lists || backend.capabilities.lists === 'unsupported') {
      setUnsupported(true)
      setLoading(false)
      return
    }
    setFetching(true)
    setError(null)
    try {
      setLists(await backend.lists.list())
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
    setLists(null)
    setUnsupported(false)
    setDenied(false)
    setError(null)
    setLoading(true)
    void load()
  }, [load])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="lists-screen">
        <Pagehead title="Lists" />
        <Body>Sign in to see your lists.</Body>
        <Caption color="faint">Lists never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (unsupported || (!backend.lists && !loading)) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="lists-screen">
        <Pagehead title="Lists" />
        <Body>Lists are not available on this server.</Body>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="lists-screen">
      <Pagehead title="Lists" />
      {/* Misskey antennas live alongside lists: the Antennas screen links
          here, so this screen links back (sidebar reshuffle). */}
      {session?.family === 'misskey' ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label="Antennas"
            variant="secondary"
            onPress={() => navigation.navigate('Antennas')}
            testID="lists-antennas-link"
          />
        </View>
      ) : null}
      <CreateRow
        onCreate={async (name, fields) => {
          if (!backend.lists?.create) return
          const created = await backend.lists.create(name, fields)
          setLists(prev => (prev ? [...prev, created] : [created]))
        }}
      />
      {actionError ? <Caption color="faint">{actionError}</Caption> : null}
      {loading ? (
        <SkeletonList variant="row" testID="lists-loading" />
      ) : denied ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Your account cannot view lists here.</Body>
          <Button label="Retry" variant="secondary" onPress={() => void load()} testID="lists-retry" />
        </View>
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load lists.</Body>
          <Button label="Retry" variant="secondary" onPress={() => void load()} testID="lists-retry" />
        </View>
      ) : (
        <FlatList
          data={lists ?? []}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <ListRow
              list={item}
              onRename={async (name, fields) => {
                if (!backend.lists?.update) return
                setActionError(null)
                try {
                  const updated = await backend.lists.update(item.id, {name, ...fields})
                  setLists(prev => (prev ?? []).map(l => (l.id === item.id ? updated : l)))
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : 'Could not rename the list.')
                  throw err
                }
              }}
              onDelete={async () => {
                if (!backend.lists?.delete) return
                setActionError(null)
                try {
                  await backend.lists.delete(item.id)
                  setLists(prev => (prev ?? []).filter(l => l.id !== item.id))
                  setPendingDeleteId(null)
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : 'Could not delete the list.')
                }
              }}
              pendingDelete={pendingDeleteId === item.id}
              onArmDelete={() => {
                setPendingDeleteId(item.id)
              }}
              onCancelDelete={() => setPendingDeleteId(null)}
              onOpen={() => navigation.navigate('List', {id: item.id})}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={fetching}
              onRefresh={() => void load()}
              testID="lists-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>You have no lists yet.</Body>
            </View>
          }
        />
      )}
    </View>
  )
}
