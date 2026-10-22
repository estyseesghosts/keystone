// P6.2 transfer UI (clickstone §2.3): the twelve TransferSections rows
// become real one data family at a time.
//
// - Misskey family (`backend.transfer` present): import rows pick a file
//   (Drive upload → `{fileId}`, never `{file}`) and export rows enqueue,
//   completing via the `exportCompleted` notification — never a spinner.
// - Mastodon family (no `transfer`: the contract records no MastoAPI
//   import/export): every row stays disabled with a reason, never faked.
// - Drive-less flavors disable imports with a reason (capability gate).

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {ApiError, createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ExportSection, ImportSection} from './TransferSections'
import {pickTransferFile} from '#/lib/documentPicker'

jest.mock('#/lib/documentPicker', () => ({pickTransferFile: jest.fn()}))

const pickMock = pickTransferFile as jest.MockedFunction<typeof pickTransferFile>

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

const fakeFile = (name = 'following.csv') => new File(['acct\nuser'], name, {type: 'text/csv'})

const queuedExport = (endpoint: string, window: 'minute' | 'hour' | 'day' = 'hour') => ({
  status: 'queued' as const,
  endpoint,
  delivery: 'notification' as const,
  notificationType: 'exportCompleted' as const,
  rateLimit: {max: 1, window},
  message: `Export queued (${window === 'day' ? 'once a day' : window === 'hour' ? 'once an hour' : 'once a minute'}). Watch for the exportCompleted notification.`,
})

const transferBackend = (over: Record<string, any> = {}): any => ({
  family: 'misskey',
  capabilities: {drive: 'supported'},
  notifications: jest.fn(async () => ({items: [], cursor: null, end: true})),
  transfer: {
    importFile: jest.fn(async (kind: string) => ({
      ok: true,
      endpoint: `i/import-${kind === 'mute' ? 'muting' : kind}`,
      fileId: 'file-9',
      message: `Import of ${kind} queued (file-9).`,
    })),
    exportList: jest.fn(async (kind: string) => queuedExport(`i/export-${kind}`)),
  },
  ...over,
})

function exportCompletedNotif(id: string, entity: string) {
  return {
    id,
    kind: 'exportCompleted',
    rawType: 'exportCompleted',
    createdAt: '2026-10-22T00:00:00.000Z',
    read: null,
    actors: [],
    post: null,
    reaction: null,
    ext: {exportedEntity: entity},
  }
}

async function setup({
  backend,
  signedIn = true,
}: {
  backend?: any
  signedIn?: boolean
} = {}) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = backend ?? null
  pickMock.mockReset()
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  if (backend && signedIn) {
    await sessionStore.add({
      origin: ORIGIN,
      family: backend.family ?? 'misskey',
      flavor: backend.family === 'mastodon' ? 'mastodon' : 'misskey',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'password',
      hosting: 'third-party',
    })
  }
  const sessionId = sessionStore.getSnapshot().activeId
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  })
  const tree = (section: 'import' | 'export') => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme="light">
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          {section === 'import' ? <ImportSection /> : <ExportSection />}
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
  return {
    sessionId,
    queryClient,
    tree,
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
      queryClient.clear()
    },
  }
}

describe('TransferSections import gating (clickstone 2.3)', () => {
  it('renders four enabled import rows on the Misskey family', async () => {
    const {tree, done} = await setup({backend: transferBackend()})
    try {
      render(tree('import'))
      for (const kind of ['following', 'blocking', 'mute', 'notes']) {
        expect(await screen.findByTestId(`transfer-import-${kind}`)).toBeTruthy()
        expect(screen.getByTestId(`transfer-import-pick-${kind}`)).toBeTruthy()
        expect(screen.queryByTestId(`placeholder-import-${kind}`)).toBeNull()
      }
    } finally {
      done()
    }
  })

  it('disables every import row with a family reason on Mastodon', async () => {
    const {tree, done} = await setup({backend: {family: 'mastodon', capabilities: {}}})
    try {
      render(tree('import'))
      for (const kind of ['following', 'blocking', 'mute', 'notes']) {
        const row = await screen.findByTestId(`placeholder-import-${kind}`)
        expect(row.props.accessibilityState.disabled).toBe(true)
        expect(screen.queryByTestId(`transfer-import-${kind}`)).toBeNull()
      }
      // One honest family reason per row (never a shared singleton that
      // hides which family is missing).
      expect(screen.getAllByText(/instance website/i)).toHaveLength(4)
    } finally {
      done()
    }
  })

  it('asks for sign-in instead of rendering rows when signed out', async () => {
    const {tree, done} = await setup({backend: transferBackend(), signedIn: false})
    try {
      render(tree('import'))
      expect(await screen.findByText(/sign in to move data in/i)).toBeTruthy()
      expect(screen.queryByTestId('transfer-import-following')).toBeNull()
    } finally {
      done()
    }
  })

  it('disables imports with a Drive reason when the flavor has no Drive', async () => {
    const backend = transferBackend({capabilities: {drive: 'unsupported'}})
    const {tree, done} = await setup({backend})
    try {
      render(tree('import'))
      const row = await screen.findByTestId('placeholder-import-following')
      expect(row.props.accessibilityState.disabled).toBe(true)
      expect(screen.getAllByText(/no file storage/i)).toHaveLength(4)
      expect(screen.queryByTestId('transfer-import-following')).toBeNull()
    } finally {
      done()
    }
  })

  it('stays disabled when Drive support is unknown (unverified unlocks nothing)', async () => {
    const backend = transferBackend({capabilities: {}})
    const {tree, done} = await setup({backend})
    try {
      render(tree('import'))
      const row = await screen.findByTestId('placeholder-import-following')
      expect(row.props.accessibilityState.disabled).toBe(true)
      expect(screen.getAllByText(/drive support is unknown/i)).toHaveLength(4)
      expect(screen.queryByTestId('transfer-import-following')).toBeNull()
    } finally {
      done()
    }
  })
})

describe('TransferSections import flow (upload-then-{fileId})', () => {
  it('picks a file and imports it, showing upload → submit → done', async () => {
    const backend = transferBackend()
    const {tree, done} = await setup({backend})
    try {
      pickMock.mockResolvedValueOnce({file: fakeFile(), name: 'following.csv'})
      render(tree('import'))
      fireEvent.press(await screen.findByTestId('transfer-import-pick-following'))
      await waitFor(() =>
        expect(backend.transfer.importFile).toHaveBeenCalledWith(
          'following',
          expect.objectContaining({name: 'following.csv'}),
          expect.anything(),
        ),
      )
      // Phases surface as steps (no byte percentage), then the queued result.
      expect(await screen.findByTestId('transfer-import-status-following')).toBeTruthy()
      expect(screen.getByText(/file-9/)).toBeTruthy()
    } finally {
      done()
    }
  })

  it('does nothing on picker cancel (no backend call, no error)', async () => {
    const backend = transferBackend()
    const {tree, done} = await setup({backend})
    try {
      pickMock.mockResolvedValueOnce(null)
      render(tree('import'))
      fireEvent.press(await screen.findByTestId('transfer-import-pick-following'))
      await waitFor(() => expect(pickMock).toHaveBeenCalled())
      expect(backend.transfer.importFile).not.toHaveBeenCalled()
      expect(screen.queryByTestId('transfer-import-error-following')).toBeNull()
    } finally {
      done()
    }
  })

  it('shows an honest error when the picker fails', async () => {
    const backend = transferBackend()
    const {tree, done} = await setup({backend})
    try {
      pickMock.mockRejectedValueOnce(new Error('permission denied by the OS'))
      render(tree('import'))
      fireEvent.press(await screen.findByTestId('transfer-import-pick-blocking'))
      expect(await screen.findByTestId('transfer-import-error-blocking')).toBeTruthy()
      expect(screen.getByText(/permission denied by the OS/)).toBeTruthy()
      expect(backend.transfer.importFile).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('maps a stock 404 to the honest fork-gap reason (notes import)', async () => {
    const backend = transferBackend()
    backend.transfer.importFile.mockRejectedValueOnce(new ApiError('No such endpoint', 404))
    const {tree, done} = await setup({backend})
    try {
      pickMock.mockResolvedValueOnce({file: fakeFile('notes.csv'), name: 'notes.csv'})
      render(tree('import'))
      fireEvent.press(await screen.findByTestId('transfer-import-pick-notes'))
      expect(await screen.findByTestId('transfer-import-error-notes')).toBeTruthy()
      expect(
        screen.getByText('This server has no notes import (a Sharkey/fork endpoint).'),
      ).toBeTruthy()
    } finally {
      done()
    }
  })
})

describe('TransferSections export gating (clickstone 2.3)', () => {
  const EXPORT_KINDS = [
    'following',
    'blocking',
    'mute',
    'notes',
    'user-lists',
    'antennas',
    'clips',
    'favorites',
  ]

  it('renders eight enabled export rows on the Misskey family', async () => {
    const {tree, done} = await setup({backend: transferBackend()})
    try {
      render(tree('export'))
      for (const kind of EXPORT_KINDS) {
        expect(await screen.findByTestId(`transfer-export-${kind}`)).toBeTruthy()
        expect(screen.getByTestId(`transfer-export-run-${kind}`)).toBeTruthy()
        expect(screen.queryByTestId(`placeholder-export-${kind}`)).toBeNull()
      }
    } finally {
      done()
    }
  })

  it('disables every export row with a family reason on Mastodon', async () => {
    const {tree, done} = await setup({backend: {family: 'mastodon', capabilities: {}}})
    try {
      render(tree('export'))
      for (const kind of EXPORT_KINDS) {
        const row = await screen.findByTestId(`placeholder-export-${kind}`)
        expect(row.props.accessibilityState.disabled).toBe(true)
      }
      expect(screen.getAllByText(/instance website/i)).toHaveLength(8)
    } finally {
      done()
    }
  })
})

describe('TransferSections export flow (enqueue + exportCompleted)', () => {
  it('enqueues without a spinner: queued + rate limit + notification name', async () => {
    const backend = transferBackend()
    backend.transfer.exportList.mockResolvedValueOnce(queuedExport('i/export-notes', 'day'))
    const {tree, done} = await setup({backend})
    try {
      render(tree('export'))
      fireEvent.press(await screen.findByTestId('transfer-export-run-notes'))
      await waitFor(() => expect(backend.transfer.exportList).toHaveBeenCalledWith('notes'))
      const status = await screen.findByTestId('transfer-export-status-notes')
      expect(status).toBeTruthy()
      // The full queued message names the rate window AND the delivery
      // notification (the row hint also says "once a day", so match the
      // whole message — never a substring that collides with the hint).
      expect(
        screen.getByText(
          'Export queued (once a day). Watch for the exportCompleted notification.',
        ),
      ).toBeTruthy()
      // The POST resolved: the run button is usable again (no completion spinner).
      expect(screen.getByTestId('transfer-export-run-notes').props.accessibilityState?.disabled).not.toBe(
        true,
      )
    } finally {
      done()
    }
  })

  it('reports a payload fork honestly instead of a fake queue', async () => {
    const backend = transferBackend()
    backend.transfer.exportList.mockResolvedValueOnce({
      status: 'payload',
      endpoint: 'i/export-following',
      payload: {rows: [1]},
    })
    const {tree, done} = await setup({backend})
    try {
      render(tree('export'))
      fireEvent.press(await screen.findByTestId('transfer-export-run-following'))
      await waitFor(() => expect(backend.transfer.exportList).toHaveBeenCalledWith('following'))
      expect(await screen.findByTestId('transfer-export-status-following')).toBeTruthy()
      expect(screen.getByText(/returned the file directly/)).toBeTruthy()
    } finally {
      done()
    }
  })

  it('marks the row complete when a matching exportCompleted lands in the session cache', async () => {
    const backend = transferBackend()
    const {tree, done, sessionId, queryClient} = await setup({backend})
    try {
      render(tree('export'))
      fireEvent.press(await screen.findByTestId('transfer-export-run-notes'))
      await waitFor(() => expect(backend.transfer.exportList).toHaveBeenCalledWith('notes'))
      expect(await screen.findByTestId('transfer-export-status-notes')).toBeTruthy()
      // The server-side notification arrives (Notifications screen fetch,
      // stream fan-in): the row completes off the session cache.
      queryClient.setQueryData([sessionId, 'notifications', 'system|grouped:0'], {
        pages: [{items: [exportCompletedNotif('n1', 'note')], cursor: null, end: true}],
        pageParams: [null],
      })
      expect(await screen.findByText(/export is ready/i)).toBeTruthy()
    } finally {
      done()
    }
  })

  it('ignores another session’s exportCompleted (multi-account cache isolation)', async () => {
    const backend = transferBackend()
    const {tree, done, queryClient} = await setup({backend})
    try {
      render(tree('export'))
      fireEvent.press(await screen.findByTestId('transfer-export-run-notes'))
      await waitFor(() => expect(backend.transfer.exportList).toHaveBeenCalledWith('notes'))
      expect(await screen.findByTestId('transfer-export-status-notes')).toBeTruthy()
      queryClient.setQueryData(['sess-other', 'notifications', 'system|grouped:0'], {
        pages: [{items: [exportCompletedNotif('n9', 'note')], cursor: null, end: true}],
        pageParams: [null],
      })
      expect(screen.queryByText(/export is ready/i)).toBeNull()
    } finally {
      done()
    }
  })

  it('check-now reads the server for exportCompleted and completes the row', async () => {
    const backend = transferBackend()
    backend.notifications.mockResolvedValueOnce({
      items: [exportCompletedNotif('n2', 'muting')],
      cursor: null,
      end: true,
    })
    const {tree, done} = await setup({backend})
    try {
      render(tree('export'))
      fireEvent.press(await screen.findByTestId('transfer-export-run-mute'))
      await waitFor(() => expect(backend.transfer.exportList).toHaveBeenCalledWith('mute'))
      fireEvent.press(await screen.findByTestId('transfer-export-check-mute'))
      await waitFor(() =>
        expect(backend.notifications).toHaveBeenCalledWith(
          expect.objectContaining({includeTypes: ['exportCompleted']}),
        ),
      )
      expect(await screen.findByText(/export is ready/i)).toBeTruthy()
    } finally {
      done()
    }
  })
})
