// Channels index screen: signed-out, unsupported/unknown capability, the
// directory rows, navigation into the channel feed, and the honest empty
// state. The list runs through the real backend seam (a fake `channels`
// module), so the capability gate is genuinely exercised.

import {fireEvent, render, screen} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ChannelsScreen} from './Channels'

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
        <ChannelsScreen />
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

const fullBackend = (channels: any = {}) => ({
  family: 'misskey',
  capabilities: {channels: 'supported'},
  channels: {
    list: jest.fn(async () => ({
      items: [
        {id: 'ch1', name: 'General', description: 'Anything goes', notesCount: 4},
        {id: 'ch2', name: 'Art', isFollowing: true},
      ],
      cursor: null,
      end: true,
    })),
    show: jest.fn(),
    notes: jest.fn(async () => ({items: [], cursor: null, end: true})),
    followed: jest.fn(async () => ({items: [], cursor: null, end: true})),
    follow: jest.fn(async () => undefined),
    unfollow: jest.fn(async () => undefined),
    ...channels,
  },
})

describe('Channels screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see channels.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without a channels module', async () => {
    const {done} = await setup({backend: {family: 'mastodon', capabilities: {}}})
    try {
      expect(await screen.findByText('Channels are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('does not unlock an unknown capability even when the module exists', async () => {
    const {done} = await setup({
      backend: {family: 'misskey', capabilities: {channels: 'unknown'}, channels: fullBackend().channels},
    })
    try {
      expect(await screen.findByText('Channels are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('mine tab shows followed channels by default', async () => {
    const backend = fullBackend({
      followed: jest.fn(async () => ({
        items: [{id: 'chF', name: 'Following', isFollowing: true}],
        cursor: null,
        end: true,
      })),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Following')).toBeTruthy()
      expect(backend.channels.followed).toHaveBeenCalledWith({limit: 20})
      expect(backend.channels.list).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('server tab shows the whole directory and opens the detail feed', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      // Mine is empty by default (followed stub returns no items).
      expect(await screen.findByText('You are not following any channels yet.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('channels-tab-server'))
      expect(await screen.findByText('General')).toBeTruthy()
      expect(screen.getByText('Anything goes')).toBeTruthy()
      expect(screen.getByText('Art')).toBeTruthy()
      expect(backend.channels.list).toHaveBeenCalledWith({limit: 20})
      fireEvent.press(screen.getByTestId('channels-open-ch1'))
      expect(mockNavigate).toHaveBeenCalledWith('Channel', {id: 'ch1'})
    } finally {
      done()
    }
  })

  it('mine empty state links to the server tab', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('channels-browse-server')).toBeTruthy()
      fireEvent.press(screen.getByTestId('channels-browse-server'))
      expect(await screen.findByText('General')).toBeTruthy()
      expect(backend.channels.list).toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('separates channel rows', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      fireEvent.press(screen.getByTestId('channels-tab-server'))
      expect(await screen.findByText('General')).toBeTruthy()
      // Two rows, one rule between them.
      expect(screen.getAllByTestId('channels-sep')).toHaveLength(1)
    } finally {
      done()
    }
  })

  it('says so when the server has no channels', async () => {
    const backend = fullBackend({
      list: jest.fn(async () => ({items: [], cursor: null, end: true})),
    })
    const {done} = await setup({backend})
    try {
      fireEvent.press(screen.getByTestId('channels-tab-server'))
      expect(await screen.findByText('No channels found on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('offers a retry when the listing fails', async () => {
    const backend = fullBackend({
      followed: jest.fn(async () => {
        throw new Error('boom')
      }),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Could not load channels.')).toBeTruthy()
      expect(screen.getByTestId('channels-retry')).toBeTruthy()
    } finally {
      done()
    }
  })
})
