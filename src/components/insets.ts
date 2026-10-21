import {useContext} from 'react'
import {SafeAreaInsetsContext, type EdgeInsets} from 'react-native-safe-area-context'

// Provider-optional insets (N21). `useSafeAreaInsets()` throws on bare
// trees (provider-less tests); the chrome components must stay renderable
// there, so they read the context directly and fall back to zeros. Inside
// the app Root.tsx always mounts SafeAreaProvider, so production insets
// still flow through.
export const ZERO_INSETS: EdgeInsets = {top: 0, bottom: 0, left: 0, right: 0}

export function useOptionalSafeAreaInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO_INSETS
}
