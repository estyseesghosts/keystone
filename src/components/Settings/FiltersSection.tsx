import {useEffect, useState} from 'react'
import {View} from 'react-native'

import type {Backend, Filter} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useActiveSession} from '#/state/session/SessionProvider'

import {PlaceholderRow, SectionHint, SettingRow} from './rows'

// Filters section (v1 `/settings/filters` parity): server-side word
// filters (phrase + contexts). The Mastodon family implements
// `backend.filters`; the Misskey family has no filter endpoints, so it
// renders an honest placeholder — never an error, never a fake list.

function FiltersBody({backend}: {backend: Backend & {filters: NonNullable<Backend['filters']>}}) {
  const filters = backend.filters
  const [items, setItems] = useState<Filter[] | null>(null)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setItems(null)
    void filters
      .list()
      .then(list => {
        if (!cancelled) setItems(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load filters.')
      })
    return () => {
      cancelled = true
    }
  }, [backend])

  const add = async () => {
    const clean = phrase.trim()
    if (clean.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await filters.create(clean, ['home', 'notifications', 'public', 'thread'])
      setItems(list => [...(list ?? []), created])
      setPhrase('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the filter.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await filters.delete(id)
      setItems(list => (list ?? []).filter(x => x.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the filter.')
    }
  }

  return (
    <View style={[atoms.gap_sm]}>
      <SettingRow title="Add a filter" hint="One phrase; matches everywhere." testID="filter-add-row">
        <TextField
          label="Phrase"
          value={phrase}
          onChangeText={setPhrase}
          placeholder="spoiler"
          error={error ?? undefined}
          testID="filter-phrase-input"
        />
        <Button
          label={busy ? 'Adding…' : 'Add filter'}
          variant="primary"
          disabled={busy || phrase.trim().length === 0}
          onPress={() => void add()}
          testID="filter-add"
        />
      </SettingRow>
      <SettingRow title="Filters" testID="filter-list-row">
        {items === null ? (
          <Caption color="faint">Loading…</Caption>
        ) : items.length === 0 ? (
          <Caption color="faint">No filters. Matching posts stay hidden once you add one.</Caption>
        ) : (
          <View style={[atoms.gap_sm]} testID="filter-list">
            {items.map(f => (
              <View key={f.id} style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
                <Body>{f.phrase}</Body>
                <Button
                  label="Remove"
                  variant="secondary"
                  onPress={() => void remove(f.id)}
                  testID={`filter-remove-${f.id}`}
                />
              </View>
            ))}
          </View>
        )}
      </SettingRow>
    </View>
  )
}

export function FiltersSection() {
  const session = useActiveSession()
  const {backend} = useActiveBackend()
  if (!session || !backend) {
    return (
      <View style={[atoms.gap_sm]} testID="settings-section-filters">
        <SectionHint>Sign in to manage word filters.</SectionHint>
      </View>
    )
  }
  if (!backend.filters) {
    return (
      <View style={[atoms.gap_sm]} testID="settings-section-filters">
        <PlaceholderRow
          title="Word filters"
          hint="Server-side phrases that hide matching posts everywhere."
          reason="Needs a server with word filters (this one has none)."
          testID="placeholder-filters"
        />
      </View>
    )
  }
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-filters">
      <FiltersBody backend={backend as Backend & {filters: NonNullable<Backend['filters']>}} />
    </View>
  )
}
