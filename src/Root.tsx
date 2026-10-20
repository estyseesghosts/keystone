import {useEffect, useMemo, useState} from 'react'

import {I18nProvider} from '@lingui/react'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {Navigation} from '#/Navigation'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {appStorage, appTokenVault} from '#/storage'

// App root: providers + navigation. Shared by native and web entries;
// platform divergences (if any) land in App.web.tsx.
//
// Session boot (slice 3.1): one store for the tree, `initialize()` +
// `hydrate()` exactly once, navigation gated until the vault read settles
// so the first render never flashes a signed-out shell over sessions.

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
  useEffect(() => {
    store.initialize()
    void store.hydrate().finally(() => setReady(true))
  }, [store])
  return (
    <I18nProvider i18n={i18n}>
      <ThemeProvider>
        <SessionProvider store={store} homeOrigin={homeOrigin}>
          {ready ? <Navigation /> : null}
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
