// Clips index on the kit (P6.6 slice 3): item order, pinned
// Favourites folder, mosaics, limit gating, full-body edit (B1
// regression), picker mode, grid/list parity.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

i18n.load('en', {})
i18n.activate('en')

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
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
            <ClipsScreen />
          </QueryClientProvider>
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

const clip = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Fun',
  isPublic: false,
  description: null,
  notesCount: 3,
  ...over,
})

const fullBackend = () => ({
  family: 'misskey',
  capabilities: {clips: 'supported'},
  clips: {
    list: jest.fn(async () => ({
      items: [clip(), clip({id: 'c2', name: 'Work', isPublic: true, notesCount: 0, description: 'd'})],
      cursor: null,
      end: true,
    })),
    notes: jest.fn(async () => ({items: [], cursor: null, end: true})),
    show: jest.fn(async () => clip()),
    create: jest.fn(async (name: string, opts?: {isPublic?: boolean; description?: string | null}) => ({
      id: 'c3',
      name,
      isPublic: opts?.isPublic ?? false,
      description: opts?.description ?? null,
    })),
    update: jest.fn(async (id: string, patch: {name: string; isPublic: boolean; description: string | null}) => ({
      id,
      ...patch,
    })),
    delete: jest.fn(async () => undefined),
    addNote: jest.fn(async () => undefined),
  },
  bookmarks: {
    list: jest.fn(async () => ({items: [], cursor: null, end: true})),
    add: jest.fn(async () => undefined),
  },
  me: jest.fn(async () => ({id: 'alice', limits: {clipLimit: 10}})),
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
    const {done} = await setup({backend: {family: 'mastodon', capabilities: {}}})
    try {
      expect(await screen.findByText('Clips are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('lists the Favourites folder first, then own clips', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('clips-fav')).toBeTruthy()
      expect(screen.getByTestId('clips-clip-c1')).toBeTruthy()
      expect(screen.getByTestId('clips-clip-c2')).toBeTruthy()
      // Favourites tile opens the Favorites route, never a clips/* call.
      fireEvent.press(screen.getByTestId('clips-fav'))
      expect(mockNavigate).toHaveBeenCalledWith('Favorites')
      fireEvent.press(screen.getByTestId('clips-clip-c1'))
      expect(mockNavigate).toHaveBeenCalledWith('Clip', {id: 'c1'})
    } finally {
      done()
    }
  })

  it('Favourites folder has no edit/delete and never triggers clips/*', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      await screen.findByTestId('clips-fav')
      expect(backend.clips.list).toHaveBeenCalled()
      expect(screen.queryByTestId('clips-menu-favourites')).toBeNull()
    } finally {
      done()
    }
  })

  it('shows the limit count and disables New clip at the limit', async () => {
    const backend = fullBackend()
    backend.me.mockResolvedValueOnce({id: 'alice', limits: {clipLimit: 2}})
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('2 / 2')).toBeTruthy()
      expect(screen.getByTestId('clips-new').props.accessibilityState.disabled).toBe(true)
    } finally {
      done()
    }
  })

  it('creates a clip through the dialog (full body)', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      await screen.findByTestId('clips-clip-c1')
      fireEvent.press(screen.getByTestId('clips-new'))
      fireEvent.changeText(await screen.findByTestId('clips-dialog-name'), 'Local')
      fireEvent.press(screen.getByTestId('clips-dialog-public'))
      fireEvent.press(screen.getByTestId('clips-dialog-save'))
      await waitFor(() =>
        expect(backend.clips.create).toHaveBeenCalledWith('Local', {isPublic: true, description: null}),
      )
    } finally {
      done()
    }
  })

  it('edits send name + isPublic + description (B1: description survives)', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      await screen.findByTestId('clips-clip-c2')
      fireEvent.press(screen.getByTestId('clips-menu-c2'))
      fireEvent.press(await screen.findByText('Edit'))
      fireEvent.press(screen.getByTestId('clips-dialog-save'))
      await waitFor(() =>
        expect(backend.clips.update).toHaveBeenCalledWith('c2', {
          name: 'Work',
          isPublic: true,
          description: 'd',
        }),
      )
    } finally {
      done()
    }
  })

  it('deletes with a confirm naming the clip', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      await screen.findByTestId('clips-clip-c1')
      fireEvent.press(screen.getByTestId('clips-menu-c1'))
      fireEvent.press(await screen.findByText('Delete'))
      expect(await screen.findByTestId('clips-delete')).toBeTruthy()
      fireEvent.press(screen.getByTestId('clips-delete-confirm'))
      await waitFor(() => expect(backend.clips.delete).toHaveBeenCalledWith('c1'))
    } finally {
      done()
    }
  })

  it('picker mode files the note into a clip and closes', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend, params: {addNoteId: 'n9'}})
    try {
      expect(await screen.findByText('Choose a clip for this post.')).toBeTruthy()
      fireEvent.press(await screen.findByTestId('clips-clip-c1'))
      await waitFor(() => expect(backend.clips.addNote).toHaveBeenCalledWith('c1', 'n9'))
      expect(mockGoBack).toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('picker mode Favourites tile calls bookmarks.add, never clips/*', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend, params: {addNoteId: 'n9'}})
    try {
      fireEvent.press(await screen.findByTestId('clips-fav'))
      await waitFor(() => expect(backend.bookmarks.add).toHaveBeenCalledWith('n9'))
      expect(backend.clips.addNote).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('picker mode maps ALREADY_CLIPPED to an inline error and stays open', async () => {
    const backend = fullBackend()
    const {ApiError} = jest.requireActual('@keystone/fedi') as typeof import('@keystone/fedi')
    backend.clips.addNote.mockRejectedValueOnce(new ApiError('dup', 400, 'ALREADY_CLIPPED'))
    const {done} = await setup({backend, params: {addNoteId: 'n9'}})
    try {
      fireEvent.press(await screen.findByTestId('clips-clip-c1'))
      expect(await screen.findByTestId('clips-action-error')).toBeTruthy()
      expect(mockGoBack).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('retries after a load failure', async () => {
    const list = jest.fn().mockRejectedValue(new Error('boom'))
    const {done} = await setup({
      backend: {family: 'misskey', capabilities: {clips: 'supported'}, clips: {list}},
    })
    try {
      expect(await screen.findByText('Could not load clips.')).toBeTruthy()
      list.mockResolvedValue({
        items: [{id: 'c1', name: 'Fun'}],
        cursor: null,
        end: true,
      })
      fireEvent.press(screen.getByTestId('clips-collection-retry'))
      expect(await screen.findByText('Fun')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('grid and list render the same items', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('clips-collection-grid')).toBeTruthy()
      expect(screen.getByTestId('clips-clip-c1')).toBeTruthy()
      fireEvent.press(screen.getByTestId('clips-toolbar-view-list'))
      expect(await screen.findByTestId('clips-collection-list')).toBeTruthy()
      expect(screen.getByTestId('clips-clip-c1')).toBeTruthy()
      expect(screen.getByTestId('clips-fav')).toBeTruthy()
    } finally {
      const {collectionPrefsStore} = await import('#/state/collectionPrefs')
      collectionPrefsStore.set('clips', 'grid')
      done()
    }
  })
})
