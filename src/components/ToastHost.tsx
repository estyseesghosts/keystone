import {useEffect, useState, useSyncExternalStore} from 'react'
import {Pressable, StyleSheet, View} from 'react-native'
import {useLingui} from '@lingui/react'
import {msg} from '@lingui/macro'

import {useShellLayout} from '#/alf/breakpoints'
import {useOptionalSafeAreaInsets} from '#/components/insets'
import {dismissToast, toastStore} from '#/lib/toast'

import {SHELL_TAB_BAR_HEIGHT} from './shell/TabBar'
import {Toast} from './Toast'

const TOAST_MS = 4000
// Breathing gap between the toast and the mobile tab bar (the bar's 72px
// chrome + this gap = the shell's 88px FAB clearance language). Desktop
// shells have no tab bar, so the toast keeps its historic float margin.
const TOAST_ABOVE_BAR_GAP = 16
const TOAST_DESKTOP_BOTTOM = 24
const styles = StyleSheet.create({
  host: {position: 'absolute', start: 16, end: 16, alignItems: 'center'},
})

// Mount once near the app root. Shows the oldest queued toast, then the next.
// Floats above the mobile tab bar (safe-area inset + bar height, rn-ui M4),
// pauses its auto-dismiss while hovered/focused, and dismisses on tap.
// (Live-region announcement is X10.1 — not added here.)
export function ToastHost() {
  const {i18n} = useLingui()
  const layout = useShellLayout()
  const insets = useOptionalSafeAreaInsets()
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot)
  const head = items[0]
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (!head || paused) return
    const t = setTimeout(() => dismissToast(head.id), TOAST_MS)
    return () => clearTimeout(t)
  }, [head, paused])
  if (!head) return null
  const bottom =
    insets.bottom + (layout === 'mobile' ? SHELL_TAB_BAR_HEIGHT + TOAST_ABOVE_BAR_GAP : TOAST_DESKTOP_BOTTOM)
  return (
    <View style={[styles.host, {bottom}]} pointerEvents="box-none" testID="toast-host">
      <Pressable
        onPress={() => dismissToast(head.id)}
        onHoverIn={() => setPaused(true)}
        onHoverOut={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        accessibilityRole="button"
        accessibilityLabel={i18n._(msg`Dismiss notification`)}
        testID={`toast-dismiss-${head.id}`}>
        <Toast message={head.message} testID={`toast-${head.id}`} />
      </Pressable>
    </View>
  )
}
