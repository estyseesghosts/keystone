// Route table. Paths keep Keystone's web URLs (plan §1.5); the scheme
// is a placeholder until the owner decides app identity (plan §7 D3).
// The Profile tab renders the User screen without an id (own profile).
//
// This file is the SINGLE source for the URL table (parity S3): the
// react-navigation `linking.config` in `Navigation.tsx` is derived from
// `paths` below (via `linkingScreens()`), and `nav.test.tsx` fails on
// drift. Canonical Network tab is `federated` (v1 `MyNetwork`); the
// backend descriptor stays `timeline|global` (internal endpoint names
// are unchanged — see `descriptorForNetworkTab`).

export type NetworkTab = 'social' | 'local' | 'federated'

/** Segments the Network screen accepts in `:tab?`. `global` is the
 * pre-W1 name: it still resolves, as an alias for `federated`. */
export const NETWORK_TAB_ALIASES: Record<string, NetworkTab> = {
  social: 'social',
  local: 'local',
  federated: 'federated',
  global: 'federated',
}

/** Normalize a raw `:tab` param to a `NetworkTab` (unknown → undefined,
 * so the caller falls back to the default tab). */
export function networkTabFromParam(tab: unknown): NetworkTab | undefined {
  return typeof tab === 'string' ? NETWORK_TAB_ALIASES[tab] : undefined
}

export type RootParamList = {
  Home: undefined
  Network: {tab?: NetworkTab} | undefined
  Explore: undefined
  Notifications: undefined
  User: {id?: string; acct?: string} | undefined
  Note: {id: string}
  Tag: {tag: string}
  List: {id: string}
  Settings: undefined
  Login: undefined
  AuthCallback: undefined
  SysDebug: undefined
  Compose: {replyToId?: string; quoteId?: string; draftId?: string; editId?: string} | undefined
}

export const paths: Record<keyof RootParamList, string> = {
  Home: '/',
  Network: '/network/:tab?',
  Explore: '/explore',
  Notifications: '/notifications',
  User: '/users/:id?',
  Note: '/notes/:id',
  Tag: '/tags/:tag',
  List: '/lists/:id',
  Settings: '/settings',
  Login: '/login',
  AuthCallback: '/auth/callback',
  SysDebug: '/sys/debug',
  Compose: '/compose',
}

/** Legacy web URLs that redirect into the canonical table (v1 `App.tsx`:
 * `/local`, `/social`, `/global` → `/network/*`; `/search` → `/explore`,
 * forwarding `?tag=`). React Navigation has no declarative redirects, so
 * `Navigation.tsx` rewrites these through this function before delegating
 * to the default `getStateFromPath`. Pure string transform — tested. */
export function rewriteLegacyPath(path: string): string {
  const queryIndex = path.indexOf('?')
  const raw = queryIndex < 0 ? path : path.slice(0, queryIndex)
  const query = queryIndex < 0 ? '' : path.slice(queryIndex)
  const clean = raw.endsWith('/') && raw.length > 1 ? raw.slice(0, -1) : raw
  switch (clean) {
    case '/local':
      return `/network/local${query}`
    case '/social':
      return `/network/social${query}`
    case '/global':
      return `/network/federated${query}`
    case '/search':
      return `/explore${query}`
    default:
      return path
  }
}

// --- Single-source linking table -------------------------------------------
//
// `Navigation.tsx` builds its `linking.config` from this (see
// `linkingScreens()`), so the two tables cannot drift: every leaf below
// is `paths[name]` with the leading slash stripped (`/` → `''`).
type LinkingScreens = Record<string, string | {screens: Record<string, string>}>

const leaf = (name: keyof RootParamList): string => {
  const p = paths[name]
  return p === '/' ? '' : p.replace(/^\//, '')
}

/** The `linking.config.screens` object, derived from `paths`. Nesting
 * mirrors the navigator tree: tab screens under `Main`, stack screens
 * at the top level. */
export function linkingScreens(): LinkingScreens {
  return {
    Main: {
      screens: {
        Home: leaf('Home'),
        Network: leaf('Network'),
        Explore: leaf('Explore'),
        Notifications: leaf('Notifications'),
        User: leaf('User'),
      },
    },
    Note: leaf('Note'),
    Tag: leaf('Tag'),
    List: leaf('List'),
    Settings: leaf('Settings'),
    Login: leaf('Login'),
    AuthCallback: leaf('AuthCallback'),
    SysDebug: leaf('SysDebug'),
    Compose: leaf('Compose'),
  }
}

// Butterfly chrome titles per leaf route (Keystone v1 `stripTitle`
// mapping: the SECTION, never the tab — `/network/*` reads "My Network").
export function titleForRoute(
  name: string | undefined,
  params?: {tag?: unknown} | null,
): string {
  switch (name) {
    case 'Home':
      return 'Home'
    case 'Network':
      return 'My Network'
    case 'Explore':
      return 'Explore'
    case 'Notifications':
      return 'Notifications'
    case 'User':
      return 'Profile'
    case 'Note':
      return 'Post'
    case 'Tag':
      return typeof params?.tag === 'string' && params.tag ? `#${params.tag}` : 'Tag'
    case 'List':
      return 'List'
    case 'Settings':
      return 'Settings'
    case 'Login':
    case 'AuthCallback':
      return 'Sign in'
    case 'SysDebug':
      return 'Debug'
    case 'Compose':
      return 'New post'
    default:
      return 'Keystone'
  }
}
