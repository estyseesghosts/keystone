import {render, screen} from '@testing-library/react-native'
import {Text} from 'react-native'

import {createMemoryStore} from '@keystone/fedi'

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
  return <Text testID="active">{active ? active.id : 'none'}</Text>
}

function CountLabel() {
  const sessions = useSessions()
  return <Text testID="count">{String(sessions.length)}</Text>
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
})
