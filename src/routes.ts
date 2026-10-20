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
