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

import {t} from '@lingui/macro'

// Locale boot (P5): see `menuModel.ts` — `titleForRoute` evaluates `t`
// at call time against the shared singleton.
import '#/locale/i18n'

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

// --- OAuth/MiAuth callback paths (clickstone §1.13, audit A5) ---------------
//
// v1 accepted `/keystone/callback` at a ROOT base (its `/auth/*` prefix
// belongs to the server behind a same-origin deploy) and
// `${base}/auth/callback` under a sub-path. v2 registers one canonical path,
// `/auth/callback`, at every base (`webCallbackUri` in `screens/LoginFlows`)
// and keeps the v1 root path as a first-class route, so a redirect_uri
// registered before the rebuild — or an old bookmark — still lands on the
// callback screen. Both are exempt from base stripping: under base
// `/keystone`, `/keystone/callback` must not become `/callback`.
export const AUTH_CALLBACK_PATH = '/auth/callback'
export const LEGACY_AUTH_CALLBACK_PATH = '/keystone/callback'
export const AUTH_CALLBACK_PATHS: readonly string[] = [
  AUTH_CALLBACK_PATH,
  LEGACY_AUTH_CALLBACK_PATH,
]

export type RootParamList = {
  Home: undefined
  Network: {tab?: NetworkTab} | undefined
  Explore: {tab?: ExploreTab} | undefined
  Notifications: undefined
  User: {id?: string; acct?: string} | undefined
  Note: {id: string}
  /** One post's edit history (clickstone §1.7). Only reachable on a family
   * whose backend exposes `editHistory` (Mastodon). */
  NoteHistory: {id: string}
  Tag: {tag: string}
  List: {id: string}
  Lists: undefined
  Clip: {id: string}
  Clips: {addNoteId?: string} | undefined
  Antenna: {id: string}
  Antennas: undefined
  Channel: {id: string}
  Channels: undefined
  /** Server notices (clickstone §1.12): read + dismiss; no authoring. */
  Announcements: undefined
  Drive: undefined
  Favorites: undefined
  Followers: {id: string}
  Following: {id: string}
  FollowRequests: undefined
  ProfileEdit: undefined
  Settings: {section?: SettingsSection} | undefined
  /** `origin` prefills the server field — the shell's scope-upgrade prompt
   * re-opens sign-in for the session that needs a fresh token. */
  Login: {origin?: string} | undefined
  AuthCallback: undefined
  /** v1 root-base callback URL (`/keystone/callback`) — same screen. */
  KeystoneCallback: undefined
  SysDebug: undefined
  Compose:
    | {
        replyToId?: string
        quoteId?: string
        draftId?: string
        editId?: string
        /** Delete-and-redraft handoff key (clickstone §1.7): the payload is
         * already in the in-memory seed store — the post itself is gone, so
         * this route never re-fetches it. */
        redraftId?: string
      }
    | undefined
}

export const paths: Record<keyof RootParamList, string> = {
  Home: '/',
  Network: '/network/:tab?',
  Explore: '/explore/:tab?',
  Notifications: '/notifications',
  User: '/users/:id?',
  Note: '/notes/:id',
  NoteHistory: '/notes/:id/history',
  Tag: '/tags/:tag',
  List: '/lists/:id',
  Lists: '/lists',
  Clip: '/clips/:id',
  Clips: '/clips',
  Antenna: '/antennas/:id',
  Antennas: '/antennas',
  Channel: '/channels/:id',
  Channels: '/channels',
  Announcements: '/announcements',
  Drive: '/drive',
  Favorites: '/favorites',
  Followers: '/users/:id/followers',
  Following: '/users/:id/following',
  FollowRequests: '/follow-requests',
  ProfileEdit: '/profile/edit',
  Settings: '/settings/:section?',
  Login: '/login',
  AuthCallback: AUTH_CALLBACK_PATH,
  KeystoneCallback: LEGACY_AUTH_CALLBACK_PATH,
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

// --- Callback URL helpers ---------------------------------------------------
//
// Pure string transforms (no `URL` global): the route table is also loaded
// on native, and both callbacks must survive base stripping, legacy
// rewriting, and the post-exchange address-bar cleanup unchanged.

/** Path part of `raw` (a route path or a web URL), query/fragment dropped. */
function pathOf(raw: string): string {
  const schemeAndAuthority = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/.exec(raw)
  const rest = schemeAndAuthority ? raw.slice(schemeAndAuthority[0].length) : raw
  return rest.split(/[?#]/, 1)[0] ?? ''
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/** True when `raw` (a route path or a web URL) targets a callback path —
 * the canonical one or the v1 root alias. Query/fragment/trailing slash are
 * ignored; the deploy base, when present, is not stripped here. */
export function isAuthCallbackPath(raw: string): boolean {
  if (!raw) return false
  return AUTH_CALLBACK_PATHS.includes(withoutTrailingSlash(pathOf(raw)))
}

/** The address-bar URL after the callback consumed its one-time params: the
 * SAME path (deploy base included), no `?query`/`#fragment`, so the
 * one-time `code`/`state`/`session` never stay visible — for both the
 * canonical and the legacy path. Falls back to the canonical path when
 * `raw` is unusable. */
export function callbackCleanHref(raw: string | null | undefined): string {
  const path = raw ? withoutTrailingSlash(pathOf(raw)) : ''
  return path || AUTH_CALLBACK_PATH
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
    NoteHistory: leaf('NoteHistory'),
    Tag: leaf('Tag'),
    List: leaf('List'),
    Lists: leaf('Lists'),
    Clip: leaf('Clip'),
    Clips: leaf('Clips'),
    Antenna: leaf('Antenna'),
    Antennas: leaf('Antennas'),
    Channel: leaf('Channel'),
    Channels: leaf('Channels'),
    Announcements: leaf('Announcements'),
    Drive: leaf('Drive'),
    Favorites: leaf('Favorites'),
    Followers: leaf('Followers'),
    Following: leaf('Following'),
    FollowRequests: leaf('FollowRequests'),
    ProfileEdit: leaf('ProfileEdit'),
    Settings: leaf('Settings'),
    Login: leaf('Login'),
    AuthCallback: leaf('AuthCallback'),
    // v1 root-base callback URL: same screen, separate leaf so both URLs
    // resolve (clickstone §1.13).
    KeystoneCallback: leaf('KeystoneCallback'),
    SysDebug: leaf('SysDebug'),
    Compose: leaf('Compose'),
  }
}

// Butterfly chrome titles per leaf route (Keystone v1 `stripTitle`
// mapping: the SECTION, never the tab — `/network/*` reads "My Network").
// Lingui `t` against the shared singleton: pure like the function itself,
// English-identical under the `en` catalog (nav tests pin the strings).
export function titleForRoute(
  name: string | undefined,
  params?: {tag?: unknown; section?: unknown} | null,
): string {
  switch (name) {
    case 'Home':
      return t`Home`
    case 'Network':
      return t`My Network`
    case 'Explore':
      return t`Search`
    case 'Notifications':
      return t`Notifications`
    case 'User':
      return t`Profile`
    case 'Note':
      return t`Note`
    case 'NoteHistory':
      return t`Edit history`
    case 'Tag':
      return typeof params?.tag === 'string' && params.tag ? `#${params.tag}` : t`Tag`
    case 'List':
      return t`List`
    case 'Lists':
      return t`Lists`
    case 'Clip':
      return t`Clip`
    case 'Clips':
      return t`Clips`
    case 'Antenna':
      return t`Antenna`
    case 'Antennas':
      return t`Antennas`
    case 'Channel':
      return t`Channel`
    case 'Channels':
      return t`Channels`
    case 'Announcements':
      return t`Announcements`
    case 'Drive':
      return t`Drive`
    case 'Favorites':
      return t`Favorites`
    case 'Followers':
      return t`Followers`
    case 'Following':
      return t`Following`
    case 'FollowRequests':
      return t`Follows`
    case 'ProfileEdit':
      return t`Edit profile`
    case 'Settings': {
      const section = typeof params?.section === 'string' ? params.section : ''
      switch (section) {
        case 'account':
          return t`Your account`
        case 'display':
          return t`Accessibility and display`
        case 'reactions':
          return t`Reactions and emoji`
        case 'feeds':
          return t`Feeds`
        case 'mutes':
          return t`Mutes and blocks`
        case 'import':
          return t`Import`
        case 'export':
          return t`Export`
        case 'filters':
          return t`Word filters`
        case 'language':
          return t`Language`
        default:
          return t`Settings`
      }
    }
    case 'Login':
    case 'AuthCallback':
    case 'KeystoneCallback':
      return t`Sign in`
    case 'SysDebug':
      return t`Debug`
    case 'Compose':
      return t`New post`
    default:
      return t`Keystone`
  }
}
