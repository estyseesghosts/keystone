import {useCallback, useEffect, useRef, useState} from 'react'
import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  formatWordFilters,
  isPermissionError,
  isUnsupportedError,
  parseMutedInstances,
  parseWordFilters,
  WordFilterParseError,
  type Account,
  type Backend,
  type Relationship,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {i18n} from '#/locale/i18n'
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
// honest placeholder stays. The search row below offers state-aware
// undo (Mute/Unmute, Mute reposts/Unmute, Block/Unblock per v1) by
// re-reading `relationships` after search and after every action.

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
            : i18n._(msg`Could not save.`),
      )
      return
    }
    setBusy(true)
    try {
      await backend.updateProfile({ext: {[field]: parsed}})
      setNotice(i18n._(msg`Saved.`))
      onSaved()
    } catch (err) {
      if (isPermissionError(err)) setError(i18n._(msg`Your account cannot change this setting.`))
      else setError(err instanceof Error ? err.message : i18n._(msg`Could not save.`))
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
          label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
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
  // Relation state per result id. `live` is false until a `relationships`
  // read succeeds — unsupported (or missing, in test fakes) keeps the
  // current one-way buttons, never an error.
  const [relations, setRelations] = useState<Record<string, Relationship>>({})
  const [relationsLive, setRelationsLive] = useState(false)
  // Renote-mute state comes from the `renoteMutes` LIST when the backend
  // exposes it; null means unknown (no list — the one-way button stays).
  const [renoteMutedIds, setRenoteMutedIds] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [actBusy, setActBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Best-effort relation read (never throws, never surfaces an error). */
  const readRelations = useCallback(
    async (ids: string[]): Promise<void> => {
      if (ids.length === 0) return
      if (typeof backend.relationships !== 'function') {
        setRelationsLive(false)
        return
      }
      try {
        const rels = await backend.relationships(ids)
        setRelations(Object.fromEntries(rels.map(r => [r.id, r])))
        setRelationsLive(true)
      } catch (err) {
        if (isUnsupportedError(err)) setRelationsLive(false)
        // Any other failure: keep the last-known state (or one-way
        // buttons), never an error row — mute/block still work below.
      }
    },
    [backend],
  )

  /** Best-effort renote-mute list read (null = unknown, keep one-way). */
  const readRenoteMutes = useCallback(async (): Promise<void> => {
    if (typeof backend.renoteMutes !== 'function') {
      setRenoteMutedIds(null)
      return
    }
    try {
      const page = await backend.renoteMutes()
      setRenoteMutedIds(new Set(page.items.map(a => a.id)))
    } catch {
      setRenoteMutedIds(null)
    }
  }, [backend])

  const run = async () => {
    const q = query.trim()
    if (q.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const page = await backend.search.accounts(q, {limit: 10})
      setResults(page.items)
      setSearched(true)
      setRelations({})
      await Promise.all([
        readRelations(page.items.map(a => a.id)),
        readRenoteMutes(),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n._(msg`Search failed.`))
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
      // Re-read relation state after every action (callers show the new
      // label immediately); the list refresh below stays authoritative.
      await Promise.all([
        readRelations(results.map(a => a.id)),
        readRenoteMutes(),
      ])
      onChanged()
    } catch (err) {
      if (isPermissionError(err)) setError(i18n._(msg`Your account cannot do that here.`))
      else setError(err instanceof Error ? err.message : i18n._(msg`Action failed.`))
    } finally {
      setActBusy(false)
    }
  }

  return (
    <SettingRow
      title={i18n._(msg`Mute or block an account`)}
      hint={i18n._(msg`Search, then mute or block. Changes apply immediately.`)}
      testID="mute-search">
      <TextField
        label={i18n._(msg`Search accounts`)}
        value={query}
        onChangeText={setQuery}
        placeholder={i18n._(msg`username or handle`)}
        error={error ?? undefined}
        testID="mute-search-input"
      />
      <Button
        label={busy ? i18n._(msg`Searching…`) : i18n._(msg`Search`)}
        variant="secondary"
        disabled={busy || query.trim().length === 0}
        onPress={() => void run()}
        testID="mute-search-run"
      />
      {searched && results.length === 0 && !busy ? (
        <Caption color="faint">{i18n._(msg`No accounts found.`)}</Caption>
      ) : null}
      {results.map(user => {
        // State-aware labels (v1 parity): a KNOWN true/false relation
        // renders the undo path; unknown (unsupported endpoint, failed
        // read) keeps the one-way button with its stable testID.
        const rel = relationsLive ? relations[user.id] : undefined
        const muted = rel?.isMuted
        const blocked = rel?.isBlocked
        // Renote state comes ONLY from the renoteMutes list (when the
        // backend exposes it); otherwise the one-way button stays.
        const renoteMuted = renoteMutedIds ? renoteMutedIds.has(user.id) : undefined
        return (
          <View key={user.id} style={[atoms.gap_sm]}>
            <Body>{user.displayName}</Body>
            <Caption color="faint">@{user.acct}</Caption>
            <View style={[atoms.row, atoms.gap_sm]}>
              {muted === true ? (
                <Button
                  label={i18n._(msg`Unmute`)}
                  variant="secondary"
                  disabled={actBusy}
                  onPress={() => void act(() => backend.unmute(user.id))}
                  testID={`mute-search-unmute-${user.id}`}
                />
              ) : (
                <Button
                  label={i18n._(msg`Mute`)}
                  variant="secondary"
                  disabled={actBusy}
                  onPress={() => void act(() => backend.mute(user.id))}
                  testID={`mute-search-mute-${user.id}`}
                />
              )}
              {renoteMuted === true ? (
                <Button
                  label={i18n._(msg`Unmute`)}
                  variant="secondary"
                  disabled={actBusy}
                  onPress={() => void act(() => backend.unmuteRenotes(user.id))}
                  testID={`mute-search-unmuterenotes-${user.id}`}
                />
              ) : (
                <Button
                  label={i18n._(msg`Mute reposts`)}
                  variant="secondary"
                  disabled={actBusy}
                  onPress={() => void act(() => backend.muteRenotes(user.id))}
                  testID={`mute-search-muterenotes-${user.id}`}
                />
              )}
              {blocked === true ? (
                <Button
                  label={i18n._(msg`Unblock`)}
                  variant="secondary"
                  disabled={actBusy}
                  onPress={() => void act(() => backend.unblock(user.id))}
                  testID={`mute-search-unblock-${user.id}`}
                />
              ) : (
                <Button
                  label={i18n._(msg`Block`)}
                  variant="secondary"
                  disabled={actBusy}
                  onPress={() => void act(() => backend.block(user.id))}
                  testID={`mute-search-block-${user.id}`}
                />
              )}
            </View>
          </View>
        )
      })}
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
        if (!cancelled) setError(err instanceof Error ? err.message : i18n._(msg`Could not load.`))
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
      setError(err instanceof Error ? err.message : i18n._(msg`Action failed.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingRow title={title} hint={hint} testID={testID}>
      {items === null ? (
        <Caption color="faint">{i18n._(msg`Loading…`)}</Caption>
      ) : items.length === 0 ? (
        <Caption color="faint">{i18n._(msg`None.`)}</Caption>
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
        <SectionHint>{i18n._(msg`Sign in to manage mutes and blocks.`)}</SectionHint>
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
            title={i18n._(msg`Word mutes`)}
            hint={i18n._(msg`One group per line; words on a line must all match. /regex/ lines stay verbatim.`)}
            placeholder={'spoiler\n/^advertisement/i'}
          />
          <WordField
            backend={backend}
            me={me}
            onSaved={refresh}
            field="hardMutedWords"
            title={i18n._(msg`Hard word mutes`)}
            hint={i18n._(msg`Like word mutes, but matching posts never load.`)}
            placeholder={i18n._(msg`one group per line…`)}
          />
          <WordField
            backend={backend}
            me={me}
            onSaved={refresh}
            field="mutedInstances"
            title={i18n._(msg`Muted servers`)}
            hint={i18n._(msg`One host per line. Matching is case-sensitive.`)}
            placeholder="example.com"
          />
        </>
      ) : (
        <PlaceholderRow
          title={i18n._(msg`Word and server mutes`)}
          hint={i18n._(msg`Soft words, hard words, muted servers.`)}
          reason={i18n._(msg`Needs a Misskey-family server.`)}
          testID="placeholder-word-mutes"
        />
      )}
      <MuteBlockSearch backend={backend} onChanged={refresh} />
      <AccountList
        title={i18n._(msg`Muted accounts`)}
        hint={i18n._(msg`Unmute to see their posts again.`)}
        testID="muted-list"
        load={b => b.mutes().then(p => p.items)}
        action={i18n._(msg`Unmute`)}
        run={(b, id) => b.unmute(id)}
        refreshKey={refreshKey}
      />
      <AccountList
        title={i18n._(msg`Blocked accounts`)}
        hint={i18n._(msg`Unblock to interact again.`)}
        testID="blocked-list"
        load={b => b.blocks().then(p => p.items)}
        action={i18n._(msg`Unblock`)}
        run={(b, id) => b.unblock(id)}
        refreshKey={refreshKey}
      />
      {backend.renoteMutes ? (
        <AccountList
          title={i18n._(msg`Repost-muted accounts`)}
          hint={i18n._(msg`Unmute reposts to see them again.`)}
          testID="renote-mutes-list"
          load={b => (b.renoteMutes ? b.renoteMutes().then(p => p.items) : Promise.resolve([]))}
          action={i18n._(msg`Unmute reposts`)}
          run={(b, id) => b.unmuteRenotes(id)}
          refreshKey={refreshKey}
        />
      ) : (
        <PlaceholderRow
          title={i18n._(msg`Repost-muted accounts`)}
          hint={i18n._(msg`Accounts whose reposts are hidden.`)}
          reason={i18n._(msg`Not wired yet — the backend has no list endpoint.`)}
          testID="placeholder-renote-mutes"
        />
      )}
    </View>
  )
}
