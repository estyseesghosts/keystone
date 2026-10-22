// ChatUser screen: signed-out, unsupported, the 1-on-1 thread from
// domain models only, text send with the self-send refusal, and no title
// guess before the account fetch lands.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ChatUserScreen} from './ChatUser'

const mockNavigate = jest.fn()

const mockRouteHolder: {params: {userId: string}} = {params: {userId: 'u9'}}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate}),
  useRoute: () => ({params: mockRouteHolder.params}),
}))

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

const HOME_ORIGIN = 'https://app.example'
const ORIGIN = 'https://mk.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function testClient() {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

const fullBackend = (chat: any = {}, extra: any = {}) => ({
  family: 'misskey',
  capabilities: {direct_messages: 'supported'},
  account: jest.fn(async ({id}: {id: string}) => ({
    id,
    acct: 'bob@mk.example',
    displayName: 'Bob',
  })),
  chat: {
    userMessages: jest.fn(async () => ({items: [], cursor: null, end: true})),
    sendToUser: jest.fn(async () => ({id: 'sent'})),
    deleteMessage: jest.fn(async () => undefined),
    ...chat,
  },
  ...extra,
})

async function setup({backend}: {backend?: any} = {}) {
  mockNavigate.mockClear()
  const restore = appStorage()
  __setStorageForTests({storage: createMemoryStore()})
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
  const client = testClient()
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme="light">
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          <ChatUserScreen />
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

describe('ChatUser screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to read your chats.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without a chat module', async () => {
    const {done} = await setup({backend: {family: 'misskey', capabilities: {}}})
    try {
      expect(await screen.findByText('Chat is not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('pages the 1-on-1 thread and sends text', async () => {
    const backend = fullBackend({
      userMessages: jest.fn(async () => ({
        items: [{id: 'msg1', fromAccountId: 'u9', fromAccount: null, toUserId: 'alice', text: 'hi'}],
        cursor: null,
        end: true,
      })),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('hi')).toBeTruthy()
      expect(backend.chat.userMessages).toHaveBeenCalledWith(
        'u9',
        expect.objectContaining({limit: 20}),
      )
      fireEvent.changeText(screen.getByTestId('chat-user-input'), 'hey you')
      fireEvent.press(screen.getByTestId('chat-user-send'))
      await waitFor(() => expect(backend.chat.sendToUser).toHaveBeenCalledWith('u9', 'hey you'))
    } finally {
      done()
    }
  })

  it('refuses a self-send before any network I/O', async () => {
    mockRouteHolder.params = {userId: 'alice'}
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('chat-user-input')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('chat-user-input'), 'hey me')
      fireEvent.press(screen.getByTestId('chat-user-send'))
      await waitFor(() =>
        expect(screen.getByText('You cannot send a message to yourself.')).toBeTruthy(),
      )
      expect(backend.chat.sendToUser).not.toHaveBeenCalled()
    } finally {
      mockRouteHolder.params = {userId: 'u9'}
      done()
    }
  })
})
