// Conversation thread screen: signed-out, unavailable, the participant
// header, ancestors + last post from domain models only, reply through the
// existing composer path, and delete-then-back. Mark-read fires once the
// thread loads (the server owns the flag; the cache only refetches).

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ConversationScreen} from './Conversation'

const mockNavigate = jest.fn()
const mockGoBack = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useRoute: () => ({params: {id: 'c1'}}),
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

const lastPost = (over: Record<string, unknown> = {}) => ({
  id: 's3',
  content: {plain: 'latest reply'},
  author: {id: 'a-bob', acct: 'bob@example.social', displayName: 'Bob'},
  ...over,
})

const fullBackend = (conversations: any = {}, extra: any = {}) => ({
  family: 'mastodon',
  capabilities: {direct_messages: 'supported'},
  conversations: {
    list: jest.fn(async () => ({items: [], cursor: null, end: true})),
    get: jest.fn(async (id: string) => ({
      id,
      accounts: [{id: 'a-bob', acct: 'bob@example.social', displayName: 'Bob'}],
      lastPost: lastPost(),
      unread: true,
    })),
    delete: jest.fn(async () => undefined),
    markRead: jest.fn(async (id: string) => ({id, unread: false})),
    ...conversations,
  },
  thread: jest.fn(async () => ({
    ancestors: [
      lastPost({id: 's1', content: {plain: 'first hello'}}),
      lastPost({id: 's2', content: {plain: 'second hello'}}),
    ],
    incomplete: false,
  })),
  ...extra,
})

async function setup({backend}: {backend?: any} = {}) {
  mockNavigate.mockClear()
  mockGoBack.mockClear()
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
          <ConversationScreen />
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

describe('Conversation screen', () => {
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

  it('shows participants, history, and the latest post', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      // The chain renders oldest-first: ancestors, then the latest post.
      expect(await screen.findByText('first hello')).toBeTruthy()
      expect(screen.getByText('second hello')).toBeTruthy()
      expect(screen.getByText('latest reply')).toBeTruthy()
      // Participants + per-post authors (Pagehead carries the title on
      // wider layouts, captions everywhere).
      expect(screen.getAllByText('Bob').length).toBeGreaterThan(0)
      expect(backend.conversations.get).toHaveBeenCalledWith('c1')
    } finally {
      done()
    }
  })

  it('marks the thread read once it loads', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      await screen.findByText('latest reply')
      expect(backend.conversations.markRead).toHaveBeenCalledWith('c1')
    } finally {
      done()
    }
  })

  it('replies through the composer with the last post as context', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('conversation-reply')).toBeTruthy()
      fireEvent.press(screen.getByTestId('conversation-reply'))
      // The existing status-post path: a reply to the last post. The
      // composer already defaults a direct parent to direct + recipients.
      expect(mockNavigate).toHaveBeenCalledWith('Compose', {replyToId: 's3'})
    } finally {
      done()
    }
  })

  it('deletes with a confirm step and goes back', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('conversation-delete')).toBeTruthy()
      fireEvent.press(screen.getByTestId('conversation-delete'))
      expect(screen.getByTestId('conversation-confirm-delete')).toBeTruthy()
      expect(backend.conversations.delete).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('conversation-confirm-delete'))
      await waitFor(() => expect(backend.conversations.delete).toHaveBeenCalledWith('c1'))
      expect(mockGoBack).toHaveBeenCalled()
    } finally {
      done()
    }
  })
})
