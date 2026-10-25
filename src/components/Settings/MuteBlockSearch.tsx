// Mute/block search (D3.7 split of `MutesSection.tsx`): search-to-
// mute/block with state-aware undo. Moved verbatim — relation reads stay
// best-effort (never an error row), renote state comes only from the
// `renoteMutes` list, and every action re-reads before the list refresh.

import {useCallback, useState} from 'react'
import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  isPermissionError,
  isUnsupportedError,
  type Account,
  type Backend,
  type Relationship,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {i18n} from '#/locale/i18n'

import {SettingRow} from './rows'

export function MuteBlockSearch({backend, onChanged}: {backend: Backend; onChanged: () => void}) {
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
