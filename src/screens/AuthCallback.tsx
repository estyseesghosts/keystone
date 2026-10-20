import {useEffect, useRef, useState} from 'react'
import {Platform, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'
import * as Linking from 'expo-linking'

import {detectServer, type ServerFlavor} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import type {RootParamList} from '#/routes'
import {useSessionStore} from '#/state/session/SessionProvider'
import {appStorage} from '#/storage'

import {completeMastodonOAuth} from './LoginFlows'

// OAuth callback (slice 3.1): the browser returns here with `?code&state`
// (web: same-tab `/auth/callback`; native: the `keystone:` scheme deep link).
// The pending flow is read AND deleted exactly once (replay guard); the token
// is verified BEFORE it is stored. Nothing here trusts the URL beyond the
// one-time code/state pair.

function callbackParams(): {code: string | null; state: string | null; error: string | null} {
  const href =
    Platform.OS === 'web'
      ? (globalThis as {location?: {href?: string}}).location?.href ?? null
      : Linking.createURL('')
  // Native deep links arrive through `useURL` (see below); this helper only
  // covers the web same-tab return.
  if (Platform.OS !== 'web' || !href) return {code: null, state: null, error: null}
  let params: URLSearchParams
  try {
    params = new URL(href).searchParams
  } catch {
    return {code: null, state: null, error: null}
  }
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
  }
}

function stripWebCallback(): void {
  if (Platform.OS !== 'web') return
  try {
    const history = (globalThis as {history?: {replaceState: (...args: unknown[]) => void}}).history
    const loc = (globalThis as {location?: {pathname?: string}}).location
    history?.replaceState(null, '', loc?.pathname ?? '/auth/callback')
  } catch {
    // Cosmetic only: the code is single-use server-side regardless.
  }
}

export function AuthCallbackScreen() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const store = useSessionStore()
  const nativeUrl = Platform.OS === 'web' ? null : Linking.useURL()
  const [status, setStatus] = useState<'working' | 'error'>('working')
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    // Native arrives via the deep link: wait for it instead of failing on
    // the first render. (Manual visits with no link wait here; the screen
    // is deep-link-only.)
    if (Platform.OS !== 'web' && !nativeUrl) return
    ran.current = true
    const run = async () => {
      let params = callbackParams()
      if (Platform.OS !== 'web' && nativeUrl) {
        try {
          const parsed = new URL(nativeUrl)
          params = {
            code: parsed.searchParams.get('code'),
            state: parsed.searchParams.get('state'),
            error: parsed.searchParams.get('error'),
          }
        } catch {
          // Fall through to the missing-params error below.
        }
      }
      if (params.error) {
        setError('The sign-in was cancelled or denied.')
        setStatus('error')
        return
      }
      if (!params.code || !params.state) {
        setError('This link has no sign-in response. Start again from Sign in.')
        setStatus('error')
        return
      }
      try {
        const done = await completeMastodonOAuth({
          appStore: appStorage(),
          code: params.code,
          state: params.state,
        })
        if (!done) {
          setError('This sign-in link already ran or expired. Please sign in again.')
          setStatus('error')
          return
        }
        let flavor: ServerFlavor = 'unknown'
        try {
          const found = await detectServer(done.origin)
          if (found.family === 'mastodon') flavor = found.flavor
        } catch {
          // Flavor refines later; the verified session stores regardless.
        }
        await store.add({
          origin: done.origin,
          family: 'mastodon',
          flavor,
          accountId: done.account.id,
          token: done.token,
          grant: 'oauth-pkce',
          hosting: 'third-party',
          user: done.account,
        })
        stripWebCallback()
        nav.navigate('Home')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sign-in failed.')
        setStatus('error')
      }
    }
    void run()
  }, [nav, nativeUrl, store])

  return (
    <View style={[atoms.flex1, atoms.centered, atoms.gap_md, atoms.p_md]}>
      <Heading>Finishing sign-in</Heading>
      {status === 'working' ? <Body>Verifying with your server…</Body> : null}
      {error ? <Caption testID="callback-error">{error}</Caption> : null}
      {status === 'error' ? (
        <Button label="Back to sign in" variant="secondary" onPress={() => nav.navigate('Login')} />
      ) : null}
    </View>
  )
}
