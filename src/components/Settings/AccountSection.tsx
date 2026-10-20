import {useEffect, useState} from 'react'
import {View} from 'react-native'

import {isUnsupportedError, type Account} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {AccountSwitcher} from '#/components/AccountSwitcher'
import {Button} from '#/components/Button'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useActiveSession} from '#/state/session/SessionProvider'

import {PlaceholderRow, SettingRow} from './rows'

// Account section (v1 `/settings/account` parity): the active session's
// identity, the stored-session switcher (switch, sign out, sign out
// everywhere, add another) over the session store, and the Sharkey-family
// account-wide quote refusal. Profile editing lives ONLY on your own
// profile page — never here.

function RejectQuotesRow() {
  const {backend} = useActiveBackend()
  const [me, setMe] = useState<Account | null>(null)
  const [supported, setSupported] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!backend || backend.family !== 'misskey') return
    void backend
      .me()
      .then(account => {
        if (!cancelled) setMe(account)
      })
      .catch(() => {
        if (!cancelled) setSupported(false)
      })
    return () => {
      cancelled = true
    }
  }, [backend])

  if (!backend) return null
  if (backend.family !== 'misskey') {
    return (
      <PlaceholderRow
        title="Refuse incoming quotes"
        hint="Account-wide: other servers cannot quote your posts."
        reason="Needs a Misskey-family server."
        testID="reject-quotes-placeholder"
      />
    )
  }
  if (!supported) {
    return (
      <PlaceholderRow
        title="Refuse incoming quotes"
        hint="Account-wide: other servers cannot quote your posts."
        reason="Not on this server."
        testID="reject-quotes-placeholder"
      />
    )
  }
  const raw: unknown = me?.ext.me?.['rejectQuotes'] ?? me?.ext.rejectQuotes
  const value = raw === true
  const save = async (next: boolean) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await backend.updateProfile({ext: {rejectQuotes: next}})
      setMe(updated)
    } catch (err) {
      if (isUnsupportedError(err)) setSupported(false)
      else setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingRow
      title="Refuse incoming quotes"
      hint="Account-wide: other servers cannot quote your posts."
      testID="reject-quotes-row">
      <Button
        label={value ? 'On' : 'Off'}
        variant={value ? 'primary' : 'secondary'}
        disabled={busy || !me}
        disabledReason={!me ? 'Loading account…' : undefined}
        onPress={() => void save(!value)}
        testID="reject-quotes-toggle"
      />
      {error ? <Caption testID="reject-quotes-error">{error}</Caption> : null}
    </SettingRow>
  )
}

export function AccountSection({onAddAccount}: {onAddAccount: () => void}) {
  const session = useActiveSession()
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-account">
      <SettingRow
        title="This device"
        hint={
          session
            ? `Signed in as ${session.accountId} on ${session.origin}.`
            : 'Signed out. Add an account to sign in.'
        }
        testID="account-identity-row">
        {session ? (
          <Body>
            {session.user?.displayName ?? session.accountId} · {session.origin}
          </Body>
        ) : null}
      </SettingRow>
      <AccountSwitcher onAddAccount={onAddAccount} />
      <RejectQuotesRow />
    </View>
  )
}
