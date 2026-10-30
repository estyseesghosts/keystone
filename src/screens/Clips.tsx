// Clips index (`/clips`, v1 `Clips` parity): the viewer's clips, create
// (name + public flag), rename + privacy toggle (inline), and delete
// (two-tap confirm).
// Tapping a row navigates to `Clip` with `{id}`. Gated on
// `backend.clips`; every `ClipsApi` member is required, so the controls
// are never disabled by capability — only by empty input or busy state.

import {useCallback, useEffect, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native'

import {msg, plural} from '@lingui/macro'

import {isPermissionError, isUnsupportedError, type ClipSummary} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'
import {showToast} from '#/lib/toast'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'

function CreateRow({onCreate}: {onCreate: (name: string, isPublic: boolean) => Promise<void>}) {
  const [name, setName] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    const trimmed = name.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(trimmed, isPublic)
      setName('')
      setIsPublic(false)
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not create the clip.`)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={[atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="clips-create">
      <TextField
        label={i18n._(msg`New clip`)}
        value={name}
        onChangeText={setName}
        placeholder={i18n._(msg`Clip name`)}
        error={error ?? undefined}
        testID="clips-create-input"
      />
      <Button
        label={isPublic ? i18n._(msg`Public: on`) : i18n._(msg`Public: off`)}
        variant="secondary"
        disabled={busy}
        onPress={() => setIsPublic(v => !v)}
        testID="clips-create-public"
      />
      <Button
        label={busy ? i18n._(msg`Creating…`) : i18n._(msg`Create clip`)}
        variant="primary"
        disabled={busy || name.trim().length === 0}
        onPress={() => void submit()}
        testID="clips-create-submit"
      />
    </View>
  )
}

function ClipRow({
  clip,
  onRename,
  onDelete,
  pendingDelete,
  onArmDelete,
  onCancelDelete,
  onOpen,
  onAdd,
}: {
  clip: ClipSummary
  onRename: (name: string, isPublic: boolean) => Promise<void>
  onDelete: () => Promise<void>
  pendingDelete: boolean
  onArmDelete: () => void
  onCancelDelete: () => void
  onOpen: () => void
  /** Add-note flow (from the post menu): when set, the row offers an "Add
   * here" button that files the note into this clip. */
  onAdd?: () => Promise<void>
}) {
  const [draft, setDraft] = useState(clip.name)
  const [pub, setPub] = useState(clip.isPublic ?? false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await onRename(trimmed, pub)
      setEditing(false)
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not rename the clip.`)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`clips-row-${clip.id}`}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={i18n._(msg`${clip.name}. Open clip.`)}
        testID={`clips-open-${clip.id}`}>
        <Body>{clip.name}</Body>
      </Pressable>
      {clip.notesCount != null ? (
        <Caption color="faint">
          {i18n._(
            plural(clip.notesCount, {
              one: '# note',
              other: '# notes',
            }),
          )}
        </Caption>
      ) : null}
      {clip.isPublic ? <Caption color="faint">{i18n._(msg`Public`)}</Caption> : null}
      {onAdd ? (
        <Button
          label={i18n._(msg`Add here`)}
          variant="primary"
          onPress={() => void onAdd()}
          testID={`clips-add-${clip.id}`}
        />
      ) : null}
      {editing ? (
        <View style={[atoms.gap_sm]}>
          <TextField
            label={i18n._(msg`Clip name`)}
            value={draft}
            onChangeText={setDraft}
            placeholder={i18n._(msg`Clip name`)}
            error={error ?? undefined}
            testID={`clips-rename-input-${clip.id}`}
          />
          <Button
            label={pub ? i18n._(msg`Public: on`) : i18n._(msg`Public: off`)}
            variant="secondary"
            disabled={busy}
            onPress={() => setPub(v => !v)}
            testID={`clips-rename-public-${clip.id}`}
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
              variant="primary"
              disabled={busy || draft.trim().length === 0}
              onPress={() => void save()}
              testID={`clips-rename-save-${clip.id}`}
            />
            <Button
              label={i18n._(msg`Cancel`)}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setEditing(false)
                setDraft(clip.name)
              }}
              testID={`clips-rename-cancel-${clip.id}`}
            />
          </View>
        </View>
      ) : (
        <View style={[atoms.row, atoms.gap_sm]}>
          <Button
            label={i18n._(msg`Rename`)}
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setDraft(clip.name)
              setPub(clip.isPublic ?? false)
              setEditing(true)
            }}
            testID={`clips-rename-${clip.id}`}
          />
        </View>
      )}
      {pendingDelete ? (
        <View style={[atoms.gap_sm]}>
          <Caption color="faint">{i18n._(msg`Delete “${clip.name}”? This cannot be undone.`)}</Caption>
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={i18n._(msg`Confirm delete`)}
              variant="secondary"
              disabled={busy}
              onPress={() => void onDelete()}
              testID={`clips-delete-confirm-${clip.id}`}
            />
            <Button
              label={i18n._(msg`Keep`)}
              variant="secondary"
              disabled={busy}
              onPress={onCancelDelete}
              testID={`clips-delete-cancel-${clip.id}`}
            />
          </View>
        </View>
      ) : (
        <View style={[atoms.row, atoms.gap_sm]}>
          <Button
            label={i18n._(msg`Delete`)}
            variant="secondary"
            disabled={busy}
            onPress={onArmDelete}
            testID={`clips-delete-${clip.id}`}
          />
        </View>
      )}
      {error && !editing ? <Caption color="faint">{error}</Caption> : null}
    </View>
  )
}

export function ClipsScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const route = useRoute<RouteProp<RootParamList, 'Clips'>>()
  // Add-note flow: the post menu lands here with `{addNoteId}` so the
  // viewer picks the clip; the pick files the note and leaves.
  const addNoteId = route.params?.addNoteId ?? null
  const [clips, setClips] = useState<ClipSummary[] | null>(null)
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
    if (!backend.clips || backend.capabilities.clips === 'unsupported') {
      setUnsupported(true)
      setLoading(false)
      return
    }
    setFetching(true)
    setError(null)
    try {
      setClips((await backend.clips.list()).items)
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
    setClips(null)
    setUnsupported(false)
    setDenied(false)
    setError(null)
    setLoading(true)
    void load()
  }, [load])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="clips-screen">
        <Pagehead title={i18n._(msg`Clips`)} />
        <Body>{i18n._(msg`Sign in to see your clips.`)}</Body>
        <Caption color="faint">{i18n._(msg`Clips never show sample data when signed out.`)}</Caption>
        <SignInButton />
      </View>
    )
  }

  if (unsupported || (!backend.clips && !loading)) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="clips-screen">
        <Pagehead title={i18n._(msg`Clips`)} />
        <Body>{i18n._(msg`Clips are not available on this server.`)}</Body>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="clips-screen">
      <Pagehead title={i18n._(msg`Clips`)} />
      {addNoteId ? <Caption color="faint">{i18n._(msg`Choose a clip for this post.`)}</Caption> : null}
      {/* Misskey favourites live here too: the sidebar has one collections
          row per concept, so Clips carries the entry point to Favourites. */}
      {session?.family === 'misskey' ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label={i18n._(msg`Favourites`)}
            variant="secondary"
            onPress={() => navigation.navigate('Favorites')}
            testID="clips-favourites-link"
          />
        </View>
      ) : null}
      <CreateRow
        onCreate={async (name, isPublic) => {
          if (!backend.clips) return
          const created = await backend.clips.create(name, {isPublic})
          setClips(prev => (prev ? [created, ...prev] : [created]))
        }}
      />
      {actionError ? <Caption color="faint">{actionError}</Caption> : null}
      {loading ? (
        <SkeletonList variant="row" testID="clips-loading" />
      ) : denied ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Your account cannot view clips here.`)}</Body>
          <Button
            label={i18n._(msg`Retry`)}
            variant="secondary"
            onPress={() => void load()}
            testID="clips-retry"
          />
        </View>
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Could not load clips.`)}</Body>
          <Button
            label={i18n._(msg`Retry`)}
            variant="secondary"
            onPress={() => void load()}
            testID="clips-retry"
          />
        </View>
      ) : (
        <FlatList
          data={clips ?? []}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <ClipRow
              clip={item}
              onRename={async (name, isPublic) => {
                if (!backend.clips) return
                setActionError(null)
                try {
                  // Full body (DC-6/B1): the server wipes omitted fields.
                  const updated = await backend.clips.update(item.id, {
                    name,
                    isPublic,
                    description: item.description ?? null,
                  })
                  setClips(prev => (prev ?? []).map(c => (c.id === item.id ? updated : c)))
                } catch (err) {
                  setActionError(errorText(i18n, err, i18n._(msg`Could not rename the clip.`)))
                  throw err
                }
              }}
              onDelete={async () => {
                if (!backend.clips) return
                setActionError(null)
                try {
                  await backend.clips.delete(item.id)
                  setClips(prev => (prev ?? []).filter(c => c.id !== item.id))
                  setPendingDeleteId(null)
                } catch (err) {
                  setActionError(errorText(i18n, err, i18n._(msg`Could not delete the clip.`)))
                }
              }}
              pendingDelete={pendingDeleteId === item.id}
              onArmDelete={() => {
                setPendingDeleteId(item.id)
              }}
              onCancelDelete={() => setPendingDeleteId(null)}
              onOpen={() => navigation.navigate('Clip', {id: item.id})}
              onAdd={
                addNoteId && backend?.clips
                  ? async () => {
                      setActionError(null)
                      try {
                        await backend.clips!.addNote(item.id, addNoteId)
                        showToast(i18n._(msg`Added to ${item.name}`))
                        navigation.goBack()
                      } catch (err) {
                        setActionError(errorText(i18n, err, i18n._(msg`Could not add to the clip.`)))
                      }
                    }
                  : undefined
              }
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={fetching}
              onRefresh={() => void load()}
              testID="clips-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>{i18n._(msg`You have no clips yet.`)}</Body>
            </View>
          }
        />
      )}
    </View>
  )
}
