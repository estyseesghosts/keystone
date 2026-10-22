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
      // Misskey-family capabilities report both list fields unsupported, so
      // the payload carries no replies_policy/exclusive at all.
      await waitFor(() => expect(backend.lists.create).toHaveBeenCalledWith('Local', {}))
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

  // 1.6 — reply policy + exclusive. Mastodon reports both supported, so the
  // controls are live and the chosen values reach create/update; Akkoma
  // reports the policy unsupported (its permitted params have no such
  // field) while `exclusive` is real.
  const mastodonBackend = (over: Record<string, string> = {}) => ({
    family: 'mastodon',
    capabilities: {
      lists: 'supported',
      lists_replies_policy: 'supported',
      lists_exclusive: 'supported',
      ...over,
    },
    lists: {
      list: jest.fn(async () => [
        {id: 'l1', name: 'Friends', repliesPolicy: 'list', exclusive: false},
      ]),
      create: jest.fn(async (name: string, fields: object) => ({id: 'l2', name, ...fields})),
      update: jest.fn(async (id: string, patch: object) => ({id, ...patch})),
      delete: jest.fn(async () => undefined),
    },
  })

  it('creates a Mastodon list with the chosen reply policy and exclusive flag', async () => {
    const backend = mastodonBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Friends')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('lists-create-input'), 'Quiet')
      fireEvent.press(screen.getByTestId('lists-create-policy-followed'))
      fireEvent.press(screen.getByTestId('lists-create-exclusive'))
      fireEvent.press(screen.getByTestId('lists-create-submit'))
      await waitFor(() =>
        expect(backend.lists.create).toHaveBeenCalledWith('Quiet', {
          repliesPolicy: 'followed',
          exclusive: true,
        }),
      )
    } finally {
      done()
    }
  })

  it('edits the reply policy of an existing list from the reported values', async () => {
    const backend = mastodonBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Friends')).toBeTruthy()
      fireEvent.press(screen.getByTestId('lists-rename-l1'))
      // Seeded from the row: `list` policy, exclusive off.
      expect(
        screen.getByTestId('lists-edit-l1-policy-list').props.accessibilityState.selected,
      ).toBe(true)
      fireEvent.press(screen.getByTestId('lists-edit-l1-policy-none'))
      fireEvent.press(screen.getByTestId('lists-edit-l1-exclusive'))
      fireEvent.press(screen.getByTestId('lists-rename-save-l1'))
      await waitFor(() =>
        expect(backend.lists.update).toHaveBeenCalledWith('l1', {
          name: 'Friends',
          repliesPolicy: 'none',
          exclusive: true,
        }),
      )
    } finally {
      done()
    }
  })

  it('disables the list fields with a reason where the server lacks them', async () => {
    const backend = mastodonBackend({lists_replies_policy: 'unsupported'})
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Friends')).toBeTruthy()
      expect(
        screen.getByTestId('lists-create-policy-none').props.accessibilityState.disabled,
      ).toBe(true)
      expect(screen.getByText('This server cannot choose who replies are shown from.')).toBeTruthy()
      expect(
        screen.getByTestId('lists-create-exclusive').props.accessibilityState.disabled,
      ).toBe(false)
      fireEvent.changeText(screen.getByTestId('lists-create-input'), 'Quiet')
      fireEvent.press(screen.getByTestId('lists-create-submit'))
      // The unsupported field is never sent, even though the state kept it.
      await waitFor(() =>
        expect(backend.lists.create).toHaveBeenCalledWith('Quiet', {exclusive: false}),
      )
    } finally {
      done()
    }
  })

  it('disables both fields with a reason when the server has not reported them', async () => {
    const backend = mastodonBackend({
      lists_replies_policy: 'unknown',
      lists_exclusive: 'unknown',
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Friends')).toBeTruthy()
      expect(
        screen.getByTestId('lists-create-policy-followed').props.accessibilityState.disabled,
      ).toBe(true)
      expect(screen.getByText('This server has not reported list reply settings.')).toBeTruthy()
      expect(screen.getByText('This server has not reported exclusive lists.')).toBeTruthy()
    } finally {
      done()
    }
  })
})
