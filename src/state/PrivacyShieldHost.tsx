import {useEffect, useState} from 'react'
import {AppState, StyleSheet, View} from 'react-native'

import {msg} from '@lingui/macro'

import {useTheme} from '#/alf/index'
import {Body} from '#/alf/typography'
import {i18n} from '#/locale/i18n'

import {
  privacyStore,
  shieldVisible,
  useConversationShield,
  usePrivacyShield,
  type PrivacyStore,
} from './privacyShield'

// Privacy-shield host (repair X2.5): an opaque, blur-free, branded
// cover that draws over the whole app when it should not be snapshotted
// — while a DM/chat/conversation screen is focused (forced by the
// screen, regardless of pref), otherwise when the user opted in AND the
// app goes `inactive`/`background` (the OS task-switcher snapshot).
// Mount once near the root (above the navigator). Renders nothing when
// the shield is off — never an inert overlay.

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    end: 0,
    bottom: 0,
    start: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

export function PrivacyShieldHost({store = privacyStore}: {store?: PrivacyStore}) {
  const theme = useTheme()
  const enabled = usePrivacyShield(store)
  const forced = useConversationShield()
  const [appState, setAppState] = useState(() => AppState.currentState)
  useEffect(() => {
    const sub = AppState.addEventListener('change', setAppState)
    return () => sub.remove()
  }, [])
  if (!shieldVisible({prefEnabled: enabled, forced, appState})) return null
  return (
    <View style={[styles.cover, {backgroundColor: theme.palette.bg}]} testID="privacy-shield">
      <Body>{i18n._(msg`Keystone`)}</Body>
    </View>
  )
}
