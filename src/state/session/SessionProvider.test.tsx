import {act, render, screen} from '@testing-library/react-native'

import {backendForSession, createMemoryStore} from '@keystone/fedi'

import {Body} from '#/alf/typography'
import type {TokenVault} from '#/storage'

import {createSessionStore} from './store'
import {SessionProvider, useActiveSession, useSessions} from './SessionProvider'

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function ActiveLabel() {
  const active = useActiveSession()
  return <Body testID="active">{active ? active.id : 'none'}</Body>
}

function CountLabel() {
  const sessions = useSessions()
  return <Body testID="count">{String(sessions.length)}</Body>
}

describe('SessionProvider', () => {
  it('exposes the active session and reacts to switches', async () => {
    const store = createSessionStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: HOME_ORIGIN,
    })
    render(
      <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
        <ActiveLabel />
        <CountLabel />
      </SessionProvider>,
    )
    expect(screen.getByTestId('active').props.children).toBe('none')

    const added = await store.add({
      origin: 'https://a.example',
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'alice',
      token: 'token-a',
      grant: 'password',
      hosting: 'third-party',
    })
    expect(await screen.findByTestId('active')).toBeTruthy()
    expect(screen.getByTestId('active').props.children).toBe(added.id)
    expect(screen.getByTestId('count').props.children).toBe('1')
  })

  it('throws outside the provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ActiveLabel />)).toThrow(/SessionProvider/)
    spy.mockRestore()
  })

  // 0.8 — the seam end-to-end: a real Misskey backend call that answers
  // 403 PERMISSION_DENIED goes transport → registered observer → store →
  // `scopeHealth.needsUpgrade`, with no screen involved. This is what the
  // shell banner reads, so it works even when the failing screen unmounts.
  it('a Misskey 403 PERMISSION_DENIED marks the session through the transport', async () => {
    const store = createSessionStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: HOME_ORIGIN,
    })
    render(
      <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
        <ActiveLabel />
      </SessionProvider>,
    )
    const session = await act(async () =>
      store.add({
        origin: 'https://a.example',
        family: 'misskey',
        flavor: 'misskey',
        accountId: 'alice',
        token: 'token-a',
        grant: 'password',
        hosting: 'third-party',
      }),
    )
    expect(store.scopeHealth(session.id).needsUpgrade).toBe(false)

    const originalFetch = globalThis.fetch
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({error: {message: 'denied', code: 'PERMISSION_DENIED'}}), {
          status: 403,
          headers: {'Content-Type': 'application/json'},
        }),
      ),
    ) as unknown as typeof fetch
    try {
      await act(async () => {
        await backendForSession(session)
          .me()
          .catch(() => undefined)
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(store.scopeHealth(session.id)).toEqual({
      needsReauth: false,
      needsUpgrade: true,
      generation: 'stale-permissions',
      reason: 'misskey-stale-permissions',
      missingScopes: [],
    })
  })
})
