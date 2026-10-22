// Channel detail screen: signed-out, unsupported, name/description + the
// channel feed, follow/unfollow toggling, an unknown follow state that is
// disabled WITH a reason, the archived caption, and the honest missing
// channel state (Misskey answers `NO_SUCH_CHANNEL`, not 404).

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {ApiError, createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {makePost} from '#/components/__tests__/fixtures'

import {ChannelScreen} from './Channel'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: {id: 'ch1'}}),
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
  i18n.load('en', {})
  i18n.activate('en')
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
            <ChannelScreen />
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    },
  }
}

const post = makePost({id: 'p1', content: {mfm: 'channel post', plain: 'channel post'}})

const channel = (overrides: Record<string, unknown> = {}) => ({
  id: 'ch1',
  name: 'General',
  description: 'Anything goes',
  isFollowing: false,
  ...overrides,
})

const fullBackend = (overrides: Record<string, unknown> = {}) => ({
  family: 'misskey',
  capabilities: {channels: 'supported'},
  channels: {
    list: jest.fn(),
    show: jest.fn(async () => channel()),
    notes: jest.fn(async () => ({items: [post], cursor: null, end: true})),
    followed: jest.fn(async () => ({items: [], cursor: null, end: true})),
    follow: jest.fn(async () => undefined),
    unfollow: jest.fn(async () => undefined),
    ...overrides,
  },
})

describe('Channel screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see this channel.')).toBeTruthy()
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

  it('shows the channel header and its notes', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('General')).toBeTruthy()
      expect(screen.getByText('Anything goes')).toBeTruthy()
      expect(await screen.findByText('channel post')).toBeTruthy()
      expect(backend.channels.show).toHaveBeenCalledWith('ch1')
      expect(backend.channels.notes).toHaveBeenCalledWith('ch1', expect.anything())
    } finally {
      done()
    }
  })

  it('follows a channel and reflects the new state', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      const button = await screen.findByTestId('channel-follow')
      expect(screen.getByText('Follow')).toBeTruthy()
      fireEvent.press(button)
      expect(backend.channels.follow).toHaveBeenCalledWith('ch1')
      expect(await screen.findByText('Unfollow')).toBeTruthy()
      expect(backend.channels.unfollow).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('unfollows a channel the viewer already follows', async () => {
    const backend = fullBackend({show: jest.fn(async () => channel({isFollowing: true}))})
    const {done} = await setup({backend})
    try {
      const button = await screen.findByTestId('channel-follow')
      expect(screen.getByText('Unfollow')).toBeTruthy()
      fireEvent.press(button)
      expect(backend.channels.unfollow).toHaveBeenCalledWith('ch1')
      expect(await screen.findByText('Follow')).toBeTruthy()
      expect(backend.channels.follow).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('disables the follow toggle with a reason when the state is unreported', async () => {
    const backend = fullBackend({show: jest.fn(async () => channel({isFollowing: null}))})
    const {done} = await setup({backend})
    try {
      const button = await screen.findByTestId('channel-follow')
      expect(button.props.accessibilityState?.disabled).toBe(true)
      // The reason rides the accessible label (no inert control).
      expect(String(button.props.accessibilityLabel)).toContain(
        'This server does not report whether you follow this channel.',
      )
      fireEvent.press(button)
      expect(backend.channels.follow).not.toHaveBeenCalled()
      expect(backend.channels.unfollow).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('flags an archived channel without hiding the feed', async () => {
    const backend = fullBackend({show: jest.fn(async () => channel({isArchived: true}))})
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('This channel is archived.')).toBeTruthy()
      expect(await screen.findByText('channel post')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honest when the channel does not exist (NO_SUCH_CHANNEL)', async () => {
    const backend = fullBackend({
      show: jest.fn(async () => {
        throw new ApiError('No such channel.', 400, 'NO_SUCH_CHANNEL')
      }),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('This channel does not exist.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('offers a retry when loading fails', async () => {
    const backend = fullBackend({
      show: jest.fn(async () => {
        throw new Error('boom')
      }),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Could not load this channel.')).toBeTruthy()
      expect(screen.getByTestId('channel-retry')).toBeTruthy()
    } finally {
      done()
    }
  })
})
