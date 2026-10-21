// Clips screen: signed-out, unsupported, list + navigate, create (with
// the public toggle), rename, and two-tap delete.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ClipsScreen} from './Clips'

const mockNavigate = jest.fn()
const mockGoBack = jest.fn()
const mockRouteParams: {current: {addNoteId?: string} | undefined} = {current: undefined}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useRoute: () => ({params: mockRouteParams.current}),
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

async function setup({backend, params}: {backend?: any; params?: {addNoteId?: string}} = {}) {
  mockNavigate.mockClear()
  mockGoBack.mockClear()
  mockRouteParams.current = params
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
        <ClipsScreen />
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

const fullClips = () => ({
  list: jest.fn(async () => [
    {id: 'c1', name: 'Fun', isPublic: false, notesCount: 3},
    {id: 'c2', name: 'Work', isPublic: true, notesCount: 0},
  ]),
  create: jest.fn(async (name: string, opts?: {isPublic?: boolean}) => ({
    id: 'c3',
    name,
    isPublic: opts?.isPublic ?? false,
  })),
  update: jest.fn(async (id: string, patch: {name: string}) => ({id, name: patch.name})),
  delete: jest.fn(async () => undefined),
})

const fullBackend = () => ({
  family: 'misskey',
  capabilities: {clips: 'supported'},
  clips: fullClips(),
})

describe('Clips screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see your clips.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without a clips module', async () => {
    const {done} = await setup({backend: {family: 'misskey', capabilities: {}}})
    try {
      expect(await screen.findByText('Clips are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('lists rows and navigates to the clip feed', async () => {
    const {done} = await setup({backend: fullBackend()})
    try {
      expect(await screen.findByText('Fun')).toBeTruthy()
      expect(screen.getByText('Work')).toBeTruthy()
      fireEvent.press(screen.getByTestId('clips-open-c1'))
      expect(mockNavigate).toHaveBeenCalledWith('Clip', {id: 'c1'})
    } finally {
      done()
    }
  })

  it('creates a clip with the public flag', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Fun')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('clips-create-input'), 'Local')
      fireEvent.press(screen.getByTestId('clips-create-public'))
      fireEvent.press(screen.getByTestId('clips-create-submit'))
      await waitFor(() => expect(backend.clips.create).toHaveBeenCalledWith('Local', {isPublic: true}))
      expect(await screen.findByText('Local')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('renames a clip inline', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Fun')).toBeTruthy()
      fireEvent.press(screen.getByTestId('clips-rename-c1'))
      fireEvent.changeText(screen.getByTestId('clips-rename-input-c1'), 'Play')
      fireEvent.press(screen.getByTestId('clips-rename-save-c1'))
      await waitFor(() => expect(backend.clips.update).toHaveBeenCalledWith('c1', {name: 'Play'}))
      expect(await screen.findByText('Play')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('deletes only after a two-tap confirm', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Fun')).toBeTruthy()
      fireEvent.press(screen.getByTestId('clips-delete-c1'))
      expect(backend.clips.delete).not.toHaveBeenCalled()
      expect(screen.getByTestId('clips-delete-confirm-c1')).toBeTruthy()
      fireEvent.press(screen.getByTestId('clips-delete-confirm-c1'))
      await waitFor(() => expect(backend.clips.delete).toHaveBeenCalledWith('c1'))
      await waitFor(() => expect(screen.queryByText('Fun')).toBeNull())
    } finally {
      done()
    }
  })

  it('retries after a load failure', async () => {
    const list = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([{id: 'c1', name: 'Fun'}])
    const {done} = await setup({
      backend: {family: 'misskey', capabilities: {clips: 'supported'}, clips: {list}},
    })
    try {
      expect(await screen.findByText('Could not load clips.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('clips-retry'))
      expect(await screen.findByText('Fun')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('files a note into the picked clip and leaves (menu add-note flow)', async () => {
    const addNote = jest.fn(async () => undefined)
    const backend = fullBackend()
    ;(backend.clips as unknown as {addNote: unknown}).addNote = addNote
    const {done} = await setup({backend, params: {addNoteId: 'n9'}})
    try {
      expect(await screen.findByText('Choose a clip for this post.')).toBeTruthy()
      fireEvent.press(await screen.findByTestId('clips-add-c1'))
      await waitFor(() => expect(addNote).toHaveBeenCalledWith('c1', 'n9'))
      await waitFor(() => expect(mockGoBack).toHaveBeenCalled())
    } finally {
      done()
    }
  })
})
