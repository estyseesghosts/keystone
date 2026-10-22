// ChatRooms screen: signed-out, unsupported (no chat module / gated
// capability / old-server 404), the room list from domain models only,
// and the mark-all-read sweep. SessionId-first queries keep accounts
// apart.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ChatRoomsScreen} from './ChatRooms'

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
const ORIGIN = 'https://mk.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function testClient() {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

const membership = (id: string, roomId: string, name: string) => ({
  id,
  roomId,
  room: {
    id: roomId,
    name,
    description: null,
    ownerId: 'o1',
    owner: {id: 'o1', acct: 'owner@mk.example', displayName: 'Owner'},
    isMuted: false,
  },
})

const fullBackend = (chat: any = {}, extra: any = {}) => ({
  family: 'misskey',
  capabilities: {direct_messages: 'supported'},
  chat: {
    rooms: jest.fn(async () => ({items: [], cursor: null, end: true})),
    history: jest.fn(async () => []),
    showRoom: jest.fn(async (roomId: string) => ({id: roomId, name: roomId})),
    createRoom: jest.fn(async (name: string) => ({id: 'new', name})),
    roomMessages: jest.fn(async () => ({items: [], cursor: null, end: true})),
    userMessages: jest.fn(async () => ({items: [], cursor: null, end: true})),
    showMessage: jest.fn(async (id: string) => ({id})),
    sendToRoom: jest.fn(async () => ({id: 'sent'})),
    sendToUser: jest.fn(async () => ({id: 'sent'})),
    deleteMessage: jest.fn(async () => undefined),
    readAll: jest.fn(async () => undefined),
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
      flavor: 'sharkey',
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
          <ChatRoomsScreen />
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

describe('ChatRooms screen', () => {
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

  it('lists rooms from domain models and opens the thread', async () => {
    const backend = fullBackend({
      rooms: jest.fn(async () => ({
        items: [membership('m1', 'r1', 'General')],
        cursor: null,
        end: true,
      })),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('General')).toBeTruthy()
      expect(backend.chat.rooms).toHaveBeenCalledWith(expect.objectContaining({limit: 20}))
      fireEvent.press(screen.getByTestId('chatrooms-open-r1'))
      expect(mockNavigate).toHaveBeenCalledWith('ChatRoom', {roomId: 'r1'})
    } finally {
      done()
    }
  })

  it('marks all read through a confirmed sweep', async () => {
    const backend = fullBackend({
      rooms: jest.fn(async () => ({
        items: [membership('m1', 'r1', 'General')],
        cursor: null,
        end: true,
      })),
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('chatrooms-readall')).toBeTruthy()
      fireEvent.press(screen.getByTestId('chatrooms-readall'))
      // Two-step: the first tap only arms the confirm.
      expect(backend.chat.readAll).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('chatrooms-readall-confirm'))
      await waitFor(() => expect(backend.chat.readAll).toHaveBeenCalled())
    } finally {
      done()
    }
  })
})
