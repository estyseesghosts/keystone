import {useEffect, useMemo, useState} from 'react'

import {I18nProvider} from '@lingui/react'
import {SafeAreaProvider} from 'react-native-safe-area-context'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {useColorMode, useTextScale} from '#/state/appearance'
import {ToastHost} from '#/components/ToastHost'
import {Navigation} from '#/Navigation'
import type {HostingResolution} from '@keystone/fedi'
import {HostingProvider, resolveAppHosting} from '#/state/hosting'
import {QueryProvider} from '#/state/queries'
import {useSystemUI} from '#/state/systemUI'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {appStorage, appTokenVault} from '#/storage'

// App root: providers + navigation. Shared by native and web entries;
// platform divergences (if any) land in App.web.tsx.
//
// Session boot (slice 3.1): one store for the tree, `initialize()` +
// `hydrate()` exactly once, navigation gated until the vault read settles
// so the first render never flashes a signed-out shell over sessions.
//
// Hosting boot: the runtime `keystone.config.json` + same-origin probe
// resolve first-party vs third-party before navigation mounts, so Login
// knows whether this origin IS a home server. The gate waits for both boot
// legs; a hosting failure resolves third-party (never a boot error).

function getHomeOrigin(): string {
  const loc = (globalThis as {location?: {origin?: unknown}}).location
  if (typeof loc?.origin === 'string' && loc.origin.startsWith('http')) {
    return loc.origin
  }
  return 'keystone://app'
}

export function Root() {
  const homeOrigin = useMemo(getHomeOrigin, [])
  const store = useMemo(
    () =>
      createSessionStore({
        storage: appStorage(),
        vault: appTokenVault(),
        homeOrigin,
      }),
    [homeOrigin],
  )
  const [ready, setReady] = useState(false)
  const [hosting, setHosting] = useState<HostingResolution | null>(null)
  useEffect(() => {
    let cancelled = false
    store.initialize()
    const boot = async () => {
      try {
        const resolved = await resolveAppHosting(homeOrigin)
        if (!cancelled) setHosting(resolved)
      } catch {
        if (!cancelled) setHosting(null)
      }
      try {
        await store.hydrate()
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [store, homeOrigin])
  return (
    // SafeAreaProvider sits outside everything (N21): insets must reach
    // every shell layer — strip, tab bar, FAB, Lightbox, Toast — and none
    // of them may own a nested provider.
    <SafeAreaProvider>
      <I18nProvider i18n={i18n}>
        <ThemedProviders store={store} homeOrigin={homeOrigin} ready={ready} hosting={hosting} />
      </I18nProvider>
    </SafeAreaProvider>
  )
}

// Display settings (Settings → Display) plug into the theme here: the
// stored colour mode picks light/dark/system, the stored text scale
// multiplies prose type. Both are device-global and reactive.
// System-UI binder: `useSystemUI` needs the alf theme, so it mounts here,
// first child of ThemeProvider, called exactly once for the tree (P11).
function SystemUIBinder() {
  useSystemUI()
  return null
}

function ThemedProviders({
  store,
  homeOrigin,
  ready,
  hosting,
}: {
  store: ReturnType<typeof createSessionStore>
  homeOrigin: string
  ready: boolean
  hosting: HostingResolution | null
}) {
  const colorMode = useColorMode()
  const textScale = useTextScale()
  return (
    <ThemeProvider theme={colorMode === 'system' ? undefined : colorMode} fontScale={textScale}>
      <SystemUIBinder />
      <SessionProvider store={store} homeOrigin={homeOrigin}>
        <HostingProvider value={hosting}>
          <QueryProvider>{ready ? <Navigation /> : null}</QueryProvider>
        </HostingProvider>
        <ToastHost />
      </SessionProvider>
    </ThemeProvider>
  )
}
