// Route table. Paths keep Keystone's web URLs (plan §1.5); the scheme
// is a placeholder until the owner decides app identity (plan §7 D3).
// The Profile tab renders the User screen without an id (own profile).

export type NetworkTab = 'social' | 'local' | 'global'

export type RootParamList = {
  Home: undefined
  Network: {tab?: NetworkTab} | undefined
  Explore: undefined
  Notifications: undefined
  User: {id?: string} | undefined
  Note: {id: string}
  Tag: {tag: string}
  List: {id: string}
  Settings: undefined
  Login: undefined
  AuthCallback: undefined
  SysDebug: undefined
  Compose: {replyToId?: string; quoteId?: string; draftId?: string} | undefined
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
