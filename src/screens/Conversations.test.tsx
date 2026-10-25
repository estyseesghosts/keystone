// Conversations (DM inbox) screen: signed-out, unsupported/unknown
// capability, rows with unread state, opening a thread, two-step delete,
// and the honest empty state. Data runs through the session-scoped
// conversation queries, so the capability gate is genuinely exercised.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore, ApiError} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ConversationsScreen} from './Conversations'

const mockNavigate = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate}),
  useRoute: () => ({params: {}}),
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

function testClient() {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

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
      family: 'mastodon',
      flavor: 'mastodon',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'password',
      hosting: 'third-party',
    })
  }
  const client = testClient()
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme="light">
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          <ConversationsScreen />
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
      client.clear()
    },
  }
}

const account = (over: Record<string, unknown> = {}) => ({
  id: 'a-bob',
  username: 'bob',
  acct: 'bob@example.social',
  host: 'example.social',
  displayName: 'Bob',
  ...over,
})

const conv = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  accounts: [account()],
  lastPost: {id: 's1', content: {plain: 'hey there'}},
  unread: true,
  ...over,
})

const fullBackend = (conversations: any = {}) => ({
  family: 'mastodon',
  capabilities: {direct_messages: 'supported'},
  conversations: {
    list: jest.fn(async () => ({items: [conv()], cursor: null, end: true})),
    get: jest.fn(async (id: string) => conv({id})),
    delete: jest.fn(async () => undefined),
    markRead: jest.fn(async (id: string) => conv({id, unread: false})),
    ...conversations,
  },
})

describe('Conversations screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to read your messages.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without a conversations module', async () => {
    const {done} = await setup({backend: {family: 'mastodon', capabilities: {}}})
    try {
      expect(await screen.findByText('Messages are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('does not unlock an unknown capability even when the module exists', async () => {
    const {done} = await setup({
      backend: {
        family: 'mastodon',
        capabilities: {direct_messages: 'unknown'},
        conversations: fullBackend().conversations,
      },
    })
    try {
      expect(await screen.findByText('Messages are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('lists conversations with unread state and opens the thread', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Bob')).toBeTruthy()
      expect(screen.getByText('hey there')).toBeTruthy()
      expect(screen.getByText('Unread')).toBeTruthy()
      expect(backend.conversations.list).toHaveBeenCalledWith(
        expect.objectContaining({limit: 20}),
      )
      fireEvent.press(screen.getByTestId('conversations-open-c1'))
      expect(mockNavigate).toHaveBeenCalledWith('Conversation', {id: 'c1'})
    } finally {
      done()
    }
  })

  it('deletes with a confirm step, never a one-tap destroy', async () => {
    const deleted = new Set<string>()
    const backend = fullBackend({
      list: jest.fn(async () => ({
        items: deleted.has('c1') ? [] : [conv()],
        cursor: null,
        end: true,
      })),
      delete: jest.fn(async (id: string) => {
        deleted.add(id)
      }),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Bob')).toBeTruthy()
      fireEvent.press(screen.getByTestId('conversations-delete-c1'))
      // Two-step: the row asks first.
      expect(screen.getByTestId('conversations-confirm-c1')).toBeTruthy()
      // X9.2: the confirm chrome renders translated (English source catalog).
      expect(screen.getByText('Delete conversation')).toBeTruthy()
      expect(backend.conversations.delete).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('conversations-confirm-c1'))
      await screen.findByText('No conversations yet.')
      expect(backend.conversations.delete).toHaveBeenCalledWith('c1')
    } finally {
      done()
    }
  })

  it('says so when the server has no conversations', async () => {
    const backend = fullBackend({
      list: jest.fn(async () => ({items: [], cursor: null, end: true})),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('No conversations yet.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('offers a retry when the listing fails', async () => {
    const backend = fullBackend({
      list: jest.fn(async () => {
        throw new Error('boom')
      }),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Could not load messages.')).toBeTruthy()
      expect(screen.getByTestId('conversations-retry')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('a failed page never refires: 20 scroll events = 0 extra requests (X3.3)', async () => {
    const throttled = new ApiError('throttled', 429, 'errors.network.apiError', 'http', {
      retryAfter: '30',
      retryAfterMs: 30_000,
    })
    const list = jest
      .fn()
      .mockResolvedValueOnce({items: [conv()], cursor: 'c1', end: false})
      .mockRejectedValueOnce(throttled)
      .mockResolvedValue({items: [], cursor: null, end: true})
    const backend = fullBackend({list})
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Bob')).toBeTruthy()
      const first = screen.getByTestId('conversations-list')
      ;(first.props as {onEndReached: () => void}).onEndReached()
      expect(await screen.findByTestId('conversations-more-retry')).toBeTruthy()
      expect(list).toHaveBeenCalledTimes(2)
      // The 429 cooldown is visible while the loaded row stays mounted.
      expect(screen.getByTestId('conversations-more-cooldown')).toBeTruthy()
      for (let i = 0; i < 20; i++) {
        const scrolled = screen.getByTestId('conversations-list')
        ;(scrolled.props as {onEndReached: () => void}).onEndReached()
      }
      expect(list).toHaveBeenCalledTimes(2)
      // Only the explicit Retry fetches again (the loaded row stays; the
      // new empty page just ends the feed).
      fireEvent.press(screen.getByTestId('conversations-more-retry'))
      await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
      // The successful retry clears the error: wait for the footer to
      // settle away rather than asserting synchronously mid-flush.
      await waitFor(() => expect(screen.queryByTestId('conversations-more-retry')).toBeNull())
    } finally {
      done()
    }
  })
})
