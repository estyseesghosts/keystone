import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import {
  getHosting,
  loadRuntimeConfig,
  onHostingChange,
  resolveHosting,
  setHosting as setHostingState,
  type HostingResolution,
} from '@keystone/fedi'

// Hosting bridge (first-party vs third-party): the fedi singleton owns the
// resolution (`core/hosting`); this module exposes it to React and runs the
// boot probe. One dist for every deployment — mode resolves at runtime from
// `keystone.config.json` plus a same-origin probe, never at build time.

const HostingContext = createContext<HostingResolution | null | undefined>(
  undefined,
)

export function useHosting(): HostingResolution | null {
  const fromContext = useContext(HostingContext)
  // Outside the provider (presentational trees, bare tests) fall back to the
  // module value at render time — never a crash, never a stale claim.
  const [fromModule, setFromModule] = useState(() => getHosting())
  useEffect(() => onHostingChange(setFromModule), [])
  if (fromContext !== undefined) return fromContext
  return fromModule
}

/** Boot probe: config file, then hosting resolution against `origin`. Never throws. */
export async function resolveAppHosting(
  origin: string,
): Promise<HostingResolution> {
  const config = await loadRuntimeConfig()
  const resolution = await resolveHosting(config, {origin})
  setHostingState(resolution)
  return resolution
}

export function HostingProvider({
  value,
  children,
}: {
  value: HostingResolution | null
  children: ReactNode
}) {
  return (
    <HostingContext.Provider value={value}>{children}</HostingContext.Provider>
  )
}
