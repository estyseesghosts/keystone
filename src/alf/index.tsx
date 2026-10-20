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
 * the stored Display colour-mode override plugs in here. `fontScale`
 * multiplies prose type (the Display text-size setting); defaults to 1.
 */
export function ThemeProvider({
  children,
  theme,
  fontScale = 1,
}: PropsWithChildren<{theme?: ThemeName | 'system'; fontScale?: number}>) {
  const system = useColorScheme()
  const themeName: ThemeName =
    theme === 'light' || theme === 'dark'
      ? theme
      : system === 'dark'
        ? 'dark'
        : 'light'
  const value = useMemo(
    () => ({themeName, theme: {...themes[themeName], fontScaleMultiplier: fontScale}}),
    [themeName, fontScale],
  )
  return <AlfContext.Provider value={value}>{children}</AlfContext.Provider>
}

export function useTheme(): Theme {
  return useContext(AlfContext).theme
}

export function useThemeName(): ThemeName {
  return useContext(AlfContext).themeName
}
