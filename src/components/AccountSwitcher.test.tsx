import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {AccountSwitcher} from '#/components/AccountSwitcher'

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function setup() {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  const onAddAccount = jest.fn()
  render(
    <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
      <AccountSwitcher onAddAccount={onAddAccount} />
    </SessionProvider>,
  )
  return {store, onAddAccount}
}

const addSession = (store: ReturnType<typeof createSessionStore>, origin: string, accountId: string) =>
  store.add({
    origin,
    family: 'misskey',
    flavor: 'misskey',
    accountId,
    token: `token-${accountId}`,
    grant: 'password',
    hosting: 'third-party',
  })

describe('AccountSwitcher', () => {
  it('offers to add an account when empty', () => {
    const {onAddAccount} = setup()
    fireEvent.press(screen.getByText('Add account'))
    expect(onAddAccount).toHaveBeenCalledTimes(1)
  })

  it('switches accounts without showing the previous account as active', async () => {
    const {store} = setup()
    const a = await addSession(store, 'https://a.example', 'alice')
    const b = await addSession(store, 'https://b.example', 'bob')
    expect(await screen.findByTestId(`account-${b.id}`)).toBeTruthy()
    expect(store.activeId()).toBe(b.id)

    fireEvent.press(screen.getByTestId(`switch-${a.id}`))
    await waitFor(() => expect(store.activeId()).toBe(a.id))
    // The now-active account shows a label, never an inert switch button.
    expect(screen.queryByTestId(`switch-${a.id}`)).toBeNull()
    expect(screen.getByText('Current account')).toBeTruthy()
  })

  it('signs out one account and everywhere', async () => {
    const {store} = setup()
    const a = await addSession(store, 'https://a.example', 'alice')
    await addSession(store, 'https://b.example', 'bob')
    expect(await screen.findByTestId('signout-everywhere')).toBeTruthy()

    fireEvent.press(screen.getByTestId('signout-everywhere'))
    await waitFor(() => expect(store.list()).toHaveLength(0))
    expect(await screen.findByText('No accounts yet.')).toBeTruthy()

    const c = await addSession(store, 'https://a.example', 'alice')
    expect(await screen.findByTestId(`signout-${c.id}`)).toBeTruthy()
    expect(screen.queryByTestId('signout-everywhere')).toBeNull()
    fireEvent.press(screen.getByTestId(`signout-${c.id}`))
    await waitFor(() => expect(store.list()).toHaveLength(0))
    expect(a.id).toBe('https://a.example alice')
  })

  it('never activates a ghost id', async () => {
    const {store} = setup()
    await addSession(store, 'https://a.example', 'alice')
    expect(await screen.findByTestId(`account-https://a.example alice`)).toBeTruthy()
    expect(store.switch('https://gone.example ghost')).toBe(false)
    expect(store.activeId()).toBe('https://a.example alice')
  })
})
