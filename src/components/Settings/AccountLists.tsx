// Mutes account lists (D3.7 split of `MutesSection.tsx`): the muted /
// blocked / repost-muted account rows with unmute/unblock. Moved verbatim
// next to `rows.tsx` per the slice (`AccountList` lives here, with its
// `UserRow`).

import {useEffect, useState} from 'react'
import {View} from 'react-native'

import {msg} from '@lingui/macro'

import type {Account, Backend} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {i18n} from '#/locale/i18n'
import {useActiveBackend} from '#/screens/HomeFeed'

import {SettingRow} from './rows'

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

export function AccountList({
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

  /* eslint-disable react-hooks/exhaustive-deps -- `load` takes the backend as a parameter and closes over nothing, and callers pass inline arrows, so listing it would refetch on every parent render; `refreshKey` is the intentional reload signal (read by change, not by value). */
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
  /* eslint-enable react-hooks/exhaustive-deps */

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
