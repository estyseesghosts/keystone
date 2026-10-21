import {useCallback, useEffect, useRef, useState} from 'react'
import {View} from 'react-native'

import {
  formatWordFilters,
  isPermissionError,
  isUnsupportedError,
  parseMutedInstances,
  parseWordFilters,
  WordFilterParseError,
  type Account,
  type Backend,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useActiveSession} from '#/state/session/SessionProvider'

import {PlaceholderRow, SectionHint, SettingRow} from './rows'

// Mutes section (v1 `/settings/mutes` parity): word/instance filters,
// account search-to-mute/block, and the muted, blocked, and repost-muted
// account lists with unmute/unblock. Each block gates independently —
// unsupported backends render an honest placeholder, never an error.
//
// Scope rule (plan §2.2): renote-mute LISTS render only when the backend
// exposes `renoteMutes` (Misskey family, when implemented); otherwise the
// honest placeholder stays. The search row can always renote-mute, but
// has no relationship data to offer an unmute path without new queries,
// so search stays mute-only.

type WordFieldName = 'mutedWords' | 'hardMutedWords' | 'mutedInstances'

function fieldValues(me: Account | null, field: WordFieldName): string {
  const bag = me?.ext.me as Record<string, unknown> | undefined
  if (field === 'mutedInstances') {
    const raw = bag?.[field]
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').join('\n') : ''
  }
  return formatWordFilters(bag?.[field] as Array<string | string[]> | undefined)
}

function WordField({
  backend,
  me,
  onSaved,
  field,
  title,
  hint,
  placeholder,
}: {
  backend: Backend
  me: Account | null
  onSaved: () => void
  field: WordFieldName
  title: string
  hint: string
  placeholder: string
}) {
  const [value, setValue] = useState(() => fieldValues(me, field))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The account record can arrive after the user starts typing: seed from
  // it at most once, and never over an edit (refs, so no stale closures).
  const seeded = useRef(false)
  const edited = useRef(false)

  useEffect(() => {
    if (!seeded.current && me) {
      seeded.current = true
      if (!edited.current) setValue(fieldValues(me, field))
    }
  }, [me, field])

  const save = async () => {
    if (busy) return
    setError(null)
    setNotice(null)
    let parsed: Array<string | string[]> | string[]
    try {
      parsed = field === 'mutedInstances' ? parseMutedInstances(value) : parseWordFilters(value)
    } catch (err) {
      setError(
        err instanceof WordFilterParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not save.',
      )
      return
    }
    setBusy(true)
    try {
      await backend.updateProfile({ext: {[field]: parsed}})
      setNotice('Saved.')
      onSaved()
    } catch (err) {
      if (isPermissionError(err)) setError('Your account cannot change this setting.')
      else setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingRow title={title} hint={hint} testID={`wordfield-${field}`}>
      <TextField
        label={title}
        value={value}
        onChangeText={text => {
          setValue(text)
          edited.current = true
          setNotice(null)
        }}
        placeholder={placeholder}
        error={error ?? undefined}
        testID={`wordfield-${field}-input`}
      />
      <View style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
        <Button
          label={busy ? 'Saving…' : 'Save'}
          variant="primary"
          disabled={busy}
          onPress={() => void save()}
          testID={`wordfield-${field}-save`}
        />
        {notice ? <Caption color="faint">{notice}</Caption> : null}
      </View>
    </SettingRow>
  )
}

function UserRow({
  user,
  action,
  busy,
  onAct,
  testID,
}: {
  user: Account
  action: string
  busy: boolean
  onAct: () => void
  testID?: string
}) {
  return (
    <View style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]} testID={testID}>
      <View style={[atoms.flex1, atoms.gap_sm]}>
        <Body>{user.displayName}</Body>
        <Caption color="faint">@{user.acct}</Caption>
      </View>
      <Button label={action} variant="secondary" disabled={busy} onPress={onAct} />
    </View>
  )
}

function MuteBlockSearch({backend, onChanged}: {backend: Backend; onChanged: () => void}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Account[]>([])
  const [busy, setBusy] = useState(false)
  const [actBusy, setActBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    const q = query.trim()
    if (q.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const page = await backend.search.accounts(q, {limit: 10})
      setResults(page.items)
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<void>) => {
    if (actBusy) return
    setActBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (err) {
      if (isPermissionError(err)) setError('Your account cannot do that here.')
      else setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setActBusy(false)
    }
  }

  return (
    <SettingRow
      title="Mute or block an account"
      hint="Search, then mute or block. Changes apply immediately."
      testID="mute-search">
      <TextField
        label="Search accounts"
        value={query}
        onChangeText={setQuery}
        placeholder="username or handle"
        error={error ?? undefined}
        testID="mute-search-input"
      />
      <Button
        label={busy ? 'Searching…' : 'Search'}
        variant="secondary"
        disabled={busy || query.trim().length === 0}
        onPress={() => void run()}
        testID="mute-search-run"
      />
      {searched && results.length === 0 && !busy ? (
        <Caption color="faint">No accounts found.</Caption>
      ) : null}
      {results.map(user => (
        <View key={user.id} style={[atoms.gap_sm]}>
          <Body>{user.displayName}</Body>
          <Caption color="faint">@{user.acct}</Caption>
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label="Mute"
              variant="secondary"
              disabled={actBusy}
              onPress={() => void act(() => backend.mute(user.id))}
              testID={`mute-search-mute-${user.id}`}
            />
            <Button
              label="Mute reposts"
              variant="secondary"
              disabled={actBusy}
              onPress={() => void act(() => backend.muteRenotes(user.id))}
              testID={`mute-search-muterenotes-${user.id}`}
            />
            <Button
              label="Block"
              variant="secondary"
              disabled={actBusy}
              onPress={() => void act(() => backend.block(user.id))}
              testID={`mute-search-block-${user.id}`}
            />
          </View>
        </View>
      ))}
    </SettingRow>
  )
}

function AccountList({
  title,
  hint,
  testID,
  load,
  action,
  run,
  refreshKey,
}: {
  title: string
  hint: string
  testID: string
  load: (backend: Backend) => Promise<Account[]>
  action: string
  run: (backend: Backend, id: string) => Promise<void>
  refreshKey: number
}) {
  const {backend} = useActiveBackend()
  const [items, setItems] = useState<Account[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!backend) return
    setItems(null)
    setError(null)
    void load(backend)
      .then(list => {
        if (!cancelled) setItems(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load.')
      })
    return () => {
      cancelled = true
    }
  }, [backend, refreshKey])

  const act = async (id: string) => {
    if (!backend || busy) return
    setBusy(true)
    setError(null)
    try {
      await run(backend, id)
      setItems(await load(backend))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingRow title={title} hint={hint} testID={testID}>
      {items === null ? (
        <Caption color="faint">Loading…</Caption>
      ) : items.length === 0 ? (
        <Caption color="faint">None.</Caption>
      ) : (
        <View style={[atoms.gap_sm]}>
          {items.map(user => (
            <UserRow
              key={user.id}
              user={user}
              action={action}
              busy={busy}
              onAct={() => void act(user.id)}
            />
          ))}
        </View>
      )}
      {error ? <Caption testID={`${testID}-error`}>{error}</Caption> : null}
    </SettingRow>
  )
}

export function MutesSection() {
  const session = useActiveSession()
  const {backend} = useActiveBackend()
  const [me, setMe] = useState<Account | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    if (!backend) return
    void backend
      .me()
      .then(account => {
        if (!cancelled) setMe(account)
      })
      .catch(() => {
        if (!cancelled) setMe(null)
      })
    return () => {
      cancelled = true
    }
  }, [backend, refreshKey])

  if (!session || !backend) {
    return (
      <View style={[atoms.gap_sm]} testID="settings-section-mutes">
        <SectionHint>Sign in to manage mutes and blocks.</SectionHint>
      </View>
    )
  }

  const isMisskey = backend.family === 'misskey'
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-mutes">
      {isMisskey ? (
        <>
          <WordField
            backend={backend}
            me={me}
            onSaved={refresh}
            field="mutedWords"
            title="Word mutes"
            hint="One group per line; words on a line must all match. /regex/ lines stay verbatim."
            placeholder={'spoiler\n/^advertisement/i'}
          />
          <WordField
            backend={backend}
            me={me}
            onSaved={refresh}
            field="hardMutedWords"
            title="Hard word mutes"
            hint="Like word mutes, but matching posts never load."
            placeholder="one group per line…"
          />
          <WordField
            backend={backend}
            me={me}
            onSaved={refresh}
            field="mutedInstances"
            title="Muted servers"
            hint="One host per line. Matching is case-sensitive."
            placeholder="example.com"
          />
        </>
      ) : (
        <PlaceholderRow
          title="Word and server mutes"
          hint="Soft words, hard words, muted servers."
          reason="Needs a Misskey-family server."
          testID="placeholder-word-mutes"
        />
      )}
      <MuteBlockSearch backend={backend} onChanged={refresh} />
      <AccountList
        title="Muted accounts"
        hint="Unmute to see their posts again."
        testID="muted-list"
        load={b => b.mutes().then(p => p.items)}
        action="Unmute"
        run={(b, id) => b.unmute(id)}
        refreshKey={refreshKey}
      />
      <AccountList
        title="Blocked accounts"
        hint="Unblock to interact again."
        testID="blocked-list"
        load={b => b.blocks().then(p => p.items)}
        action="Unblock"
        run={(b, id) => b.unblock(id)}
        refreshKey={refreshKey}
      />
      {backend.renoteMutes ? (
        <AccountList
          title="Repost-muted accounts"
          hint="Unmute reposts to see them again."
          testID="renote-mutes-list"
          load={b => (b.renoteMutes ? b.renoteMutes().then(p => p.items) : Promise.resolve([]))}
          action="Unmute reposts"
          run={(b, id) => b.unmuteRenotes(id)}
          refreshKey={refreshKey}
        />
      ) : (
        <PlaceholderRow
          title="Repost-muted accounts"
          hint="Accounts whose reposts are hidden."
          reason="Not wired yet — the backend has no list endpoint."
          testID="placeholder-renote-mutes"
        />
      )}
    </View>
  )
}
