// Antennas screen: signed-out, unsupported, list + navigate, create
// (name + source + keywords), rename, and two-tap delete.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {AntennasScreen} from './Antennas'

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
        <AntennasScreen />
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

const antenna = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  name: 'Cats',
  src: 'all',
  userListId: null,
  keywords: [['cat', 'kitten']],
  excludeKeywords: [],
  users: [],
  caseSensitive: false,
  localOnly: false,
  excludeBots: false,
  withReplies: false,
  withFile: false,
  ...over,
})

const fullAntennas = () => ({
  list: jest.fn(async () => [antenna(), antenna({id: 'a2', name: 'Dogs', keywords: [['dog']]})]),
  create: jest.fn(async (body: Record<string, unknown>) => ({...body, id: 'a3'})),
  update: jest.fn(async (id: string, body: Record<string, unknown>) => ({...body, id})),
  delete: jest.fn(async () => undefined),
  notes: jest.fn(async () => ({items: [], cursor: null, end: true})),
})

const fullBackend = () => ({
  family: 'misskey',
  capabilities: {antennas: 'supported'},
  antennas: fullAntennas(),
})

describe('Antennas screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see your antennas.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without an antennas module', async () => {
    const {done} = await setup({backend: {family: 'mastodon', capabilities: {}}})
    try {
      expect(await screen.findByText('Antennas are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('lists rows and navigates to the antenna feed', async () => {
    const {done} = await setup({backend: fullBackend()})
    try {
      expect(await screen.findByText('Cats')).toBeTruthy()
      expect(screen.getByText('Dogs')).toBeTruthy()
      fireEvent.press(screen.getByTestId('antennas-open-a1'))
      expect(mockNavigate).toHaveBeenCalledWith('Antenna', {id: 'a1'})
    } finally {
      done()
    }
  })

  it('creates an antenna from name + source + keywords', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Cats')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('antennas-create-input'), 'Birds')
      fireEvent.press(screen.getByTestId('antennas-src-home'))
      fireEvent.changeText(screen.getByTestId('antennas-create-keywords'), 'sparrow hawk')
      fireEvent.press(screen.getByTestId('antennas-create-submit'))
      await waitFor(() =>
        expect(backend.antennas.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Birds',
            src: 'home',
            keywords: [['sparrow', 'hawk']],
          }),
        ),
      )
      expect(await screen.findByText('Birds')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('renames an antenna inline', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Cats')).toBeTruthy()
      fireEvent.press(screen.getByTestId('antennas-rename-a1'))
      fireEvent.changeText(screen.getByTestId('antennas-rename-input-a1'), 'Kittens')
      fireEvent.press(screen.getByTestId('antennas-rename-save-a1'))
      await waitFor(() =>
        expect(backend.antennas.update).toHaveBeenCalledWith(
          'a1',
          expect.objectContaining({name: 'Kittens'}),
        ),
      )
      expect(await screen.findByText('Kittens')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('deletes only after a two-tap confirm', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Cats')).toBeTruthy()
      fireEvent.press(screen.getByTestId('antennas-delete-a1'))
      expect(backend.antennas.delete).not.toHaveBeenCalled()
      expect(screen.getByTestId('antennas-delete-confirm-a1')).toBeTruthy()
      fireEvent.press(screen.getByTestId('antennas-delete-confirm-a1'))
      await waitFor(() => expect(backend.antennas.delete).toHaveBeenCalledWith('a1'))
      await waitFor(() => expect(screen.queryByText('Cats')).toBeNull())
    } finally {
      done()
    }
  })

  it('retries after a load failure', async () => {
    const list = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([antenna()])
    const {done} = await setup({
      backend: {family: 'misskey', capabilities: {antennas: 'supported'}, antennas: {list}},
    })
    try {
      expect(await screen.findByText('Could not load antennas.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('antennas-retry'))
      expect(await screen.findByText('Cats')).toBeTruthy()
    } finally {
      done()
    }
  })
})
