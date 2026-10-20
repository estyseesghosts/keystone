import {useEffect, useMemo, useState} from 'react'

import {I18nProvider} from '@lingui/react'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {ToastHost} from '#/components/ToastHost'
import {Navigation} from '#/Navigation'
import type {HostingResolution} from '@keystone/fedi'
import {HostingProvider, resolveAppHosting} from '#/state/hosting'
import {QueryProvider} from '#/state/queries'
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
    <I18nProvider i18n={i18n}>
      <ThemeProvider>
        <SessionProvider store={store} homeOrigin={homeOrigin}>
          <HostingProvider value={hosting}>
            <QueryProvider>{ready ? <Navigation /> : null}</QueryProvider>
          </HostingProvider>
          <ToastHost />
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
