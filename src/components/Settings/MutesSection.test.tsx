// Mutes section C18: renote-mute list renders as a real two-way list when
// the backend exposes `renoteMutes`, and keeps the honest placeholder when
// it does not (the Mastodon family has no endpoint and stays absent).

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {SettingsScreen} from '#/screens/Settings'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn()}),
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

const fakeAccount = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'u1',
    username: 'alice',
    acct: 'alice',
    host: null,
    name: null,
    displayName: 'alice',
    ext: {me: {rejectQuotes: false, mutedWords: [], hardMutedWords: [], mutedInstances: []}},
    ...overrides,
  }) as any

const emptyPage = () => ({items: [], cursor: null, end: true})

const baseBackend = () => ({
  family: 'misskey',
  capabilities: {},
  me: jest.fn(async () => fakeAccount()),
  updateProfile: jest.fn(async () => fakeAccount()),
  mutes: jest.fn(async () => emptyPage()),
  blocks: jest.fn(async () => emptyPage()),
  mute: jest.fn(async () => undefined),
  unmute: jest.fn(async () => undefined),
  muteRenotes: jest.fn(async () => undefined),
  unmuteRenotes: jest.fn(async () => undefined),
  block: jest.fn(async () => undefined),
  unblock: jest.fn(async () => undefined),
  search: {accounts: jest.fn(async () => emptyPage())},
})

async function setup({backend}: {backend?: any} = {}) {
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
      family: backend.family ?? 'misskey',
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
        <SettingsScreen />
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

describe('Mutes section renote-mutes (C18)', () => {
  it('keeps the honest placeholder when the backend has no list endpoint', async () => {
    const {done} = await setup({backend: baseBackend()})
    try {
      fireEvent.press(screen.getByTestId('settings-row-mutes'))
      expect(await screen.findByTestId('muted-list')).toBeTruthy()
      expect(screen.getByTestId('placeholder-renote-mutes').props.accessibilityState.disabled).toBe(
        true,
      )
      expect(screen.queryByTestId('renote-mutes-list')).toBeNull()
    } finally {
      done()
    }
  })

  it('lists repost-mutes and unmutes when the backend exposes renoteMutes', async () => {
    const backend = {
      ...baseBackend(),
      renoteMutes: jest.fn(async () => ({
        items: [fakeAccount({id: 'r1', displayName: 'renote-muted', acct: 'renote-muted'})],
        cursor: null,
        end: true,
      })),
    }
    const {done} = await setup({backend})
    try {
      fireEvent.press(screen.getByTestId('settings-row-mutes'))
      expect(await screen.findByTestId('renote-mutes-list')).toBeTruthy()
      expect(screen.getByText('renote-muted')).toBeTruthy()
      expect(screen.queryByTestId('placeholder-renote-mutes')).toBeNull()
      fireEvent.press(screen.getByText('Unmute reposts'))
      await waitFor(() => expect(backend.unmuteRenotes).toHaveBeenCalledWith('r1'))
    } finally {
      done()
    }
  })
})
