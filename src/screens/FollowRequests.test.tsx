// Follow-requests queue (N11): signed-out, empty, accept/reject through
// the graph controller, and error/retry. Rows resolve by follower id.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {FollowRequestsScreen} from './FollowRequests'

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
    id: 'f1',
    username: 'follower',
    acct: 'follower',
    host: null,
    name: 'Follower One',
    locked: false,
    ...overrides,
  }) as any

const fakeRequest = (id: string, followerId: string) =>
  ({
    id,
    follower: fakeAccount({id: followerId, username: followerId, name: `Follower ${followerId}`}),
    followee: fakeAccount({id: 'alice', username: 'alice', name: 'alice'}),
  }) as any

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
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          <FollowRequestsScreen />
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    },
  }
}

const queueBackend = () => ({
  family: 'misskey',
  capabilities: {},
  followRequests: jest.fn(async () => [fakeRequest('r1', 'f1'), fakeRequest('r2', 'f2')]),
  acceptFollowRequest: jest.fn(async () => undefined),
  rejectFollowRequest: jest.fn(async () => undefined),
})

describe('FollowRequests screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see follow requests.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('shows an empty state with no requests', async () => {
    const {done} = await setup({
      backend: {...queueBackend(), followRequests: jest.fn(async () => [])},
    })
    try {
      expect(await screen.findByText('No follow requests.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('accepts a request by follower id and removes the row', async () => {
    const backend = queueBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Follower f1')).toBeTruthy()
      fireEvent.press(screen.getByTestId('follow-request-accept-r1'))
      await waitFor(() => expect(backend.acceptFollowRequest).toHaveBeenCalledWith('f1'))
      await waitFor(() => expect(screen.queryByTestId('follow-request-r1')).toBeNull())
      expect(screen.getByTestId('follow-request-r2')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('rejects a request by follower id and removes the row', async () => {
    const backend = queueBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Follower f2')).toBeTruthy()
      fireEvent.press(screen.getByTestId('follow-request-reject-r2'))
      await waitFor(() => expect(backend.rejectFollowRequest).toHaveBeenCalledWith('f2'))
      await waitFor(() => expect(screen.queryByTestId('follow-request-r2')).toBeNull())
    } finally {
      done()
    }
  })

  it('retries after a load failure', async () => {
    const followRequests = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([fakeRequest('r1', 'f1')])
    const {done} = await setup({backend: {...queueBackend(), followRequests}})
    try {
      expect(await screen.findByText('Could not load follow requests.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('follow-requests-retry'))
      expect(await screen.findByText('Follower f1')).toBeTruthy()
    } finally {
      done()
    }
  })
})
