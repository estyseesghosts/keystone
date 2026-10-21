import {useEffect} from 'react'
import {Platform, StatusBar, type StatusBarStyle} from 'react-native'
import * as SystemUI from 'expo-system-ui'

import {useTheme} from '#/alf/index'

// Single system-UI owner (W6 P11): the ONLY importer of `expo-system-ui` in
// the tree (grep `expo-system-ui` must show just this file). Status-bar style
// + the native root-view background follow the alf theme name, so the OS
// chrome (status bar, overscroll/snapshot paint, Android nav gap) never
// flashes the opposite theme. Called exactly once, from Root's
// ThemedProviders (inside ThemeProvider, where `useTheme` resolves).
// Web is guarded: no native module there, the DOM paints its own chrome.
export function useSystemUI(): {backgroundColor: string; barStyle: StatusBarStyle} {
  const theme = useTheme()
  const backgroundColor = theme.palette.bg
  const barStyle: StatusBarStyle = theme.name === 'dark' ? 'light-content' : 'dark-content'
  useEffect(() => {
    StatusBar.setBarStyle(barStyle, true)
    if (Platform.OS === 'android') {
      StatusBar.setBackgroundColor(backgroundColor, true)
    }
    if (Platform.OS !== 'web') {
      void SystemUI.setBackgroundColorAsync(backgroundColor).catch(() => {
        // Best-effort root paint; the app stays correct without it.
      })
    }
  }, [backgroundColor, barStyle])
  return {backgroundColor, barStyle}
}
