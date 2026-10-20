import {render, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'

import {
  cacheApp,
  createMemoryStore,
  savePendingAuth,
  type KeyValueStore,
} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {Navigation} from '#/Navigation'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {appStorage, __setStorageForTests} from '#/storage'
import type {TokenVault} from '#/storage'

const ORIGIN = 'https://m.example'
const CODE = 'code-123'
const STATE = 'state-abc'

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
  useURL: () => `keystone://auth/callback?code=${CODE}&state=${STATE}`,
}))

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  })
}

describe('AuthCallbackScreen', () => {
  it('completes a pending OAuth flow and stores the verified session', async () => {
    const storage: KeyValueStore = createMemoryStore()
    // Seed the pending flow + cached app exactly as startMastodonOAuth leaves them.
    savePendingAuth(storage, {
      origin: ORIGIN,
      redirectUri: `${ORIGIN}/auth/callback`,
      state: STATE,
      codeVerifier: 'verifier-xyz',
      scopes: 'read:accounts',
      createdAt: Date.now(),
    })
    cacheApp(storage, {
      origin: ORIGIN,
      redirect_uri: `${ORIGIN}/auth/callback`,
      client_id: 'cid',
      client_secret: 'csec',
      scopes: 'read:accounts',
      createdAt: Date.now(),
    })
    const prevStorage = appStorage()
    __setStorageForTests({storage, vault: memVault()})

    globalThis.fetch = jest.fn(async (url: string) => {
      if (url === `${ORIGIN}/oauth/token`) {
        return jsonResponse({access_token: 'oauth-token', token_type: 'Bearer', scope: 'read:accounts', created_at: 1})
      }
      if (url === `${ORIGIN}/api/v1/accounts/verify_credentials`) {
        return jsonResponse({id: 'user-1', username: 'carol', acct: 'carol'})
      }
      if (url === `${ORIGIN}/.well-known/nodeinfo`) return jsonResponse({}, 404)
      if (url === `${ORIGIN}/api/meta`) return jsonResponse({}, 404)
      if (url === `${ORIGIN}/api/v2/instance`) {
        return jsonResponse({domain: 'm.example', version: '4.3.0', title: 'M'})
      }
      throw new Error(`unexpected request ${url}`)
    }) as unknown as typeof fetch

    try {
      const store = createSessionStore({storage, vault: memVault(), homeOrigin: 'keystone://app'})
      render(
        <I18nProvider i18n={i18n}>
          <ThemeProvider>
            <SessionProvider store={store} homeOrigin="keystone://app">
              <Navigation initialState={{routes: [{name: 'Main'}, {name: 'AuthCallback'}]}} />
            </SessionProvider>
          </ThemeProvider>
        </I18nProvider>,
      )
      await waitFor(() => expect(store.list()).toHaveLength(1))
      const session = store.list()[0]
      expect(session.origin).toBe(ORIGIN)
      expect(session.token).toBe('oauth-token')
      expect(session.grant).toBe('oauth-pkce')
      expect(session.family).toBe('mastodon')
      expect(session.accountId).toBe('user-1')
      expect(store.activeId()).toBe(session.id)
    } finally {
      __setStorageForTests({storage: prevStorage})
    }
  })
})
