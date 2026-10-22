import {StyleSheet, View} from 'react-native'

import {msg} from '@lingui/macro'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {i18n} from '#/locale/i18n'
import {navigationRef} from '#/navigationRef'
import {useOptionalActiveSession, useScopeHealth} from '#/state/session/SessionProvider'

// 0.8 — global permission/scope upgrade prompt.
//
// `scopeHealth` is the ONE answer to "can this session do what this build
// does?". The shell reads it for the active session and shows this banner
// when `needsUpgrade` is true, so a refusal is never trapped in the screen
// that happened to make the call (the pre-0.8 bug: a Misskey 403 only
// rendered a local `denied` state in Clips/Drive/Following/…).
//
// Honest by construction: it names no scope on the Misskey family (the
// server never returned a scope list; `missingScopes` is empty), it never
// clears or revokes the session, and the action is the existing Login
// screen prefilled with this session's origin — a fresh sign-in replaces
// the token and clears the marker in the store. No new route.
export function ScopeUpgradeBanner() {
  const health = useScopeHealth()
  const session = useOptionalActiveSession()
  const theme = useTheme()

  if (!session || !health?.needsUpgrade) return null

  const misskey = session.family === 'misskey'
  const title = misskey
    ? i18n._(msg`This sign-in predates a permission Keystone now uses.`)
    : i18n._(msg`This sign-in is missing permissions Keystone uses.`)
  const detail = misskey
    ? i18n._(msg`Sign in again to grant it. Everything this sign-in can already do keeps working.`)
    : i18n._(msg`Sign in again to refresh this account's permissions.`)

  const styles = StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: theme.palette.raise,
      borderBottomWidth: 1,
      borderBottomColor: theme.palette.edge,
    },
    copy: {flex: 1, gap: 2},
  })

  return (
    <View testID="scope-upgrade-banner" accessibilityRole="alert" style={styles.banner}>
      <View style={styles.copy}>
        <Body>{title}</Body>
        <Caption color="muted">{detail}</Caption>
      </View>
      {/* No inert control: the action exists only when the root navigator
          is mounted (it is the shell's parent). It opens the existing
          Login screen with this origin prefilled — never a dead press. */}
      {navigationRef.isReady() ? (
        <Button
          testID="scope-upgrade-signin"
          label={i18n._(msg`Sign in again`)}
          variant="secondary"
          onPress={() => navigationRef.navigate('Login', {origin: session.origin})}
        />
      ) : null}
    </View>
  )
}
