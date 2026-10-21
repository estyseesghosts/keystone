// Lists index (`/lists`, v1 `Lists` parity): the viewer's user lists,
// create, rename (inline), and delete (two-tap confirm). Tapping a row
// navigates to `List` with `{id}`. Gated on `backend.lists`; the
// create/update/delete members are OPTIONAL additions — when absent the
// controls render disabled with a reason, never omitted, never inert.

import {useCallback, useEffect, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {isPermissionError, isUnsupportedError} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'

type ListSummary = {id: string; name: string}

function CreateRow({onCreate}: {onCreate: (name: string) => Promise<void>}) {
  const {backend} = useActiveBackend()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canCreate = !!backend?.lists?.create
  const submit = async () => {
    const trimmed = name.trim()
    if (trimmed.length === 0 || busy || !canCreate) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(trimmed)
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
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  pendingDelete: boolean
  onArmDelete: () => void
  onCancelDelete: () => void
  onOpen: () => void
}) {
  const {backend} = useActiveBackend()
  const canRename = !!backend?.lists?.update
  const canDelete = !!backend?.lists?.delete
  const [draft, setDraft] = useState(list.name)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || busy || !canRename) return
    setBusy(true)
    setError(null)
    try {
      await onRename(trimmed)
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
            onPress={() => setEditing(true)}
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
      <CreateRow
        onCreate={async name => {
          if (!backend.lists?.create) return
          const created = await backend.lists.create(name)
          setLists(prev => (prev ? [...prev, created] : [created]))
        }}
      />
      {actionError ? <Caption color="faint">{actionError}</Caption> : null}
      {loading ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Loader testID="lists-loading" />
          <Caption color="faint">Loading…</Caption>
        </View>
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
              onRename={async name => {
                if (!backend.lists?.update) return
                setActionError(null)
                try {
                  const updated = await backend.lists.update(item.id, {name})
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
            <RefreshControl refreshing={fetching} onRefresh={() => void load()} testID="lists-refresh" />
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
