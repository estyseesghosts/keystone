import {useEffect, useState} from 'react'
import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {isUnsupportedError, type Account, type Session} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {AccountSwitcher} from '#/components/AccountSwitcher'
import {Button} from '#/components/Button'
import {i18n} from '#/locale/i18n'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useHosting} from '#/state/hosting'
import {adminInsightGate} from '#/state/queries/adminInsight'
import {adminReportsGate} from '#/state/queries/adminReports'
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
        title={i18n._(msg`This device`)}
        hint={i18n._(msg`Signed out. Add an account to sign in.`)}
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
      title={i18n._(msg`This device`)}
      hint={
        session
          ? i18n._(msg`Signed in as ${session.accountId} on ${session.origin}.`)
          : i18n._(msg`Signed out. Add an account to sign in.`)
      }
      testID="account-identity-row">
      {session ? (
        <Body>
          {session.user?.displayName ?? session.accountId} · {session.origin}
        </Body>
      ) : null}
      {session ? (
        <Body testID="account-backend-label">
          {backendLabelFor(session)} · {handleFor(session)}
        </Body>
      ) : null}
      {session && isExternal ? (
        <Caption testID="account-external-note">
          {i18n._(
            msg`External account: sign-in and requests go to ${session.origin}, not this app's home server.`,
          )}
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
        title={i18n._(msg`Refuse incoming quotes`)}
        hint={i18n._(msg`Account-wide: other servers cannot quote your posts.`)}
        reason={i18n._(msg`Needs a Misskey-family server.`)}
        testID="reject-quotes-placeholder"
      />
    )
  }
  if (!supported) {
    return (
      <PlaceholderRow
        title={i18n._(msg`Refuse incoming quotes`)}
        hint={i18n._(msg`Account-wide: other servers cannot quote your posts.`)}
        reason={i18n._(msg`Not on this server.`)}
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
      else setError(err instanceof Error ? err.message : i18n._(msg`Could not save.`))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingRow
      title={i18n._(msg`Refuse incoming quotes`)}
      hint={i18n._(msg`Account-wide: other servers cannot quote your posts.`)}
      testID="reject-quotes-row">
      <Button
        label={value ? i18n._(msg`On`) : i18n._(msg`Off`)}
        variant={value ? 'primary' : 'secondary'}
        disabled={busy || !me}
        disabledReason={!me ? i18n._(msg`Loading account…`) : undefined}
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
  onOpenAdminInsight,
  onOpenAdminReports,
}: {
  onAddAccount: () => void
  onOpenFollowRequests: () => void
  onOpenAdminInsight: () => void
  onOpenAdminReports: () => void
}) {
  const session = useActiveSession()
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-account">
      <IdentityBlock />
      <AccountSwitcher onAddAccount={onAddAccount} />
      {session ? (
        <SettingRow
          title={i18n._(msg`Follow requests`)}
          hint={i18n._(msg`Review accounts waiting for your approval.`)}
          testID="follow-requests-row">
          <Button
            label={i18n._(msg`View requests`)}
            variant="secondary"
            onPress={onOpenFollowRequests}
            testID="follow-requests-open"
          />
        </SettingRow>
      ) : null}
      <AdminInsightRow onOpen={onOpenAdminInsight} />
      <AdminReportsRow onOpen={onOpenAdminReports} />
      <RejectQuotesRow />
    </View>
  )
}

/** Server-insight entry (Wave 3 slice 3.1): read-only admin metrics.
 * Hidden when the surface cannot exist here (signed out,
 * non-Mastodon family, no insight module, capability unsupported);
 * disabled with the honest reason for a signed-in viewer whose account
 * the server does not report as admin/moderator. Never an inert button. */
function AdminInsightRow({onOpen}: {onOpen: () => void}) {
  const {session, backend} = useActiveBackend()
  const gate = adminInsightGate(backend, session?.user ?? null)
  if (!gate.ok && gate.reason !== 'not-staff') return null
  return (
    <SettingRow
      title={i18n._(msg`Server insight`)}
      hint={i18n._(msg`Admin metrics and public server info. No changes can be made here.`)}
      testID="admin-insight-row">
      <Button
        label={i18n._(msg`View insight`)}
        variant="secondary"
        disabled={!gate.ok}
        disabledReason={
          !gate.ok
            ? i18n._(msg`Requires an admin or moderator account on this server.`)
            : undefined
        }
        onPress={onOpen}
        testID="admin-insight-open"
      />
    </SettingRow>
  )
}

/** Reports-queue entry (Wave 3 slice 3.2): the daily moderation surface.
 * Same gating shape as the insight row — hidden when the surface cannot
 * exist here (signed out, non-queue family, no queue module, unsupported
 * capability); disabled with the honest reason for a signed-in viewer the
 * server does not report as admin/moderator. Never an inert button. */
function AdminReportsRow({onOpen}: {onOpen: () => void}) {
  const {session, backend} = useActiveBackend()
  const gate = adminReportsGate(backend, session?.user ?? null)
  if (!gate.ok && gate.reason !== 'not-staff') return null
  return (
    <SettingRow
      title={i18n._(msg`Reports`)}
      hint={i18n._(msg`Moderate user reports. Every change asks for confirmation first.`)}
      testID="admin-reports-row">
      <Button
        label={i18n._(msg`Open queue`)}
        variant="secondary"
        disabled={!gate.ok}
        disabledReason={
          !gate.ok
            ? i18n._(msg`Requires an admin or moderator account on this server.`)
            : undefined
        }
        onPress={onOpen}
        testID="admin-reports-open"
      />
    </SettingRow>
  )
}
