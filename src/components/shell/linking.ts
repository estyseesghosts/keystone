import {
  getStateFromPath as defaultGetStateFromPath,
  type LinkingOptions,
} from '@react-navigation/native'
import * as Linking from 'expo-linking'

import {
  isAuthCallbackPath,
  linkingScreens,
  rewriteLegacyPath,
  type RootParamList,
} from '#/routes'

export type StackParamList = RootParamList & {Main: undefined}

// Deep-link table. Derived from the canonical `paths` in `#/routes`
// (which documents Keystone's web URLs) — this is the shape
// react-navigation consumes. The Login tab is intentionally absent here:
// `/login` maps to the stack screen, tab presses navigate by name.
// Legacy URLs (`/local`, `/social`, `/global`, `/search`) rewrite to
// their canonical targets before the default parser runs.
export const linking: LinkingOptions<StackParamList> = {
  prefixes: [Linking.createURL('/')],
  config: {
    screens: linkingScreens(),
  },
  getStateFromPath: (path, options) =>
    defaultGetStateFromPath(rewriteLegacyPath(path), options),
}

// --- Base-path hosting (N13) -------------------------------------------------
// `HostingResolution.basePath` is the router namespace (`/.../` form, `/`
// for root deploys). Dev stays root `/`; when the runtime config pins a
// sub-path the deep-link parser must strip it before the default parser
// runs, or no non-root URL resolves. Honest fallback: unknown base → `/`.

/** Normalize a base to the no-trailing-slash form (`/` stays `/`). */
export function normalizeShellBase(base: string | null | undefined): string {
  if (base == null) return '/'
  const v = base.trim()
  if (v === '' || v === '/') return '/'
  const leading = v.startsWith('/') ? v : `/${v}`
  const stripped = leading.replace(/\/+$/, '')
  return stripped === '' ? '/' : stripped
}

/** Strip the deploy base off a path (`/keystone/notes/x` → `/notes/x`).
 * Callback paths are exempt: both are accepted at the origin root as well
 * (v1 registered `/keystone/callback` there), and under base `/keystone`
 * stripping would turn that URL into `/callback`, which matches no route.
 * The canonical callback is also accepted base-prefixed — that form is
 * longer, so it never equals a bare callback path and strips normally. */
export function stripShellBase(path: string, base: string | null | undefined): string {
  if (isAuthCallbackPath(path)) return path
  const b = normalizeShellBase(base)
  if (b === '/') return path
  if (path === b) return '/'
  if (path.startsWith(`${b}/`)) return path.slice(b.length)
  return path
}

/** Base-aware `getStateFromPath`: strip base, rewrite legacy URLs, parse. */
export function getStateFromPathWithBase(
  path: string,
  base: string | null | undefined,
  options?: Parameters<typeof defaultGetStateFromPath>[1],
) {
  return defaultGetStateFromPath(rewriteLegacyPath(stripShellBase(path, base)), options)
}

/** Prefix list for a base (`/` → root only, else root + the base).
 * The base entry is a full scheme URL (`Linking.createURL(b)`): a bare
 * path never prefixes a full incoming URL, so the bare form was inert. */
export function linkingPrefixesForBase(base: string | null | undefined): string[] {
  const b = normalizeShellBase(base)
  const root = Linking.createURL('/')
  if (b === '/') return [root]
  return [root, Linking.createURL(b)]
}
