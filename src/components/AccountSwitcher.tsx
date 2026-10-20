import {useState} from 'react'
import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {useSessionStore, useSessions} from '#/state/session/SessionProvider'

// Account switcher (slice 3.1): the stored sessions as a list — switch,
// sign out one, sign out everywhere, add another. Actions render only when
// they apply (the active account shows a label, never an inert switch
// button); sign-out failures never block the local state change (the store
// revokes best-effort).

export function AccountSwitcher({onAddAccount}: {onAddAccount: () => void}) {
  const store = useSessionStore()
  const sessions = useSessions()
  const activeId = store.activeId()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (sessions.length === 0) {
    return (
      <View style={[atoms.gap_sm]}>
        <Caption color="faint">No accounts yet.</Caption>
        <Button label="Add account" variant="secondary" onPress={onAddAccount} />
      </View>
    )
  }

  const run = async (id: string | null, fn: () => Promise<void>) => {
    setBusyId(id ?? 'all')
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <View style={[atoms.gap_sm]}>
      {sessions.map(session => {
        const isActive = session.id === activeId
        const label = session.user?.displayName ?? session.accountId
        return (
          <View
            key={session.id}
            testID={`account-${session.id}`}
            style={[atoms.gap_sm, atoms.p_md]}>
            <Body>
              {label} · {session.origin}
            </Body>
            <View style={[atoms.row, atoms.gap_sm]}>
              {isActive ? (
                <Caption color="faint">Current account</Caption>
              ) : (
                <Button
                  label="Switch"
                  variant="secondary"
                  testID={`switch-${session.id}`}
                  onPress={() => {
                    store.switch(session.id)
                  }}
                />
              )}
              <Button
                label="Sign out"
                variant="secondary"
                testID={`signout-${session.id}`}
                onPress={() => void run(session.id, () => store.signOut(session.id))}
              />
            </View>
          </View>
        )
      })}
      {sessions.length > 1 ? (
        <Button
          label="Sign out everywhere"
          variant="secondary"
          testID="signout-everywhere"
          onPress={() => void run(null, () => store.signOutEverywhere())}
        />
      ) : null}
      <Button label="Add account" variant="secondary" onPress={onAddAccount} />
      {busyId ? <Caption color="faint">Working…</Caption> : null}
      {error ? <Caption testID="switcher-error">{error}</Caption> : null}
    </View>
  )
}
