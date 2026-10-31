// Drive browser (P6.6 slice 5): route-driven folder, breadcrumbs,
// sort gating, usage, detail actions, folder delete walk, move-to
// validation, unsupported states. QueryClient-backed; no network.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {ApiError, createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {makeMedia} from '#/components/__tests__/fixtures'

import {DriveScreen, walkFolderTree} from './Drive'

const mockPickMedia = jest.fn(async (_opts: {limit: number}): Promise<any> => ({kind: 'cancelled'}))
const mockRouteParams: {current: {folderId?: string} | undefined} = {current: undefined}

jest.mock('#/components/Composer/pickMedia', () => ({
  pickMedia: (opts: {limit: number}) => mockPickMedia(opts),
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: mockRouteParams.current}),
  useNavigation: () => ({navigate: jest.fn(), goBack: jest.fn()}),
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

async function setup({backend, folderId}: {backend?: any; folderId?: string} = {}) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = backend ?? null
  mockRouteParams.current = folderId ? {folderId} : undefined
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
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
            <DriveScreen />
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
      mockRouteParams.current = undefined
    },
  }
}

const file = (over: Record<string, unknown> = {}) => makeMedia({id: 'f1', name: 'photo.png', ...over})
const folder = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  name: 'Photos',
  parentId: null,
  ...over,
})

const driveApi = (over: Record<string, unknown> = {}) => ({
  files: jest.fn(async (_opts?: unknown) => ({items: [file()], cursor: null, end: true})),
  showFile: jest.fn(async () => file()),
  attachedNotes: jest.fn(async () => ({items: [], cursor: null, end: true})),
  updateFile: jest.fn(async (id: string, patch: Record<string, unknown>) => ({...file(), id, ...patch})),
  deleteFile: jest.fn(async () => undefined),
  moveMany: jest.fn(async () => undefined),
  isSortSupported: jest.fn(() => true as boolean | null),
  isMoveBulkSupported: jest.fn(() => true as boolean | null),
  usage: jest.fn(async () => ({capacity: 100, usage: 40})),
  folders: {
    list: jest.fn(async (_opts?: unknown) => ({items: [folder()], cursor: null, end: true})),
    show: jest.fn(async (id: string) => ({
      folder: folder({id, name: 'Photos', parentId: null}),
      path: [folder({id, name: 'Photos', parentId: null})],
      filesCount: null,
      foldersCount: null,
    })),
    create: jest.fn(async (name: string) => folder({id: 'd9', name})),
    update: jest.fn(async (id: string, patch: Record<string, unknown>) => folder({id, ...patch})),
    delete: jest.fn(async () => undefined),
  },
  ...over,
})

const fullBackend = (over: Record<string, unknown> = {}) => ({
  family: 'misskey',
  capabilities: {drive: 'supported'},
  drive: driveApi(),
  uploadMedia: jest.fn(async (uploaded: any) => ({...file(), id: 'f9', name: uploaded.name})),
  ...over,
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

  it('is honestly unavailable without a drive module (Pinetree/Mastodon)', async () => {
    const {done} = await setup({backend: {family: 'mastodon', capabilities: {}}})
    try {
      expect(await screen.findByText('Drive is not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('route folderId drives the listing + breadcrumbs', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend, folderId: 'd1'})
    try {
      expect(await screen.findByTestId('drive-collection-grid')).toBeTruthy()
      expect(backend.drive.files).toHaveBeenCalledWith(
        expect.objectContaining({folderId: 'd1'}),
      )
      expect(screen.getByTestId('drive-crumbs-root')).toBeTruthy()
      expect(screen.getByTestId('drive-crumbs-d1')).toBeTruthy()
      expect(screen.getByTestId('drive-collection-grid-d1')).toBeTruthy()
      expect(screen.getByTestId('drive-collection-grid-f1')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('shows usage under the header', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('40 B of 100 B')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('hides the sort menu when unsupported (fixed newest first)', async () => {
    const backend = fullBackend()
    backend.drive.isSortSupported = jest.fn(() => false)
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('drive-collection-grid-f1')).toBeTruthy()
      expect(screen.queryByTestId('drive-toolbar-sort')).toBeNull()
      expect(backend.drive.files).toHaveBeenCalledWith(expect.not.objectContaining({sort: expect.anything()}))
    } finally {
      done()
    }
  })

  it('detail panel renames with the server echo', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      fireEvent.press(await screen.findByTestId('drive-collection-grid-f1'))
      expect(await screen.findByTestId('drive-detail')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-detail-rename'))
      fireEvent.changeText(screen.getByTestId('drive-detail-rename-input'), 'new.png')
      fireEvent.press(screen.getByTestId('drive-detail-rename-save'))
      await waitFor(() => expect(backend.drive.updateFile).toHaveBeenCalledWith('f1', {name: 'new.png'}))
    } finally {
      done()
    }
  })

  it('folder delete walks depth-first and confirms with counts', async () => {
    const backend = fullBackend()
    backend.drive.folders.list.mockImplementation(async (opts: unknown) => {
      const parentId = (opts as {parentId?: string | null}).parentId
      if (parentId === 'd1') {
        return {items: [folder({id: 'sub', name: 'Sub', parentId: 'd1'})], cursor: null, end: true}
      }
      if (parentId === 'sub') return {items: [], cursor: null, end: true}
      return {items: [folder()], cursor: null, end: true}
    })
    backend.drive.files.mockImplementation(async (opts: unknown) => {
      const folderId = (opts as {folderId?: string | null}).folderId
      if (folderId === 'd1') return {items: [file({id: 'inner'})], cursor: null, end: true}
      if (folderId === 'sub') return {items: [], cursor: null, end: true}
      return {items: [file()], cursor: null, end: true}
    })
    const {done} = await setup({backend})
    try {
      fireEvent.press(await screen.findByTestId('drive-folder-menu-d1', undefined, {timeout: 45000}))
      fireEvent.press(await screen.findByText('Delete'))
      expect(await screen.findByTestId('drive-folder-delete')).toBeTruthy()
      expect(screen.getByText(/1 files and 1 subfolders/)).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-folder-delete-confirm'))
      await waitFor(() => expect(backend.drive.deleteFile).toHaveBeenCalledWith('inner'))
      await waitFor(() => expect(backend.drive.folders.delete).toHaveBeenCalledWith('sub'))
      await waitFor(() => expect(backend.drive.folders.delete).toHaveBeenCalledWith('d1'))
    } finally {
      done()
    }
  })

  it('move-to disables the no-op targets', async () => {
    const backend = fullBackend()
    backend.drive.folders.list.mockImplementation(async (opts: unknown) => {
      const parentId = (opts as {parentId?: string | null}).parentId;
      if (parentId) return {items: [], cursor: null, end: true}
      return {
        items: [folder({id: 'd1', name: 'One'}), folder({id: 'd2', name: 'Two'})],
        cursor: null,
        end: true,
      }
    })
    const {done} = await setup({backend})
    try {
      fireEvent.press(await screen.findByTestId('drive-folder-menu-d1'))
      fireEvent.press(await screen.findByText('Move to…'))
      expect(await screen.findByTestId('drive-move')).toBeTruthy()
      // Root is the current parent: disabled as a no-op; other folders stay enabled.
      expect(screen.getByTestId('drive-move-root').props.accessibilityState.disabled).toBe(true)
      expect(screen.getByTestId('drive-move-move-d2').props.accessibilityState.disabled).toBe(false)
      fireEvent.press(screen.getByTestId('drive-move-move-d2'))
      await waitFor(() => expect(backend.drive.folders.update).toHaveBeenCalledWith('d1', {parentId: 'd2'}))
    } finally {
      done()
    }
  })

  it('aborts the delete walk over 1000 items', async () => {    const units = Array.from({length: 120}, (_, i) => ({...file({id: `f${i}`})}))
    const calls: unknown[] = []
    const backend = {
      family: 'misskey',
      capabilities: {drive: 'supported'},
      drive: {
        files: jest.fn(async () => {
          calls.push(1)
          return {items: units, cursor: null, end: true}
        }),
        folders: {
          list: jest.fn(async () => ({items: [], cursor: null, end: true})),
          show: jest.fn(async () => ({folder: folder(), path: [folder()], filesCount: null, foldersCount: null})),
        },
      },
    }
    const walk = await walkFolderTree(backend.drive as never, 'd1', 1000)
    expect(walk.truncated).toBe(false)
    const big = await walkFolderTree(
      {
        ...backend.drive,
        files: jest.fn(async () => ({items: [...units, ...units, ...units, ...units, ...units, ...units, ...units, ...units, ...units], cursor: null, end: true})),
      } as never,
      'd1',
      1000,
    )
    expect(big.truncated).toBe(true)
  })

  it('long-press enters selection mode; tap toggles; Clear exits', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      const tile = await screen.findByTestId('drive-collection-grid-f1')
      fireEvent(tile, 'longPress')
      expect(await screen.findByTestId('drive-selection')).toBeTruthy()
      expect(screen.getByTestId('drive-collection-grid-f1-check')).toBeTruthy()
      // Tapping the second tile toggles it on while in selection mode.
      fireEvent.press(screen.getByTestId('drive-collection-grid-d1'))
      expect(screen.getByText('2 selected')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-bulk-delete'))
      expect(await screen.findByTestId('drive-bulk-delete-dialog')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-bulk-delete-cancel'))
      expect(await screen.findByTestId('drive-selection-clear')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-selection-clear'))
      expect(screen.queryByTestId('drive-selection')).toBeNull()
    } finally {
      done()
    }
  })

  it('bulk delete removes files and folders with a confirm', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      fireEvent(await screen.findByTestId('drive-collection-grid-f1'), 'longPress')
      fireEvent.press(screen.getByTestId('drive-collection-grid-d1'))
      fireEvent.press(screen.getByTestId('drive-bulk-delete'))
      const dialog = await screen.findByTestId('drive-bulk-delete-dialog')
      expect(dialog).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-bulk-delete-confirm'))
      await waitFor(() => expect(backend.drive.deleteFile).toHaveBeenCalledWith('f1'))
      await waitFor(() => expect(backend.drive.folders.delete).toHaveBeenCalledWith('d1'))
      expect(screen.queryByTestId('drive-selection')).toBeNull()
    } finally {
      done()
    }
  })

  it('bulk move uses moveMany and toasts the count', async () => {
    const backend = fullBackend()
    backend.drive.folders.list.mockImplementation(async (opts: unknown) => {
      if ((opts as {parentId?: string | null}).parentId) return {items: [], cursor: null, end: true}
      return {items: [folder({id: 'd1'}), folder({id: 'd2', name: 'Two'})], cursor: null, end: true}
    })
    const {done} = await setup({backend})
    try {
      fireEvent(await screen.findByTestId('drive-collection-grid-f1'), 'longPress')
      fireEvent.press(screen.getByTestId('drive-bulk-move'))
      expect(await screen.findByTestId('drive-move')).toBeTruthy()
      fireEvent.press(screen.getByTestId('drive-move-move-d2'))
      await waitFor(() => expect(backend.drive.moveMany).toHaveBeenCalledWith(['f1'], 'd2'))
    } finally {
      done()
    }
  })

  it('bulk sensitive toggle flips only files', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      fireEvent(await screen.findByTestId('drive-collection-grid-f1'), 'longPress')
      fireEvent.press(screen.getByTestId('drive-bulk-sensitive'))
      await waitFor(() => expect(backend.drive.updateFile).toHaveBeenCalledWith('f1', {isSensitive: true}))
    } finally {
      done()
    }
  })

  it('partial failure opens the retry dialog and retry only retries failed', async () => {
    const backend = fullBackend()
    backend.drive.updateFile.mockRejectedValueOnce(new Error('locked'))
    const {done} = await setup({backend})
    try {
      fireEvent(await screen.findByTestId('drive-collection-grid-f1'), 'longPress')
      fireEvent.press(screen.getByTestId('drive-bulk-sensitive'))
      expect(await screen.findByTestId('drive-bulk-failed')).toBeTruthy()
      expect(screen.getByTestId('drive-bulk-failed-names')).toBeTruthy()
      backend.drive.updateFile.mockResolvedValueOnce(file({id: 'f1', isSensitive: true}))
      fireEvent.press(screen.getByTestId('drive-bulk-retry'))
      await waitFor(() => expect(backend.drive.updateFile).toHaveBeenCalledTimes(2))
      expect(screen.queryByTestId('drive-bulk-failed')).toBeNull()
    } finally {
      done()
    }
  })
})
