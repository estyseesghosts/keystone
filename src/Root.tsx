import {useCallback, useEffect, useMemo, useState} from 'react'
import {View} from 'react-native'

import {I18nProvider, useLingui} from '@lingui/react'
import {msg} from '@lingui/macro'
import {SafeAreaProvider} from 'react-native-safe-area-context'

import {ThemeProvider} from '#/alf/index'
import {Body} from '#/alf/typography'
import {ErrorBoundary} from '#/components/ErrorBoundary'
import {Loader} from '#/components/Loader'
import {installGlobalErrorHandlers} from '#/lib/logger'
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
  // Repair X8.1: last-resort capture — `ErrorUtils` fatals and web
  // `unhandledrejection`s forward to the logger (redacted). The root
  // boundary below renders the recover UI. Nothing else in this file
  // changes (X3.5 owns the rest).
  useEffect(() => installGlobalErrorHandlers(), [])
  const handleRootSignOut = useCallback(() => {
    void store.signOutEverywhere()
  }, [store])
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
        // MD5: re-verify the restored token before the first render — a
        // dead (401) token drops here so the shell opens signed-out (the
        // honest re-auth prompt) instead of looking signed in until a
        // 401. 403/network never clear (see store.verifyActive).
        await store.verifyActive()
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
    // of them may own a nested provider. `initialMetrics` is the zero
    // fallback: bare trees (jest, no native module) render immediately
    // instead of waiting on inset events; on device the live insets
    // replace these on the first native pass.
    <SafeAreaProvider
      initialMetrics={{
        frame: {x: 0, y: 0, width: 0, height: 0},
        insets: {top: 0, bottom: 0, left: 0, right: 0},
      }}>
      <I18nProvider i18n={i18n}>
        {/* Root boundary (repair X8.1, rn-ui M1): inside `I18nProvider`
            so the crash UI is translated, outside the session/query
            providers so their own crashes are caught too. */}
        <ErrorBoundary variant="root" context="root" onSignOut={handleRootSignOut}>
          <ThemedProviders store={store} homeOrigin={homeOrigin} ready={ready} hosting={hosting} />
        </ErrorBoundary>
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

// Boot splash (repair X3.5): the boot legs are capped, but even a capped
// boot takes time on a bad network — render a translated loader instead of
// a blank screen, with a "taking longer" line after 3 s. New UI strings go
// through Lingui `msg` only.
export function BootSplash() {
  const {i18n} = useLingui()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 3000)
    return () => clearTimeout(timer)
  }, [])
  return (
    <View
      accessible
      accessibilityLabel={i18n._(msg`Loading Keystone`)}
      testID="boot-loading"
      style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
      <Loader testID="boot-loading-indicator" />
      {slow ? <Body>{i18n._(msg`Taking longer than usual. Check your connection.`)}</Body> : null}
    </View>
  )
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
          <QueryProvider>{ready ? <Navigation /> : <BootSplash />}</QueryProvider>
        </HostingProvider>
        <ToastHost />
      </SessionProvider>
    </ThemeProvider>
  )
}
