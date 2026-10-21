import {useEffect, useState} from 'react'
import {View} from 'react-native'

import {isUnsupportedError, type Account, type Session} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {AccountSwitcher} from '#/components/AccountSwitcher'
import {Button} from '#/components/Button'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useHosting} from '#/state/hosting'
import {useActiveSession} from '#/state/session/SessionProvider'

import {PlaceholderRow, SettingRow} from './rows'

// Account section (v1 `/settings/account` parity): the active session's
// identity, the stored-session switcher (switch, sign out, sign out
// everywhere, add another) over the session store, and the Sharkey-family
// account-wide quote refusal. Profile editing lives ONLY on your own
// profile page — never here.

// v1 `/settings/account` parity: the backend family/flavor label and the
// account handle. Flavor labels are display strings (never wire types);
// an unrecognized flavor falls back to the family name.
const FLAVOR_LABELS: Record<string, string> = {
  misskey: 'Misskey',
  sharkey: 'Sharkey',
  catodon: 'Catodon',
  pinetree: 'Pinetree',
  mastodon: 'Mastodon',
  akkoma: 'Akkoma',
  pleroma: 'Pleroma',
}

export function backendLabelFor(session: Pick<Session, 'family' | 'flavor'>): string {
  const familyLabel = session.family === 'mastodon' ? 'Mastodon family' : 'Misskey family'
  const flavorLabel = FLAVOR_LABELS[session.flavor]
  return flavorLabel ? `${flavorLabel} · ${familyLabel}` : familyLabel
}

/** Handle shown for the session: the cached profile acct, else the stored id. */
export function handleFor(session: Pick<Session, 'accountId'> & {user?: {acct?: string} | null}): string {
  const acct = session.user?.acct?.trim()
  return `@${acct && acct.length > 0 ? acct : session.accountId}`
}

function IdentityBlock() {
  const session = useActiveSession()
  const hosting = useHosting()
  if (!session) {
    return (
      <SettingRow
        title="This device"
        hint="Signed out. Add an account to sign in."
        testID="account-identity-row">
        {null}
      </SettingRow>
    )
  }
  // External when the session origin is not the app's home origin. The
  // home origin is known only in first-party mode (`homeOrigin` is null
  // for third-party clients, where every account is external); there the
  // session's own `hosting` flag — set at sign-in (`screens/Login.tsx`:
  // internal logins store `first-party`, every external flow `third-party`)
  // — is the authority. Read-only use of both APIs, no new seam.
  const homeOrigin = hosting?.homeOrigin ?? null
  const isExternal =
    homeOrigin != null ? session.origin !== homeOrigin : session.hosting === 'third-party'
  return (
    <SettingRow
      title="This device"
      hint={`Signed in as ${session.accountId} on ${session.origin}.`}
      testID="account-identity-row">
      <Body>
        {session.user?.displayName ?? session.accountId} · {session.origin}
      </Body>
      <Body testID="account-backend-label">
        {backendLabelFor(session)} · {handleFor(session)}
      </Body>
      {isExternal ? (
        <Caption testID="account-external-note">
          External account: sign-in and requests go to {session.origin}, not this app&apos;s home
          server.
        </Caption>
      ) : null}
    </SettingRow>
  )
}

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

export function AccountSection({
  onAddAccount,
  onOpenFollowRequests,
}: {
  onAddAccount: () => void
  onOpenFollowRequests: () => void
}) {
  const session = useActiveSession()
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-account">
      <IdentityBlock />
      <AccountSwitcher onAddAccount={onAddAccount} />
      {session ? (
        <SettingRow
          title="Follow requests"
          hint="Review accounts waiting for your approval."
          testID="follow-requests-row">
          <Button
            label="View requests"
            variant="secondary"
            onPress={onOpenFollowRequests}
            testID="follow-requests-open"
          />
        </SettingRow>
      ) : null}
      <RejectQuotesRow />
    </View>
  )
}
