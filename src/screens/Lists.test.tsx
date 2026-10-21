// Lists index (C15): signed-out, unsupported, list + navigate, create,
// rename, and two-tap delete; CRUD controls render disabled with a reason
// when the optional backend members are absent.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ListsScreen} from './Lists'

const mockNavigate = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate}),
}))

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

const HOME_ORIGIN = 'https://app.example'
const ORIGIN = 'https://m.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

async function setup({backend}: {backend?: any} = {}) {
  mockNavigate.mockClear()
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = backend ?? null
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  if (backend) {
    await sessionStore.add({
      origin: ORIGIN,
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'password',
      hosting: 'third-party',
    })
  }
  render(
    <ThemeProvider theme="light">
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        <ListsScreen />
      </SessionProvider>
    </ThemeProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    },
  }
}

const fullLists = () => ({
  list: jest.fn(async () => [
    {id: 'l1', name: 'Friends'},
    {id: 'l2', name: 'News'},
  ]),
  create: jest.fn(async (name: string) => ({id: 'l3', name})),
  update: jest.fn(async (id: string, patch: {name: string}) => ({id, name: patch.name})),
  delete: jest.fn(async () => undefined),
})

const fullBackend = () => ({
  family: 'misskey',
  capabilities: {lists: 'supported'},
  lists: fullLists(),
})

describe('Lists screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see your lists.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without a lists module', async () => {
    const {done} = await setup({backend: {family: 'misskey', capabilities: {}}})
    try {
      expect(await screen.findByText('Lists are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('lists rows and navigates to the list feed', async () => {
    const {done} = await setup({backend: fullBackend()})
    try {
      expect(await screen.findByText('Friends')).toBeTruthy()
      expect(screen.getByText('News')).toBeTruthy()
      fireEvent.press(screen.getByTestId('lists-open-l1'))
      expect(mockNavigate).toHaveBeenCalledWith('List', {id: 'l1'})
    } finally {
      done()
    }
  })

  it('creates a list from the name input', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Friends')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('lists-create-input'), 'Local')
      fireEvent.press(screen.getByTestId('lists-create-submit'))
      await waitFor(() => expect(backend.lists.create).toHaveBeenCalledWith('Local'))
      expect(await screen.findByText('Local')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('renames a list inline', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Friends')).toBeTruthy()
      fireEvent.press(screen.getByTestId('lists-rename-l1'))
      fireEvent.changeText(screen.getByTestId('lists-rename-input-l1'), 'Besties')
      fireEvent.press(screen.getByTestId('lists-rename-save-l1'))
      await waitFor(() => expect(backend.lists.update).toHaveBeenCalledWith('l1', {name: 'Besties'}))
      expect(await screen.findByText('Besties')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('deletes only after a two-tap confirm', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Friends')).toBeTruthy()
      fireEvent.press(screen.getByTestId('lists-delete-l1'))
      expect(backend.lists.delete).not.toHaveBeenCalled()
      expect(screen.getByTestId('lists-delete-confirm-l1')).toBeTruthy()
      fireEvent.press(screen.getByTestId('lists-delete-confirm-l1'))
      await waitFor(() => expect(backend.lists.delete).toHaveBeenCalledWith('l1'))
      await waitFor(() => expect(screen.queryByText('Friends')).toBeNull())
    } finally {
      done()
    }
  })

  it('disables CRUD with reasons when the optional members are absent', async () => {
    const backend = {
      family: 'misskey',
      capabilities: {lists: 'supported'},
      lists: {list: jest.fn(async () => [{id: 'l1', name: 'Friends'}])},
    }
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Friends')).toBeTruthy()
      expect(screen.getByTestId('lists-create-submit').props.accessibilityState.disabled).toBe(true)
      expect(screen.getByTestId('lists-rename-l1').props.accessibilityState.disabled).toBe(true)
      expect(screen.getByTestId('lists-delete-l1').props.accessibilityState.disabled).toBe(true)
    } finally {
      done()
    }
  })

  it('retries after a load failure', async () => {
    const list = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([{id: 'l1', name: 'Friends'}])
    const {done} = await setup({
      backend: {family: 'misskey', capabilities: {lists: 'supported'}, lists: {list}},
    })
    try {
      expect(await screen.findByText('Could not load lists.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('lists-retry'))
      expect(await screen.findByText('Friends')).toBeTruthy()
    } finally {
      done()
    }
  })
})
