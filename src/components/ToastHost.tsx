import {useEffect, useSyncExternalStore} from 'react'
import {StyleSheet, View} from 'react-native'

import {dismissToast, toastStore} from '#/lib/toast'

import {Toast} from './Toast'

const TOAST_MS = 4000
const styles = StyleSheet.create({
  host: {position: 'absolute', left: 16, right: 16, bottom: 24, alignItems: 'center'},
})

// Mount once near the app root. Shows the oldest queued toast, then the next.
export function ToastHost() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot)
  const head = items[0]
  useEffect(() => {
    if (!head) return
    const t = setTimeout(() => dismissToast(head.id), TOAST_MS)
    return () => clearTimeout(t)
  }, [head])
  if (!head) return null
  return (
    <View style={styles.host} pointerEvents="none" testID="toast-host">
      <Toast message={head.message} testID={`toast-${head.id}`} />
    </View>
  )
}
