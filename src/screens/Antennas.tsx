// Antennas index (`/antennas`, v1 `Antennas` parity): the viewer's
// antennas, create (name + source + keywords), rename (inline), and
// delete (two-tap confirm). Tapping a row navigates to `Antenna` with
// `{id}`. Gated on `backend.antennas`; every `AntennasApi` member is
// required, so the controls are never disabled by capability — only by
// empty input or busy state. The create form is deliberately small: the
// `list` source needs a user-list picker this screen does not own, so it
// offers the four self-contained sources only.

import {useCallback, useEffect, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'
import {msg} from '@lingui/macro'

import {isPermissionError, isUnsupportedError, type Antenna, type AntennaSrc} from '@keystone/fedi'

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
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'

const SOURCES: AntennaSrc[] = ['home', 'all', 'users', 'users_blacklist']

/** Display label for a closed antenna-source enum value. The codes come
 * from the server, but the set is closed (the four self-contained sources
 * this screen offers), so they render through the catalog with identical
 * English — never guessed, never hidden. Pure. */
export function antennaSrcLabel(src: AntennaSrc): string {
  switch (src) {
    case 'home':
      return i18n._(msg`home`)
    case 'all':
      return i18n._(msg`all`)
    case 'users':
      return i18n._(msg`users`)
    case 'users_blacklist':
      return i18n._(msg`users_blacklist`)
    default:
      return src
  }
}

export function antennaSummaryLine(antenna: Antenna): string {
  const keywords = antenna.keywords.map(g => g.join(' ')).join(' / ')
  // Keywords are user data: they interpolate as values, never translated.
  return keywords.length > 0
    ? i18n._(msg`${antennaSrcLabel(antenna.src)} · ${keywords}`)
    : antennaSrcLabel(antenna.src)
}

function CreateRow({onCreate}: {onCreate: (body: Omit<Antenna, 'id'>) => Promise<void>}) {
  const [name, setName] = useState('')
  const [src, setSrc] = useState<AntennaSrc>('all')
  const [keywords, setKeywords] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const words = keywords.split(/\s+/).filter(w => w.length > 0)
  const valid = name.trim().length > 0 && words.length > 0
  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        name: name.trim(),
        src,
        userListId: null,
        keywords: [words],
        excludeKeywords: [],
        users: [],
        caseSensitive: false,
        localOnly: false,
        excludeBots: false,
        withReplies: false,
        withFile: false,
      })
      setName('')
      setSrc('all')
      setKeywords('')
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not create the antenna.`)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={[atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="antennas-create">
      <TextField
        label={i18n._(msg`New antenna`)}
        value={name}
        onChangeText={setName}
        placeholder={i18n._(msg`Antenna name`)}
        error={error ?? undefined}
        testID="antennas-create-input"
      />
      <View style={[atoms.row, atoms.gap_sm]} testID="antennas-create-src">
        {SOURCES.map(option => (
          <Button
            key={option}
            label={antennaSrcLabel(option)}
            variant={src === option ? 'primary' : 'secondary'}
            disabled={busy}
            onPress={() => setSrc(option)}
            testID={`antennas-src-${option}`}
          />
        ))}
      </View>
      <TextField
        label={i18n._(msg`Keywords (space-separated, all must match)`)}
        value={keywords}
        onChangeText={setKeywords}
        placeholder={i18n._(msg`keyword1 keyword2`)}
        testID="antennas-create-keywords"
      />
      <Button
        label={busy ? i18n._(msg`Creating…`) : i18n._(msg`Create antenna`)}
        variant="primary"
        disabled={busy || !valid}
        onPress={() => void submit()}
        testID="antennas-create-submit"
      />
    </View>
  )
}

function AntennaRow({
  antenna,
  onRename,
  onDelete,
  pendingDelete,
  onArmDelete,
  onCancelDelete,
  onOpen,
}: {
  antenna: Antenna
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  pendingDelete: boolean
  onArmDelete: () => void
  onCancelDelete: () => void
  onOpen: () => void
}) {
  const [draft, setDraft] = useState(antenna.name)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await onRename(trimmed)
      setEditing(false)
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not rename the antenna.`)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`antennas-row-${antenna.id}`}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={i18n._(msg`${antenna.name}. Open antenna.`)}
        testID={`antennas-open-${antenna.id}`}>
        <Body>{antenna.name}</Body>
      </Pressable>
      <Caption color="faint">{antennaSummaryLine(antenna)}</Caption>
      {editing ? (
        <View style={[atoms.gap_sm]}>
          <TextField
            label={i18n._(msg`Antenna name`)}
            value={draft}
            onChangeText={setDraft}
            placeholder={i18n._(msg`Antenna name`)}
            error={error ?? undefined}
            testID={`antennas-rename-input-${antenna.id}`}
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
              variant="primary"
              disabled={busy || draft.trim().length === 0}
              onPress={() => void save()}
              testID={`antennas-rename-save-${antenna.id}`}
            />
            <Button
              label={i18n._(msg`Cancel`)}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setEditing(false)
                setDraft(antenna.name)
              }}
              testID={`antennas-rename-cancel-${antenna.id}`}
            />
          </View>
        </View>
      ) : (
        <View style={[atoms.row, atoms.gap_sm]}>
          <Button
            label={i18n._(msg`Rename`)}
            variant="secondary"
            disabled={busy}
            onPress={() => setEditing(true)}
            testID={`antennas-rename-${antenna.id}`}
          />
        </View>
      )}
      {pendingDelete ? (
        <View style={[atoms.gap_sm]}>
          <Caption color="faint">
            {i18n._(msg`Delete “${antenna.name}”? This cannot be undone.`)}
          </Caption>
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={i18n._(msg`Confirm delete`)}
              variant="secondary"
              disabled={busy}
              onPress={() => void onDelete()}
              testID={`antennas-delete-confirm-${antenna.id}`}
            />
            <Button
              label={i18n._(msg`Keep`)}
              variant="secondary"
              disabled={busy}
              onPress={onCancelDelete}
              testID={`antennas-delete-cancel-${antenna.id}`}
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
            testID={`antennas-delete-${antenna.id}`}
          />
        </View>
      )}
      {error && !editing ? <Caption color="faint">{error}</Caption> : null}
    </View>
  )
}

export function AntennasScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const [antennas, setAntennas] = useState<Antenna[] | null>(null)
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
    if (!backend.antennas || backend.capabilities.antennas === 'unsupported') {
      setUnsupported(true)
      setLoading(false)
      return
    }
    setFetching(true)
    setError(null)
    try {
      setAntennas(await backend.antennas.list())
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
    setAntennas(null)
    setUnsupported(false)
    setDenied(false)
    setError(null)
    setLoading(true)
    void load()
  }, [load])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="antennas-screen">
        <Pagehead title={i18n._(msg`Antennas`)} />
        <Body>{i18n._(msg`Sign in to see your antennas.`)}</Body>
        <Caption color="faint">
          {i18n._(msg`Antennas never show sample data when signed out.`)}
        </Caption>
        <SignInButton />
      </View>
    )
  }

  if (unsupported || (!backend.antennas && !loading)) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="antennas-screen">
        <Pagehead title={i18n._(msg`Antennas`)} />
        <Body>{i18n._(msg`Antennas are not available on this server.`)}</Body>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="antennas-screen">
      <Pagehead title={i18n._(msg`Antennas`)} />
      {/* Misskey lists live here too: one collections row per concept, so
          Antennas carries the entry point to Lists (where they are edited). */}
      {session?.family === 'misskey' ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label={i18n._(msg`Lists`)}
            variant="secondary"
            onPress={() => navigation.navigate('Lists')}
            testID="antennas-lists-link"
          />
        </View>
      ) : null}
      <CreateRow
        onCreate={async body => {
          if (!backend.antennas) return
          const created = await backend.antennas.create(body)
          setAntennas(prev => (prev ? [...prev, created] : [created]))
        }}
      />
      {actionError ? <Caption color="faint">{actionError}</Caption> : null}
      {loading ? (
        <SkeletonList variant="row" testID="antennas-loading" />
      ) : denied ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Your account cannot view antennas here.`)}</Body>
          <Button
            label={i18n._(msg`Retry`)}
            variant="secondary"
            onPress={() => void load()}
            testID="antennas-retry"
          />
        </View>
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Could not load antennas.`)}</Body>
          <Button
            label={i18n._(msg`Retry`)}
            variant="secondary"
            onPress={() => void load()}
            testID="antennas-retry"
          />
        </View>
      ) : (
        <FlatList
          data={antennas ?? []}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <AntennaRow
              antenna={item}
              onRename={async name => {
                if (!backend.antennas) return
                setActionError(null)
                try {
                  const updated = await backend.antennas.update(item.id, {...item, name})
                  setAntennas(prev => (prev ?? []).map(a => (a.id === item.id ? updated : a)))
                } catch (err) {
                  setActionError(
                    errorText(i18n, err, i18n._(msg`Could not rename the antenna.`))
                  )
                  throw err
                }
              }}
              onDelete={async () => {
                if (!backend.antennas) return
                setActionError(null)
                try {
                  await backend.antennas.delete(item.id)
                  setAntennas(prev => (prev ?? []).filter(a => a.id !== item.id))
                  setPendingDeleteId(null)
                } catch (err) {
                  setActionError(
                    errorText(i18n, err, i18n._(msg`Could not delete the antenna.`))
                  )
                }
              }}
              pendingDelete={pendingDeleteId === item.id}
              onArmDelete={() => {
                setPendingDeleteId(item.id)
              }}
              onCancelDelete={() => setPendingDeleteId(null)}
              onOpen={() => navigation.navigate('Antenna', {id: item.id})}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={fetching}
              onRefresh={() => void load()}
              testID="antennas-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>{i18n._(msg`You have no antennas yet.`)}</Body>
            </View>
          }
        />
      )}
    </View>
  )
}
