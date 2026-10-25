// Repair X3.4 (networking M6): `useBackendForSessionId` memoises on the
// session object, so a store update for another account keeps the pooled
// backend (and its socket) instead of redialing every live feed.
import {act, renderHook} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {useBackendForSessionId} from './HomeFeed'

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

async function signedInStore() {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
  })
  const added = await store.add({
    origin: 'https://a.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-a',
    grant: 'password',
    hosting: 'third-party',
  })
  return {store, sessionId: added.id}
}

describe('useBackendForSessionId pooling (X3.4 M6)', () => {
  it('returns a stable backend across rerenders and unrelated store updates', async () => {
    const {store, sessionId} = await signedInStore()
    const wrapper = ({children}: {children: React.ReactNode}) => (
      <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
        {children}
      </SessionProvider>
    )
    const {result, rerender} = renderHook(({id}: {id: string | null}) => useBackendForSessionId(id), {
      initialProps: {id: sessionId},
      wrapper,
    })
    expect(result.current).not.toBeNull()
    const first = result.current

    rerender({id: sessionId})
    expect(result.current).toBe(first)

    // An unrelated store change (another account added): the pooled
    // backend survives (the old code memoised on the whole snapshot and
    // rebuilt — redialing every live feed — on any store emit).
    await act(async () => {
      await store.add({
        origin: 'https://b.example',
        family: 'misskey',
        flavor: 'misskey',
        accountId: 'bob',
        token: 'token-b',
        grant: 'password',
        hosting: 'third-party',
      })
    })
    expect(result.current).toBe(first)
  })

  it('returns null for an unknown session id', async () => {
    const {store} = await signedInStore()
    const wrapper = ({children}: {children: React.ReactNode}) => (
      <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
        {children}
      </SessionProvider>
    )
    const {result} = renderHook(() => useBackendForSessionId('https://nope.example ghost'), {wrapper})
    expect(result.current).toBeNull()
  })
})
