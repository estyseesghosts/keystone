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

/** Segments the Explore screen accepts in `:tab?`. Mirrors v1
 * `routes/Explore.tsx` (`/explore/users|tags|posts|news`); the bare
 * `/explore` default tab is `posts`. Unknown values fall back to undefined
 * so the caller renders the default tab. */
export type ExploreTab = 'users' | 'tags' | 'posts' | 'news'

export const EXPLORE_TAB_ALIASES: Record<string, ExploreTab> = {
  users: 'users',
  tags: 'tags',
  posts: 'posts',
  news: 'news',
}

/** Normalize a raw `:tab` param to an `ExploreTab` (unknown → undefined,
 * so the caller falls back to the default tab). */
export function exploreTabFromParam(tab: unknown): ExploreTab | undefined {
  return typeof tab === 'string' ? EXPLORE_TAB_ALIASES[tab] : undefined
}

/** Settings sections with real routes (v1 `routes/Settings.tsx` parity,
 * N3). `Settings.tsx` imports this instead of declaring its own union. */
export type SettingsSection =
  | 'account'
  | 'display'
  | 'reactions'
  | 'feeds'
  | 'mutes'
  | 'import'
  | 'export'
  | 'filters'
  | 'language'

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'account',
  'display',
  'reactions',
  'feeds',
  'mutes',
  'import',
  'export',
  'filters',
  'language',
]

export type RootParamList = {
  Home: undefined
  Network: {tab?: NetworkTab} | undefined
  Explore: {tab?: ExploreTab} | undefined
  Notifications: undefined
  User: {id?: string; acct?: string} | undefined
  Note: {id: string}
  Tag: {tag: string}
  List: {id: string}
  Lists: undefined
  Clip: {id: string}
  Clips: {addNoteId?: string} | undefined
  Antenna: {id: string}
  Antennas: undefined
  Drive: undefined
  Favorites: undefined
  Followers: {id: string}
  Following: {id: string}
  FollowRequests: undefined
  ProfileEdit: undefined
  Settings: {section?: SettingsSection} | undefined
  Login: undefined
  AuthCallback: undefined
  SysDebug: undefined
  Compose: {replyToId?: string; quoteId?: string; draftId?: string; editId?: string} | undefined
}

export const paths: Record<keyof RootParamList, string> = {
  Home: '/',
  Network: '/network/:tab?',
  Explore: '/explore/:tab?',
  Notifications: '/notifications',
  User: '/users/:id?',
  Note: '/notes/:id',
  Tag: '/tags/:tag',
  List: '/lists/:id',
  Lists: '/lists',
  Clip: '/clips/:id',
  Clips: '/clips',
  Antenna: '/antennas/:id',
  Antennas: '/antennas',
  Drive: '/drive',
  Favorites: '/favorites',
  Followers: '/users/:id/followers',
  Following: '/users/:id/following',
  FollowRequests: '/follow-requests',
  ProfileEdit: '/profile/edit',
  Settings: '/settings/:section?',
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
    Lists: leaf('Lists'),
    Clip: leaf('Clip'),
    Clips: leaf('Clips'),
    Antenna: leaf('Antenna'),
    Antennas: leaf('Antennas'),
    Drive: leaf('Drive'),
    Favorites: leaf('Favorites'),
    Followers: leaf('Followers'),
    Following: leaf('Following'),
    FollowRequests: leaf('FollowRequests'),
    ProfileEdit: leaf('ProfileEdit'),
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
  params?: {tag?: unknown; section?: unknown} | null,
): string {
  switch (name) {
    case 'Home':
      return 'Home'
    case 'Network':
      return 'My Network'
    case 'Explore':
      return 'Search'
    case 'Notifications':
      return 'Notifications'
    case 'User':
      return 'Profile'
    case 'Note':
      return 'Note'
    case 'Tag':
      return typeof params?.tag === 'string' && params.tag ? `#${params.tag}` : 'Tag'
    case 'List':
      return 'List'
    case 'Lists':
      return 'Lists'
    case 'Clip':
      return 'Clip'
    case 'Clips':
      return 'Clips'
    case 'Antenna':
      return 'Antenna'
    case 'Antennas':
      return 'Antennas'
    case 'Drive':
      return 'Drive'
    case 'Favorites':
      return 'Favorites'
    case 'Followers':
      return 'Followers'
    case 'Following':
      return 'Following'
    case 'FollowRequests':
      return 'Follows'
    case 'ProfileEdit':
      return 'Edit profile'
    case 'Settings': {
      const section = typeof params?.section === 'string' ? params.section : ''
      switch (section) {
        case 'account':
          return 'Your account'
        case 'display':
          return 'Accessibility and display'
        case 'reactions':
          return 'Reactions and emoji'
        case 'feeds':
          return 'Feeds'
        case 'mutes':
          return 'Mutes and blocks'
        case 'import':
          return 'Import'
        case 'export':
          return 'Export'
        case 'filters':
          return 'Word filters'
        case 'language':
          return 'Language'
        default:
          return 'Settings'
      }
    }
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
