import {useState} from 'react'
import {Platform, View} from 'react-native'
import {
  CommonActions,
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'

import {msg} from '@lingui/macro'

import {
  detectServer,
  MfaRequiredError,
  type Account,
  type Capabilities,
  type DetectionEvidence,
  type ServerFamily,
  type ServerFlavor,
  type SessionGrant,
  type SessionHosting,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {AccountSwitcher} from '#/components/AccountSwitcher'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {i18n} from '#/locale/i18n'
import type {RootParamList} from '#/routes'
import {AUTH_CALLBACK_PATH} from '#/routes'
import {useHosting} from '#/state/hosting'
import {useSessionStore} from '#/state/session/SessionProvider'
import {appStorage} from '#/storage'

import {
  completeMastodonCallback,
  type MastodonCallbackDone,
} from './MastodonCallback'
import {
  completeMfaSignin,
  completePasswordSignin,
} from './PasswordSignin'
import {
  getWebOrigin,
  normalizeServerInput,
  pollMisskeyApproval,
  startMastodonOAuth,
  startMisskeyMiAuth,
  takeMisskeyPending,
  webCallbackUri,
  type MisskeyMiAuthPending,
} from './LoginFlows'
import {miauthAccountMatchesHost, miauthPendingMatchesOrigin, parseCallbackParams} from './AuthCallback'

// Complete the iOS auth session when the app returns from the browser.
void WebBrowser.maybeCompleteAuthSession()

type LoginMode = 'internal' | 'external'
type InternalKind = 'misskey-native' | 'pinetree' | 'password-grant' | 'mastodon-pkce'

interface Detection {
  origin: string
  family: ServerFamily
  flavor: ServerFlavor
  features: Capabilities
  evidence: DetectionEvidence | null
}

/** The redirect URI registered with every instance (clickstone §1.13):
 * web is `${origin}/auth/callback` at every base (see `webCallbackUri`);
 * native keeps the app's own scheme path. Both callback paths are routed,
 * so this URI is stable — no re-registration. Exported for the URI test. */
export function redirectUriFor(): string {
  if (Platform.OS === 'web') {
    return webCallbackUri(getWebOrigin())
  }
  return Linking.createURL(AUTH_CALLBACK_PATH.replace(/^\//, ''))
}

async function openBrowser(url: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    const loc = (globalThis as {location?: {assign?: (url: string) => void}}).location
    loc?.assign?.(url)
    return null
  }
  // The auth session captures the redirect in-session and reports it as
  // the result URL. Callers that can complete inline (iOS, below) use it;
  // the AuthCallback deep-link screen remains the completion path
  // everywhere the OS re-opens the app with the redirect (Android).
  const res = await WebBrowser.openAuthSessionAsync(url, redirectUriFor())
  return res.type === 'success' ? res.url : null
}

function gateMessage(value: string | undefined, action: string): string | null {
  if (value === 'supported') return null
  if (value === 'unsupported') return `This server does not support ${action}.`
  return `Unknown whether this server supports ${action}.`
}

function internalKindFor(family: ServerFamily | null, flavor: ServerFlavor): InternalKind | null {
  if (family === 'mastodon') {
    return flavor === 'akkoma' || flavor === 'pleroma' ? 'password-grant' : 'mastodon-pkce'
  }
  if (family === 'misskey') {
    return flavor === 'pinetree' ? 'pinetree' : 'misskey-native'
  }
  return null
}

export function LoginScreen() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const route = useRoute<RouteProp<RootParamList, 'Login'>>()
  const store = useSessionStore()
  const hosting = useHosting()
  const firstParty = hosting?.hosting === 'first-party' ? hosting : null
  const allowExternal = hosting?.allowExternalAccounts ?? true
  // 0.8: the shell's scope-upgrade prompt re-opens sign-in for the session
  // that needs a fresh token. Prefill the origin; when it is not this
  // app's home server, start on the external form so the prefilled origin
  // is actually the one being signed in to.
  const prefillOrigin = route.params?.origin?.trim() || null
  const [mode, setMode] = useState<LoginMode>(
    prefillOrigin != null &&
      firstParty != null &&
      prefillOrigin !== (firstParty.homeOrigin ?? '')
      ? 'external'
      : 'internal',
  )
  const internalMode = firstParty !== null && (mode === 'internal' || !allowExternal)

  const [server, setServer] = useState(prefillOrigin ?? hosting?.suggestedHost ?? '')
  const [detection, setDetection] = useState<Detection | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mfa, setMfa] = useState<{mfaToken: string; challengeTypes: string[]} | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [miauth, setMiauth] = useState<MisskeyMiAuthPending | null>(null)
  const [miauthStatus, setMiauthStatus] = useState<string | null>(null)

  const fail = (err: unknown) => {
    setError(err instanceof Error ? err.message : 'Sign-in failed.')
  }

  const finish = async (result: {
    origin: string
    family: ServerFamily
    flavor: ServerFlavor
    token: string
    account: Account
    grant: SessionGrant
    hosting: SessionHosting
    evidence?: DetectionEvidence | null
  }) => {
    await store.add({
      origin: result.origin,
      family: result.family,
      flavor: result.flavor,
      accountId: result.account.id,
      token: result.token,
      grant: result.grant,
      hosting: result.hosting,
      user: result.account,
      ...(result.evidence ? {evidence: result.evidence} : {}),
    })
    // Land on the tab shell: the Login screen lives on the stack, so a
    // plain `navigate('Home')` resolves nowhere — reset to Main (Home tab).
    nav.dispatch(CommonActions.reset({index: 0, routes: [{name: 'Main'}]}))
  }

  // --- Internal (first-party) login: this origin IS the home server --------

  const internalKind = firstParty
    ? internalKindFor(firstParty.family, firstParty.flavor)
    : null

  const submitInternalPassword = async () => {
    if (!firstParty) return
    setBusy(true)
    setError(null)
    try {
      const done = await completePasswordSignin({
        family: 'misskey',
        origin: firstParty.homeOrigin ?? '',
        flavor: firstParty.flavor,
        hosting: 'first-party',
        evidence: firstParty.detection?.evidence ?? null,
        username,
        password,
      })
      await finish(done)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const submitInternalMastodonPassword = async () => {
    if (!firstParty?.homeOrigin) return
    setBusy(true)
    setError(null)
    try {
      const done = await completePasswordSignin({
        family: 'mastodon',
        origin: firstParty.homeOrigin,
        flavor: firstParty.flavor,
        hosting: 'first-party',
        evidence: firstParty.detection?.evidence ?? null,
        username,
        password,
        appStore: appStorage(),
        redirectUri: redirectUriFor(),
      })
      await finish(done)
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setMfa({mfaToken: err.mfaToken, challengeTypes: err.challengeTypes})
        setMfaCode('')
      } else {
        fail(err)
      }
    } finally {
      setBusy(false)
    }
  }

  const submitInternalMfa = async () => {
    if (!firstParty?.homeOrigin || !mfa) return
    setBusy(true)
    setError(null)
    try {
      const done = await completeMfaSignin({
        origin: firstParty.homeOrigin,
        flavor: firstParty.flavor,
        hosting: 'first-party',
        evidence: firstParty.detection?.evidence ?? null,
        mfaToken: mfa.mfaToken,
        challengeTypes: mfa.challengeTypes,
        code: mfaCode,
        appStore: appStorage(),
        redirectUri: redirectUriFor(),
      })
      await finish(done)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const submitInternalOAuth = async () => {
    if (!firstParty?.homeOrigin) return
    setBusy(true)
    setError(null)
    try {
      const callbackUrl = await startMastodonOAuth({
        appStore: appStorage(),
        origin: firstParty.homeOrigin,
        redirectUri: redirectUriFor(),
        openBrowser,
        flavor: firstParty.flavor,
      })
      if (Platform.OS === 'ios' && callbackUrl) {
        await finishOAuthCallbackUrl(callbackUrl, 'first-party')
        return
      }
      // The callback screen completes the flow (AuthCallback).
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  // --- External (third-party) login: another server -------------------------

  const detect = async () => {
    const origin = normalizeServerInput(server)
    if (!origin) {
      setError('Enter a server, e.g. example.social.')
      return
    }
    setDetecting(true)
    setError(null)
    try {
      const found = await detectServer(origin)
      if (!found.family) {
        setError('Could not detect this server type. Check the address and try again.')
        return
      }
      setDetection({origin, family: found.family, flavor: found.flavor, features: found.features, evidence: found.evidence})
    } catch (err) {
      fail(err)
    } finally {
      setDetecting(false)
    }
  }

  const submitExternalMastodonPassword = async () => {
    if (!detection) return
    setBusy(true)
    setError(null)
    try {
      const done = await completePasswordSignin({
        family: 'mastodon',
        origin: detection.origin,
        flavor: detection.flavor,
        hosting: 'third-party',
        evidence: detection.evidence,
        username,
        password,
        appStore: appStorage(),
        redirectUri: redirectUriFor(),
      })
      await finish(done)
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setMfa({mfaToken: err.mfaToken, challengeTypes: err.challengeTypes})
        setMfaCode('')
      } else {
        fail(err)
      }
    } finally {
      setBusy(false)
    }
  }

  const submitExternalMfa = async () => {
    if (!detection || !mfa) return
    setBusy(true)
    setError(null)
    try {
      const done = await completeMfaSignin({
        origin: detection.origin,
        flavor: detection.flavor,
        hosting: 'third-party',
        evidence: detection.evidence,
        mfaToken: mfa.mfaToken,
        challengeTypes: mfa.challengeTypes,
        code: mfaCode,
        appStore: appStorage(),
        redirectUri: redirectUriFor(),
      })
      await finish(done)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const submitExternalOAuth = async () => {
    if (!detection) return
    setBusy(true)
    setError(null)
    try {
      const callbackUrl = await startMastodonOAuth({
        appStore: appStorage(),
        origin: detection.origin,
        redirectUri: redirectUriFor(),
        openBrowser,
        flavor: detection.flavor,
      })
      if (Platform.OS === 'ios' && callbackUrl) {
        await finishOAuthCallbackUrl(callbackUrl, 'third-party')
        return
      }
      // The callback screen completes the flow (AuthCallback).
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  /** Misskey-family browser sign-in (MiAuth): approve on the instance, poll,
   * verify, store. Third-party never asks for a password. */
  const submitMiAuth = async (pending: MisskeyMiAuthPending | null, attempts?: number) => {
    if (!detection) return
    setBusy(true)
    setError(null)
    try {
      // A resumed `pending` never captured an opener result URL — only a
      // fresh start has one (H3), so the two cases stay separate instead
      // of an `in` check on the union.
      let active: MisskeyMiAuthPending
      let callbackUrl: string | null = null
      if (pending !== null) {
        active = pending
      } else {
        const started = await startMisskeyMiAuth({
          pendingStore: appStorage(),
          origin: detection.origin,
          redirectUri: redirectUriFor(),
          openBrowser,
        })
        active = started
        callbackUrl = started.callbackUrl
      }
      setMiauth(active)
      // ADR 0012: the pending row must name the origin being signed in
      // to — if the server input changed after the approval page opened,
      // the row no longer matches and never completes here.
      if (!miauthPendingMatchesOrigin(active, detection.origin)) {
        setError(i18n._(msg`This sign-in response did not match the server. Please start again.`))
        return
      }
      // Same-tab web navigation unloads this page (the callback completes
      // it); otherwise poll here for the approval.
      if (Platform.OS === 'web') {
        setMiauthStatus('Approve on your server, then continue there.')
        return
      }
      // iOS inline completion (H3): `openAuthSessionAsync` consumed the
      // redirect in-session, so the AuthCallback deep link never fires —
      // complete here from the session's result URL, like
      // `finishOAuthCallbackUrl` above. A null/callback-less result falls
      // through to polling (Android relaunch, dismissed session); polling
      // stays the fallback either way.
      if (Platform.OS === 'ios' && callbackUrl) {
        if (await finishMiAuthCallbackUrl(callbackUrl)) return
      }
      setMiauthStatus('Waiting for approval on your server…')
      const done = await pollMisskeyApproval({
        scheme: active.scheme,
        host: active.host,
        session: active.session,
        ...(attempts !== undefined ? {attempts} : {}),
      })
      // ADR 0012: the verified account must belong to the pending host —
      // anything else is discarded, never stored.
      if (!miauthAccountMatchesHost(done.account, active.host)) {
        setError(i18n._(msg`This sign-in response did not match the server. Please start again.`))
        return
      }
      await finish({
        origin: done.origin,
        family: 'misskey',
        flavor: detection.flavor,
        token: done.token,
        account: done.account,
        grant: 'miauth',
        hosting: 'third-party',
        evidence: detection.evidence,
      })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
      setMiauthStatus(null)
    }
  }

  /** iOS inline MiAuth completion (H3, parity with `finishOAuthCallbackUrl`
   * below): `openAuthSessionAsync` consumes the `keystone://…?session=`
   * redirect in-session and never re-opens the app, so the AuthCallback
   * deep link never fires — take the pending row and verify here instead.
   * Returns true when the flow is complete or definitively failed; false
   * when the URL carries no session and the caller should fall back to
   * polling. */
  const finishMiAuthCallbackUrl = async (href: string): Promise<boolean> => {
    const params = parseCallbackParams(href)
    if (params.error) {
      setError('The sign-in was cancelled or denied.')
      return true
    }
    if (!params.session) return false
    // Take-once (same replay guard as AuthCallback): a consumed row means
    // the link path owns this session — polling the live `active` session
    // below still covers the wait.
    const taken = takeMisskeyPending(appStorage(), params.session)
    if (!taken || !detection) return false
    // ADR 0012: the taken row must name the origin being signed in to.
    if (!miauthPendingMatchesOrigin(taken, detection.origin)) {
      setError(i18n._(msg`This sign-in response did not match the server. Please start again.`))
      return true
    }
    try {
      // Just approved — the check lands immediately; a few retries cover
      // the slow-approve race (same shape as AuthCallback).
      const done = await pollMisskeyApproval({
        scheme: taken.scheme,
        host: taken.host,
        session: taken.session,
        attempts: 5,
      })
      // ADR 0012: the verified account must belong to the pending host.
      if (!miauthAccountMatchesHost(done.account, taken.host)) {
        setError(i18n._(msg`This sign-in response did not match the server. Please start again.`))
        return true
      }
      await finish({
        origin: done.origin,
        family: 'misskey',
        flavor: detection.flavor,
        token: done.token,
        account: done.account,
        grant: 'miauth',
        hosting: 'third-party',
        evidence: detection.evidence,
      })
      return true
    } catch (err) {
      fail(err)
      return true
    }
  }

  const cancelMiAuth = () => {
    setMiauth(null)
    setMiauthStatus(null)
    setError(null)
  }

  /** iOS inline OAuth completion (parity with AuthCallback's mastodon
   * branch): `openAuthSessionAsync` consumes the redirect in-session and
   * never re-opens the app, so the AuthCallback deep link never fires —
   * complete here from the session's result URL. Returns true when the
   * flow is complete or definitively failed; false when the URL carries
   * no response and the caller should keep waiting on the link path
   * (Android) instead. Exchange + detect run in the shared
   * `completeMastodonCallback` helper (same as AuthCallback). */
  const finishOAuthCallbackUrl = async (
    href: string,
    hosting: 'first-party' | 'third-party',
  ): Promise<boolean> => {
    const params = parseCallbackParams(href)
    if (params.error) {
      setError('The sign-in was cancelled or denied.')
      return true
    }
    if (!params.code || !params.state) return false
    const done: MastodonCallbackDone | null = await completeMastodonCallback({
      appStore: appStorage(),
      code: params.code,
      state: params.state,
    })
    if (!done) return false // replay: the link path owns it
    await finish({
      origin: done.origin,
      family: 'mastodon',
      flavor: done.flavor,
      token: done.token,
      account: done.account,
      grant: 'oauth-pkce',
      hosting,
      evidence: done.evidence,
    })
    return true
  }

  const passwordGate = detection ? gateMessage(detection.features.password_grant, 'password sign-in') : null
  const pkceGate = detection ? gateMessage(detection.features.pkce, 'browser sign-in') : null

  if (!hosting) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`Loading…`)}</Body>
      </View>
    )
  }

  return (
    <View style={[atoms.flex1, atoms.p_md, atoms.gap_md]}>
      <Heading>{i18n._(msg`Sign in`)}</Heading>
      <AccountSwitcher onAddAccount={() => { setDetection(null); setMiauth(null) }} />
      {firstParty && allowExternal ? (
        <View style={[atoms.row, atoms.gap_sm]}>
          <Button
            label={i18n._(msg`This server`)}
            variant={internalMode ? 'primary' : 'secondary'}
            onPress={() => setMode('internal')}
            testID="login-mode-internal"
          />
          <Button
            label={i18n._(msg`Another server`)}
            variant={internalMode ? 'secondary' : 'primary'}
            onPress={() => setMode('external')}
            testID="login-mode-external"
          />
        </View>
      ) : null}
      {internalMode && firstParty ? (
        <InternalForm
          kind={internalKind}
          serverName={firstParty.name ?? firstParty.homeOrigin ?? 'this server'}
          username={username}
          password={password}
          busy={busy}
          mfa={mfa}
          mfaCode={mfaCode}
          error={error}
          onUsername={setUsername}
          onPassword={setPassword}
          onMfaCode={setMfaCode}
          onPasswordSubmit={() => void (internalKind === 'password-grant'
            ? submitInternalMastodonPassword()
            : submitInternalPassword())}
          onMfaSubmit={() => void submitInternalMfa()}
          onMfaCancel={() => { setMfa(null); setMfaCode(''); setError(null) }}
          onOAuth={() => void submitInternalOAuth()}
        />
      ) : (
        <View style={[atoms.gap_sm]}>
          <TextField
            label={i18n._(msg`Server`)}
            value={server}
            onChangeText={text => {
              setServer(text)
              setDetection(null)
            }}
            placeholder={i18n._(msg`example.social`)}
            testID="login-server"
          />
          <Button
            label={detecting ? i18n._(msg`Checking…`) : i18n._(msg`Continue`)}
            testID="login-continue"
            onPress={() => void detect()}
          />
          {detection ? (
            <Caption color="faint" testID="login-detection">
              {detection.origin} · {detection.flavor}
            </Caption>
          ) : null}
          {detection?.family === 'misskey' && !miauth ? (
            <View style={[atoms.gap_sm]}>
              <Body>{i18n._(msg`Browser sign-in — approve on ${detection.origin}.`)}</Body>
              <Button
                label={busy ? i18n._(msg`Opening…`) : i18n._(msg`Sign in with browser`)}
                testID="login-miauth"
                disabled={busy}
                disabledReason={i18n._(msg`Opening the approval page.`)}
                onPress={() => void submitMiAuth(null)}
              />
            </View>
          ) : null}
          {detection?.family === 'misskey' && miauth ? (
            <View style={[atoms.gap_sm]}>
              <Body>{i18n._(msg`Approve on ${detection.origin}, then continue here.`)}</Body>
              {miauthStatus ? <Caption color="faint">{miauthStatus}</Caption> : null}
              <Button
                label={busy ? i18n._(msg`Checking…`) : i18n._(msg`I\'ve approved — continue`)}
                testID="login-miauth-confirm"
                onPress={() => void submitMiAuth(miauth, 5)}
              />
              <Button label={i18n._(msg`Cancel`)} variant="secondary" onPress={cancelMiAuth} />
            </View>
          ) : null}
          {detection?.family === 'mastodon' && !mfa ? (
            <View style={[atoms.gap_sm]}>
              {detection.features.password_grant !== 'unsupported' ? (
                <View style={[atoms.gap_sm]}>
                  <TextField label={i18n._(msg`Username`)} value={username} onChangeText={setUsername} testID="login-username" />
                  <TextField label={i18n._(msg`Password`)} value={password} onChangeText={setPassword} secure testID="login-password" />
                  <Button
                    label={busy ? i18n._(msg`Signing in…`) : i18n._(msg`Sign in`)}
                    testID="login-submit"
                    disabled={busy || passwordGate !== null}
                    disabledReason={passwordGate ?? undefined}
                    onPress={() => void submitExternalMastodonPassword()}
                  />
                </View>
              ) : null}
              <Button
                label={busy ? i18n._(msg`Opening…`) : i18n._(msg`Sign in with browser`)}
                variant="secondary"
                testID="login-oauth"
                disabled={busy || pkceGate !== null}
                disabledReason={pkceGate ?? undefined}
                onPress={() => void submitExternalOAuth()}
              />
            </View>
          ) : null}
          {detection?.family === 'mastodon' && mfa ? (
            <View style={[atoms.gap_sm]}>
              <Body>{i18n._(msg`Two-factor code (${mfa.challengeTypes[0] ?? 'totp'})`)}</Body>
              <TextField label={i18n._(msg`Code`)} value={mfaCode} onChangeText={setMfaCode} testID="login-mfa-code" />
              <Button
                label={busy ? i18n._(msg`Verifying…`) : i18n._(msg`Verify`)}
                testID="login-mfa-submit"
                onPress={() => void submitExternalMfa()}
              />
              <Button
                label={i18n._(msg`Cancel`)}
                variant="secondary"
                onPress={() => {
                  setMfa(null)
                  setMfaCode('')
                }}
              />
            </View>
          ) : null}
          {error ? (
            <Caption testID="login-error">{error}</Caption>
          ) : null}
        </View>
      )}
    </View>
  )
}

function InternalForm(props: {
  kind: InternalKind | null
  serverName: string
  username: string
  password: string
  busy: boolean
  mfa: {mfaToken: string; challengeTypes: string[]} | null
  mfaCode: string
  error: string | null
  onUsername: (v: string) => void
  onPassword: (v: string) => void
  onMfaCode: (v: string) => void
  onPasswordSubmit: () => void
  onMfaSubmit: () => void
  onMfaCancel: () => void
  onOAuth: () => void
}) {
  if (!props.kind) {
    return (
      <Caption testID="login-error">
        {i18n._(msg`This server could not be identified. Try another server.`)}
      </Caption>
    )
  }
  if (props.kind === 'mastodon-pkce' && !props.mfa) {
    return (
      <View style={[atoms.gap_sm]}>
        <Body>{i18n._(msg`Sign in with ${props.serverName} in the browser.`)}</Body>
        <Button
          label={props.busy ? i18n._(msg`Opening…`) : i18n._(msg`Continue`)}
          testID="login-submit"
          disabled={props.busy}
          disabledReason={i18n._(msg`Opening the approval page.`)}
          onPress={props.onOAuth}
        />
        {props.error ? <Caption testID="login-error">{props.error}</Caption> : null}
      </View>
    )
  }
  if (props.mfa) {
    return (
      <View style={[atoms.gap_sm]}>
        <Body>{i18n._(msg`Two-factor code (${props.mfa.challengeTypes[0] ?? 'totp'})`)}</Body>
        <TextField label={i18n._(msg`Code`)} value={props.mfaCode} onChangeText={props.onMfaCode} testID="login-mfa-code" />
        <Button
          label={props.busy ? i18n._(msg`Verifying…`) : i18n._(msg`Verify`)}
          testID="login-mfa-submit"
          onPress={props.onMfaSubmit}
        />
        <Button label={i18n._(msg`Cancel`)} variant="secondary" onPress={props.onMfaCancel} />
        {props.error ? <Caption testID="login-error">{props.error}</Caption> : null}
      </View>
    )
  }
  return (
    <View style={[atoms.gap_sm]}>
      <Body>{i18n._(msg`Sign in with your ${props.serverName} account.`)}</Body>
      <TextField label={i18n._(msg`Username`)} value={props.username} onChangeText={props.onUsername} testID="login-username" />
      <TextField label={i18n._(msg`Password`)} value={props.password} onChangeText={props.onPassword} secure testID="login-password" />
      <Button
        label={props.busy ? i18n._(msg`Signing in…`) : i18n._(msg`Sign in`)}
        testID="login-submit"
        disabled={props.busy}
        disabledReason={i18n._(msg`Signing in.`)}
        onPress={props.onPasswordSubmit}
      />
      {props.error ? <Caption testID="login-error">{props.error}</Caption> : null}
    </View>
  )
}
