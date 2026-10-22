// 0.8 — the global permission/scope upgrade prompt.
//
// The prompt reads `scopeHealth(sessionId)` from the session store, so it
// is per-session, survives a screen unmount (it lives in the shell, not in
// the failing screen) and never invents a scope list: a Misskey-family 403
// has no server-returned scope set, so the copy says the token predates a
// permission instead of naming scopes.

import {act, fireEvent, render, screen} from '@testing-library/react-native'

import {createMemoryStore, OAUTH_APPS_KEY, SCOPES_NOW, type KeyValueStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {Body} from '#/alf/typography'
import {navigationRef} from '#/navigationRef'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider, useScopeHealth} from '#/state/session/SessionProvider'

import {ScopeUpgradeBanner} from './ScopeUpgradeBanner'

const HOME_ORIGIN = 'https://app.example'
const ORIGIN = 'https://m.example'
const MASTO_ORIGIN = 'https://mas.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function setup() {
  const storage: KeyValueStore = createMemoryStore()
  const store = createSessionStore({
    storage,
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  return {storage, store}
}

function renderBanner(store: ReturnType<typeof createSessionStore>) {
  return render(
    <ThemeProvider theme="light">
      <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
        <ScopeUpgradeBanner />
      </SessionProvider>
    </ThemeProvider>,
  )
}

async function addMisskey(store: ReturnType<typeof createSessionStore>) {
  return store.add({
    origin: ORIGIN,
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-alice',
    grant: 'password',
    hosting: 'third-party',
  })
}

describe('ScopeUpgradeBanner (0.8 global permission-denied prompt)', () => {
  beforeEach(() => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders nothing for a healthy Misskey session (no 403 yet)', async () => {
    const {store} = setup()
    const session = await addMisskey(store)
    renderBanner(store)
    expect(store.scopeHealth(session.id).needsUpgrade).toBe(false)
    expect(screen.queryByTestId('scope-upgrade-banner')).toBeNull()
  })

  it('appears after a Misskey permission denial and offers a working re-auth action', async () => {
    const {store} = setup()
    const session = await addMisskey(store)
    renderBanner(store)
    expect(screen.queryByTestId('scope-upgrade-banner')).toBeNull()

    await act(async () => {
      store.notePermissionDenied(session.id)
    })

    expect(await screen.findByTestId('scope-upgrade-banner')).toBeTruthy()
    // Honest copy: no invented scope names, the token predates a permission.
    expect(screen.getByText(/predates a permission/i)).toBeTruthy()
    expect(screen.queryByText(/write:|read:/)).toBeNull()

    const navigate = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
    fireEvent.press(screen.getByTestId('scope-upgrade-signin'))
    expect(navigate).toHaveBeenCalledWith('Login', {origin: ORIGIN})
  })

  it('reuses the same prompt for Mastodon-family stale scopes (ADR 0003 + ADR 0005)', async () => {
    const {storage, store} = setup()
    await store.add({
      origin: MASTO_ORIGIN,
      family: 'mastodon',
      flavor: 'akkoma',
      accountId: 'bob',
      token: 'token-bob',
      grant: 'oauth-pkce',
      hosting: 'third-party',
    })
    // Pre-scopes generation: umbrella-only cache on a flavor that expects
    // the full set (ADR 0005). A pre-slice `mastodon`-flavor triple cache
    // likewise needs the upgrade now (slice 3.1 appends `admin:read`).
    storage.setItem(
      OAUTH_APPS_KEY,
      JSON.stringify({[MASTO_ORIGIN]: {client_id: 'id', client_secret: 's', scopes: 'read write follow'}}),
    )
    const health = store.scopeHealth()
    expect(health.needsUpgrade).toBe(true)
    expect(health.generation).toBe('pre-scopes')
    // Guard: the stored NOW list is not requested here, only diffed.
    expect(SCOPES_NOW.length).toBeGreaterThan(3)

    renderBanner(store)
    expect(await screen.findByTestId('scope-upgrade-banner')).toBeTruthy()
    expect(screen.getByText(/refresh this account.s permissions/i)).toBeTruthy()
  })

  it('useScopeHealth is per session and reactive to the marker', async () => {
    function Probe() {
      const health = useScopeHealth()
      return (
        <Body testID="scope-health-probe">
          {health ? `${health.reason}:${health.needsUpgrade}` : 'none'}
        </Body>
      )
    }
    const {store} = setup()
    const session = await addMisskey(store)
    render(
      <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
        <Probe />
      </SessionProvider>,
    )
    expect(screen.getByTestId('scope-health-probe').props.children).toBe('misskey-no-scopes:false')
    await act(async () => {
      store.notePermissionDenied(session.id)
    })
    expect(screen.getByTestId('scope-health-probe').props.children).toBe(
      'misskey-stale-permissions:true',
    )
  })
})
