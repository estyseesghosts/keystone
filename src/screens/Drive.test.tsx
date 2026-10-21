// Drive screen: signed-out, unsupported, file rows with rename +
// sensitivity toggle + two-tap delete, folder section hidden when the
// backend has no folders module and listed with create/rename/delete
// when it does. No upload UI: the composer owns uploads.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {makeMedia} from '#/components/__tests__/fixtures'

import {DriveScreen} from './Drive'

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
  render(
    <ThemeProvider theme="light">
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        <DriveScreen />
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

const file = (over: Record<string, unknown> = {}) => makeMedia({id: 'f1', name: 'photo', ...over})

const driveApi = (over: Record<string, unknown> = {}) => ({
  files: jest.fn(async () => ({items: [file()], cursor: null, end: true})),
  updateFile: jest.fn(async (id: string, patch: Record<string, unknown>) => ({...file(), id, ...patch})),
  deleteFile: jest.fn(async () => undefined),
  ...over,
})

const backendWithoutFolders = () => ({
  family: 'misskey',
  capabilities: {drive: 'supported'},
  drive: driveApi(),
})

const backendWithFolders = () => ({
  family: 'misskey',
  capabilities: {drive: 'supported'},
  drive: driveApi({
    folders: {
      list: jest.fn(async () => [{id: 'd1', name: 'Uploads', parentId: null}]),
      create: jest.fn(async (name: string) => ({id: 'd2', name, parentId: null})),
      update: jest.fn(async (id: string, patch: {name?: string}) => ({
        id,
        name: patch.name ?? 'Uploads',
        parentId: null,
      })),
      delete: jest.fn(async () => undefined),
    },
  }),
})

describe('Drive screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see your drive.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without a drive module', async () => {
    const {done} = await setup({backend: {family: 'mastodon', capabilities: {}}})
    try {
      expect(await screen.findByText('Drive is not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('lists files and hides the folder section when folders are unsupported', async () => {
    const {done} = await setup({backend: backendWithoutFolders()})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      expect(screen.queryByTestId('drive-folders')).toBeNull()
    } finally {
      done()
    }
  })

  it('renames a file inline', async () => {
    const backend = backendWithoutFolders()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-file-rename-f1'))
      fireEvent.changeText(screen.getByTestId('drive-file-rename-input-f1'), 'portrait')
      fireEvent.press(screen.getByTestId('drive-file-rename-save-f1'))
      await waitFor(() =>
        expect(backend.drive.updateFile).toHaveBeenCalledWith('f1', {name: 'portrait'}),
      )
      expect(await screen.findByText('portrait')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('toggles sensitivity and deletes only after a two-tap confirm', async () => {
    const backend = backendWithoutFolders()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-file-sensitive-f1'))
      await waitFor(() =>
        expect(backend.drive.updateFile).toHaveBeenCalledWith('f1', {isSensitive: true}),
      )
      fireEvent.press(screen.getByTestId('drive-file-delete-f1'))
      expect(backend.drive.deleteFile).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('drive-file-delete-confirm-f1'))
      await waitFor(() => expect(backend.drive.deleteFile).toHaveBeenCalledWith('f1'))
      await waitFor(() => expect(screen.queryByText('photo')).toBeNull())
    } finally {
      done()
    }
  })

  it('lists folders with create and delete when supported', async () => {
    const backend: any = backendWithFolders()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Uploads')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('drive-folder-create-input'), 'Memes')
      fireEvent.press(screen.getByTestId('drive-folder-create-submit'))
      await waitFor(() => expect(backend.drive.folders.create).toHaveBeenCalledWith('Memes'))
      expect(await screen.findByText('Memes')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-folder-delete-d2'))
      fireEvent.press(screen.getByTestId('drive-folder-delete-confirm-d2'))
      await waitFor(() => expect(backend.drive.folders.delete).toHaveBeenCalledWith('d2'))
      await waitFor(() => expect(screen.queryByText('Memes')).toBeNull())
    } finally {
      done()
    }
  })

  it('renames a folder inline', async () => {
    const backend: any = backendWithFolders()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Uploads')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-folder-rename-d1'))
      fireEvent.changeText(screen.getByTestId('drive-folder-rename-input-d1'), 'Photos')
      fireEvent.press(screen.getByTestId('drive-folder-rename-save-d1'))
      await waitFor(() =>
        expect(backend.drive.folders.update).toHaveBeenCalledWith('d1', {name: 'Photos'}),
      )
      expect(await screen.findByText('Photos')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('retries after a load failure', async () => {
    const files = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({items: [file()], cursor: null, end: true})
    const {done} = await setup({
      backend: {
        family: 'misskey',
        capabilities: {drive: 'supported'},
        drive: {files, updateFile: jest.fn(), deleteFile: jest.fn()},
      },
    })
    try {
      expect(await screen.findByText('Could not load drive.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-retry'))
      expect(await screen.findByText('photo')).toBeTruthy()
    } finally {
      done()
    }
  })
})
