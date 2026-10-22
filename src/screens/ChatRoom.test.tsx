// ChatRoom screen: signed-out, unsupported, thread history from domain
// models only, text send, and own-message delete with confirm. Fetching
// the timeline IS the server-side read mark — there is no mark control.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ChatRoomScreen} from './ChatRoom'

const mockNavigate = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate}),
  useRoute: () => ({params: {roomId: 'r1'}}),
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

const message = (id: string, fromAccountId: string, text = 'hello') => ({
  id,
  fromAccountId,
  fromAccount:
    fromAccountId === 'alice'
      ? {id: 'alice', acct: 'alice@mk.example', displayName: 'Alice'}
      : {id: fromAccountId, acct: 'bob@mk.example', displayName: 'Bob'},
  toRoomId: 'r1',
  text,
})

const fullBackend = (chat: any = {}) => ({
  family: 'misskey',
  capabilities: {direct_messages: 'supported'},
  chat: {
    showRoom: jest.fn(async (roomId: string) => ({id: roomId, name: 'General'})),
    roomMessages: jest.fn(async () => ({items: [], cursor: null, end: true})),
    sendToRoom: jest.fn(async () => ({id: 'sent'})),
    deleteMessage: jest.fn(async () => undefined),
    ...chat,
  },
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
          <ChatRoomScreen />
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

describe('ChatRoom screen', () => {
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

  it('shows the room thread from domain models and sends text', async () => {
    const backend = fullBackend({
      roomMessages: jest.fn(async () => ({
        items: [message('msg1', 'bob', 'first hello'), message('msg2', 'alice', 'second hello')],
        cursor: null,
        end: true,
      })),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('first hello')).toBeTruthy()
      expect(screen.getByText('second hello')).toBeTruthy()
      expect(backend.chat.roomMessages).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({limit: 20}),
      )
      fireEvent.changeText(screen.getByTestId('chat-room-input'), 'hey room')
      fireEvent.press(screen.getByTestId('chat-room-send'))
      await waitFor(() => expect(backend.chat.sendToRoom).toHaveBeenCalledWith('r1', 'hey room'))
    } finally {
      done()
    }
  })

  it('deletes an own message with a confirm step', async () => {
    const backend = fullBackend({
      roomMessages: jest.fn(async () => ({
        items: [message('msg2', 'alice')],
        cursor: null,
        end: true,
      })),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('chat-delete-msg2')).toBeTruthy()
      fireEvent.press(screen.getByTestId('chat-delete-msg2'))
      expect(screen.getByTestId('chat-delete-confirm-msg2')).toBeTruthy()
      expect(backend.chat.deleteMessage).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('chat-delete-confirm-msg2'))
      await waitFor(() => expect(backend.chat.deleteMessage).toHaveBeenCalledWith('msg2'))
    } finally {
      done()
    }
  })

  it('offers no delete on others’ messages', async () => {
    const backend = fullBackend({
      roomMessages: jest.fn(async () => ({
        items: [message('msg1', 'bob')],
        cursor: null,
        end: true,
      })),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('hello')).toBeTruthy()
      expect(screen.queryByTestId('chat-delete-msg1')).toBeNull()
    } finally {
      done()
    }
  })
})
