import {createContext, useContext, useMemo, type PropsWithChildren} from 'react'
import {useColorScheme} from 'react-native'

import {themes, type Theme, type ThemeName} from '#/alf/themes'

export type {Theme, ThemeName}

const AlfContext = createContext<{themeName: ThemeName; theme: Theme}>({
  themeName: 'light',
  theme: themes.light,
})
AlfContext.displayName = 'AlfContext'

/**
 * Provides the Keystone theme. `theme` defaults to the OS colour scheme
 * (`system`), matching the old Keystone rule: light default, dark
 * follows the system. An explicit `'light' | 'dark'` always wins;
 * a stored Appearance override will plug in here (plan 6.x).
 */
export function ThemeProvider({
  children,
  theme,
}: PropsWithChildren<{theme?: ThemeName | 'system'}>) {
  const system = useColorScheme()
  const themeName: ThemeName =
    theme === 'light' || theme === 'dark'
      ? theme
      : system === 'dark'
        ? 'dark'
        : 'light'
  const value = useMemo(
    () => ({themeName, theme: themes[themeName]}),
    [themeName],
  )
  return <AlfContext.Provider value={value}>{children}</AlfContext.Provider>
}

export function useTheme(): Theme {
  return useContext(AlfContext).theme
}

export function useThemeName(): ThemeName {
  return useContext(AlfContext).themeName
}
