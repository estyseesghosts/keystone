// Drive screen: signed-out, unsupported, file rows with rename +
// sensitivity toggle + two-tap delete, folder section hidden when the
// backend has no folders module and listed with create/rename/delete
// when it does, upload into the selected folder (root by default), and
// the file-detail dialog (`show` metadata + `attached-notes`, including
// honest empty/unsupported states).

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {ApiError, createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {makeMedia, makePost} from '#/components/__tests__/fixtures'

import {DriveScreen} from './Drive'

const mockPickMedia = jest.fn(async (_opts: {limit: number}): Promise<any[]> => [])

jest.mock('#/components/Composer/pickMedia', () => ({
  pickMedia: (opts: {limit: number}) => mockPickMedia(opts),
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
    revokeFetch: (() =>
      Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
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
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          <DriveScreen />
        </SessionProvider>
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

const file = (over: Record<string, unknown> = {}) => makeMedia({id: 'f1', name: 'photo', ...over})

const driveApi = (over: Record<string, unknown> = {}) => ({
  files: jest.fn(async () => ({items: [file()], cursor: null, end: true})),
  showFile: jest.fn(async () => file()),
  attachedNotes: jest.fn(async () => ({items: [], cursor: null, end: true})),
  updateFile: jest.fn(async (id: string, patch: Record<string, unknown>) => ({
    ...file(),
    id,
    ...patch,
  })),
  deleteFile: jest.fn(async () => undefined),
  ...over,
})

const backendWithoutFolders = () => ({
  family: 'misskey',
  capabilities: {drive: 'supported'},
  drive: driveApi(),
  uploadMedia: jest.fn(async (uploaded: any, opts: any = {}) => ({
    ...file(),
    id: 'f9',
    name: uploaded.name,
    folderId: opts.folderId ?? null,
    description: opts.comment ?? null,
  })),
})

const backendWithFolders = () => ({
  family: 'misskey',
  capabilities: {drive: 'supported'},
  drive: driveApi({
    folders: {
      list: jest.fn(async () => [{id: 'd1', name: 'Uploads', parentId: null}]),
      create: jest.fn(async (name: string) => ({
        id: 'd2',
        name,
        parentId: null,
      })),
      update: jest.fn(async (id: string, patch: {name?: string}) => ({
        id,
        name: patch.name ?? 'Uploads',
        parentId: null,
      })),
      delete: jest.fn(async () => undefined),
    },
  }),
  uploadMedia: jest.fn(async (uploaded: any, opts: any = {}) => ({
    ...file(),
    id: 'f9',
    name: uploaded.name,
    folderId: opts.folderId ?? null,
    description: opts.comment ?? null,
  })),
})

describe('Drive screen', () => {
  beforeEach(() => {
    mockPickMedia.mockReset()
    mockPickMedia.mockResolvedValue([])
  })

  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see your drive.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without a drive module', async () => {
    const {done} = await setup({
      backend: {family: 'mastodon', capabilities: {}},
    })
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
        expect(backend.drive.updateFile).toHaveBeenCalledWith('f1', {
          name: 'portrait',
        }),
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
        expect(backend.drive.updateFile).toHaveBeenCalledWith('f1', {
          isSensitive: true,
        }),
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
      // The folder appears twice: once in the scope selector, once as a row.
      expect((await screen.findAllByText('Uploads')).length).toBeGreaterThan(0)
      fireEvent.changeText(screen.getByTestId('drive-folder-create-input'), 'Memes')
      fireEvent.press(screen.getByTestId('drive-folder-create-submit'))
      await waitFor(() => expect(backend.drive.folders.create).toHaveBeenCalledWith('Memes'))
      expect((await screen.findAllByText('Memes')).length).toBeGreaterThan(0)
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
      expect((await screen.findAllByText('Uploads')).length).toBeGreaterThan(0)
      fireEvent.press(screen.getByTestId('drive-folder-rename-d1'))
      fireEvent.changeText(screen.getByTestId('drive-folder-rename-input-d1'), 'Photos')
      fireEvent.press(screen.getByTestId('drive-folder-rename-save-d1'))
      await waitFor(() =>
        expect(backend.drive.folders.update).toHaveBeenCalledWith('d1', {
          name: 'Photos',
        }),
      )
      expect((await screen.findAllByText('Photos')).length).toBeGreaterThan(0)
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

  it('uploads a picked file into the selected folder and refreshes the list', async () => {
    const backend: any = backendWithFolders()
    mockPickMedia.mockResolvedValueOnce([
      {
        file: {name: 'cat.png'} as unknown as File,
        name: 'cat.png',
        previewUri: null,
      },
    ])
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-folder-scope-d1'))
      await waitFor(() =>
        expect(backend.drive.files).toHaveBeenLastCalledWith({
          limit: 20,
          folderId: 'd1',
        }),
      )
      // The target line names the folder, never a guessed one.
      expect(screen.getByText('Uploads go to “Uploads”.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-upload-choose'))
      expect(await screen.findByText('cat.png')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('drive-upload-comment'), 'a cat')
      fireEvent.press(screen.getByTestId('drive-upload-submit'))
      await waitFor(() => expect(backend.uploadMedia).toHaveBeenCalledTimes(1))
      const [fileArg, optsArg] = backend.uploadMedia.mock.calls[0]
      expect(fileArg.name).toBe('cat.png')
      expect(optsArg).toEqual({folderId: 'd1', comment: 'a cat'})
      expect(await screen.findByTestId('drive-upload-success')).toBeTruthy()
      // The list is re-read from the server for the same folder.
      await waitFor(() =>
        expect(backend.drive.files).toHaveBeenLastCalledWith({
          limit: 20,
          folderId: 'd1',
        }),
      )
      expect(
        backend.drive.files.mock.calls.filter((c: any[]) => c[0]?.folderId === 'd1').length,
      ).toBeGreaterThan(1)
    } finally {
      done()
    }
  })

  it('uploads to the root without inventing a folder field', async () => {
    const backend: any = backendWithFolders()
    mockPickMedia.mockResolvedValueOnce([
      {
        file: {name: 'root.png'} as unknown as File,
        name: 'root.png',
        previewUri: null,
      },
    ])
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      expect(screen.getByText('Uploads go to Root.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-upload-choose'))
      expect(await screen.findByText('root.png')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-upload-submit'))
      await waitFor(() => expect(backend.uploadMedia).toHaveBeenCalledTimes(1))
      expect(backend.uploadMedia.mock.calls[0][1]).toEqual({})
    } finally {
      done()
    }
  })

  it('shows an honest upload error and keeps the staged file for retry', async () => {
    const backend: any = backendWithFolders()
    backend.uploadMedia = jest.fn(async () => {
      throw new Error('Quota exceeded.')
    })
    mockPickMedia.mockResolvedValueOnce([
      {
        file: {name: 'big.png'} as unknown as File,
        name: 'big.png',
        previewUri: null,
      },
    ])
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-upload-choose'))
      expect(await screen.findByText('big.png')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-upload-submit'))
      expect(await screen.findByTestId('drive-upload-error')).toBeTruthy()
      expect(screen.getByText('Quota exceeded.')).toBeTruthy()
      // Not cleared, not faked as uploaded.
      expect(screen.getByTestId('drive-upload-submit')).toBeTruthy()
      expect(screen.queryByTestId('drive-upload-success')).toBeNull()
    } finally {
      done()
    }
  })

  it('opens file detail with metadata and the notes that use the file', async () => {
    const backend: any = backendWithFolders()
    backend.drive.showFile = jest.fn(async () =>
      makeMedia({
        id: 'f1',
        name: 'photo',
        kind: 'image',
        mimeType: 'image/png',
        size: 20480,
        createdAt: '2026-10-15T11:59:00.000Z',
        isSensitive: true,
        description: 'a diagram',
        url: 'https://m.example/files/f1.png',
      }),
    )
    backend.drive.attachedNotes = jest.fn(async () => ({
      items: [
        makePost({
          id: 'n1',
          createdAt: '2026-10-16T10:00:00.000Z',
          content: {mfm: 'uses the file', plain: 'uses the file'},
        }),
      ],
      cursor: null,
      end: true,
    }))
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-file-details-f1'))
      expect(await screen.findByTestId('drive-detail')).toBeTruthy()
      await waitFor(() => expect(backend.drive.showFile).toHaveBeenCalledWith('f1'))
      await waitFor(() =>
        expect(backend.drive.attachedNotes).toHaveBeenCalledWith('f1', {
          limit: 10,
        }),
      )
      expect(await screen.findByText('image/png')).toBeTruthy()
      expect(screen.getByText('20 KB')).toBeTruthy()
      expect(screen.getByText('2026-10-15T11:59:00.000Z')).toBeTruthy()
      expect(screen.getByText('Yes')).toBeTruthy()
      expect(screen.getByText('a diagram')).toBeTruthy()
      expect(screen.getByText('https://m.example/files/f1.png')).toBeTruthy()
      expect(await screen.findByText('uses the file')).toBeTruthy()
      expect(screen.queryByTestId('drive-detail-notes-empty')).toBeNull()
    } finally {
      done()
    }
  })

  it('says honestly when no notes use the file', async () => {
    const backend: any = backendWithFolders()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-file-details-f1'))
      expect(await screen.findByTestId('drive-detail')).toBeTruthy()
      expect(await screen.findByTestId('drive-detail-notes-empty')).toBeTruthy()
      expect(screen.getByText('No notes use this file.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('keeps the notes section visible with a reason when the endpoint 404s', async () => {
    const backend: any = backendWithFolders()
    backend.drive.attachedNotes = jest.fn(async () => {
      throw new ApiError('Unknown API endpoint.', 404, 'UNKNOWN_API_ENDPOINT')
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-file-details-f1'))
      expect(await screen.findByTestId('drive-detail-notes-unsupported')).toBeTruthy()
      expect(screen.getByText('Notes using this file')).toBeTruthy()
      // The row's own metadata is still shown — the file is not hidden.
      expect(screen.getByTestId('drive-detail-name')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('falls back to the list values when drive/files/show 404s', async () => {
    const backend: any = backendWithFolders()
    backend.drive.showFile = jest.fn(async () => {
      throw new ApiError('Unknown API endpoint.', 404, 'UNKNOWN_API_ENDPOINT')
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-file-details-f1'))
      expect(await screen.findByTestId('drive-detail-unsupported')).toBeTruthy()
      // The row's values are shown in the dialog (title) and the list.
      expect(screen.getAllByText('photo').length).toBeGreaterThan(0)
    } finally {
      done()
    }
  })

  it('says a folder is empty instead of claiming the drive is', async () => {
    const files = jest.fn(async (opts: any = {}) => ({
      items: opts.folderId ? [] : [file()],
      cursor: null,
      end: true,
    }))
    const backend: any = backendWithFolders()
    backend.drive.files = files
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('photo')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-folder-scope-d1'))
      expect(await screen.findByText('This folder has no files yet.')).toBeTruthy()
    } finally {
      done()
    }
  })
})
