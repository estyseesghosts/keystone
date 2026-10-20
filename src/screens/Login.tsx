import {useState} from 'react'
import {Platform, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'

import {
  detectServer,
  MfaRequiredError,
  type Account,
  type Capabilities,
  type ServerFamily,
  type ServerFlavor,
  type SessionGrant,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {AccountSwitcher} from '#/components/AccountSwitcher'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import type {RootParamList} from '#/routes'
import {useSessionStore} from '#/state/session/SessionProvider'
import {appStorage} from '#/storage'

import {
  getWebOrigin,
  mastodonMfaSignin,
  mastodonPasswordSignin,
  misskeyPasswordSignin,
  normalizeServerInput,
  startMastodonOAuth,
} from './LoginFlows'

// Complete the iOS auth session when the app returns from the browser.
void WebBrowser.maybeCompleteAuthSession()

interface Detection {
  origin: string
  family: ServerFamily
  flavor: ServerFlavor
  features: Capabilities
}

function redirectUriFor(): string {
  if (Platform.OS === 'web') {
    return `${getWebOrigin() ?? ''}/auth/callback`
  }
  return Linking.createURL('auth/callback')
}

async function openBrowser(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    const loc = (globalThis as {location?: {assign?: (url: string) => void}}).location
    loc?.assign?.(url)
    return
  }
  await WebBrowser.openAuthSessionAsync(url, redirectUriFor())
}

function gateMessage(value: string | undefined, action: string): string | null {
  if (value === 'supported') return null
  if (value === 'unsupported') return `This server does not support ${action}.`
  return `Unknown whether this server supports ${action}.`
}

export function LoginScreen() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const store = useSessionStore()
  const [server, setServer] = useState('')
  const [detection, setDetection] = useState<Detection | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mfa, setMfa] = useState<{mfaToken: string; challengeTypes: string[]} | null>(null)
  const [mfaCode, setMfaCode] = useState('')

  const fail = (err: unknown) => {
    setError(err instanceof Error ? err.message : 'Sign-in failed.')
  }

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
      setDetection({origin, family: found.family, flavor: found.flavor, features: found.features})
    } catch (err) {
      fail(err)
    } finally {
      setDetecting(false)
    }
  }

  const finish = async (result: {
    origin: string
    family: ServerFamily
    flavor: ServerFlavor
    token: string
    account: Account
    grant: SessionGrant
  }) => {
    await store.add({
      origin: result.origin,
      family: result.family,
      flavor: result.flavor,
      accountId: result.account.id,
      token: result.token,
      grant: result.grant,
      hosting: 'third-party',
      user: result.account,
    })
    nav.navigate('Home')
  }

  const submitMisskey = async () => {
    if (!detection) return
    setBusy(true)
    setError(null)
    try {
      const res = await misskeyPasswordSignin({
        origin: detection.origin,
        flavor: detection.flavor,
        username,
        password,
      })
      await finish({origin: detection.origin, family: 'misskey', flavor: detection.flavor, token: res.token, account: res.account, grant: res.grant})
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const submitMastodonPassword = async () => {
    if (!detection) return
    setBusy(true)
    setError(null)
    try {
      const res = await mastodonPasswordSignin({
        appStore: appStorage(),
        origin: detection.origin,
        redirectUri: redirectUriFor(),
        username,
        password,
      })
      await finish({origin: detection.origin, family: 'mastodon', flavor: detection.flavor, token: res.token, account: res.account, grant: res.grant})
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

  const submitMfa = async () => {
    if (!detection || !mfa) return
    setBusy(true)
    setError(null)
    try {
      const res = await mastodonMfaSignin({
        appStore: appStorage(),
        origin: detection.origin,
        redirectUri: redirectUriFor(),
        mfaToken: mfa.mfaToken,
        challengeType: mfa.challengeTypes[0] ?? 'totp',
        code: mfaCode,
      })
      await finish({origin: detection.origin, family: 'mastodon', flavor: detection.flavor, token: res.token, account: res.account, grant: res.grant})
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const submitOAuth = async () => {
    if (!detection) return
    setBusy(true)
    setError(null)
    try {
      await startMastodonOAuth({
        appStore: appStorage(),
        origin: detection.origin,
        redirectUri: redirectUriFor(),
        openBrowser,
      })
      // The callback screen completes the flow (AuthCallback).
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const passwordGate = detection ? gateMessage(detection.features.password_grant, 'password sign-in') : null
  const pkceGate = detection ? gateMessage(detection.features.pkce, 'browser sign-in') : null

  return (
    <View style={[atoms.flex1, atoms.p_md, atoms.gap_md]}>
      <Heading>Sign in</Heading>
      <AccountSwitcher onAddAccount={() => setDetection(null)} />
      <TextField
        label="Server"
        value={server}
        onChangeText={text => {
          setServer(text)
          setDetection(null)
        }}
        placeholder="example.social"
        testID="login-server"
      />
      <Button
        label={detecting ? 'Checking…' : 'Continue'}
        testID="login-continue"
        onPress={() => void detect()}
      />
      {detection ? (
        <Caption color="faint" testID="login-detection">
          {detection.origin} · {detection.flavor}
        </Caption>
      ) : null}
      {detection?.family === 'misskey' ? (
        <View style={[atoms.gap_sm]}>
          <TextField label="Username" value={username} onChangeText={setUsername} testID="login-username" />
          <TextField label="Password" value={password} onChangeText={setPassword} secure testID="login-password" />
          <Button
            label={busy ? 'Signing in…' : 'Sign in'}
            testID="login-submit"
            disabled={busy || passwordGate !== null}
            disabledReason={passwordGate ?? undefined}
            onPress={() => void submitMisskey()}
          />
        </View>
      ) : null}
      {detection?.family === 'mastodon' && !mfa ? (
        <View style={[atoms.gap_sm]}>
          {detection.features.password_grant !== 'unsupported' ? (
            <View style={[atoms.gap_sm]}>
              <TextField label="Username" value={username} onChangeText={setUsername} testID="login-username" />
              <TextField label="Password" value={password} onChangeText={setPassword} secure testID="login-password" />
              <Button
                label={busy ? 'Signing in…' : 'Sign in'}
                testID="login-submit"
                disabled={busy || passwordGate !== null}
                disabledReason={passwordGate ?? undefined}
                onPress={() => void submitMastodonPassword()}
              />
            </View>
          ) : null}
          <Button
            label={busy ? 'Opening…' : 'Sign in with browser'}
            variant="secondary"
            testID="login-oauth"
            disabled={busy || pkceGate !== null}
            disabledReason={pkceGate ?? undefined}
            onPress={() => void submitOAuth()}
          />
        </View>
      ) : null}
      {detection?.family === 'mastodon' && mfa ? (
        <View style={[atoms.gap_sm]}>
          <Body>Two-factor code ({mfa.challengeTypes[0] ?? 'totp'})</Body>
          <TextField label="Code" value={mfaCode} onChangeText={setMfaCode} testID="login-mfa-code" />
          <Button
            label={busy ? 'Verifying…' : 'Verify'}
            testID="login-mfa-submit"
            onPress={() => void submitMfa()}
          />
          <Button
            label="Cancel"
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
  )
}
