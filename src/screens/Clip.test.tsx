// Clip screen (P6.6 slice 4): show-based load, header, edit/delete,
// owner gating, removal invalidation.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore, type Backend} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {makeAccount, makePost} from '#/components/__tests__/fixtures'

import {buildRemoveFromClip, ClipScreen} from './Clip'
import {clipMosaicQueryKey, feedQueryKey} from '#/state/queries/keys'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: {id: 'c1'}}),
  useNavigation: () => ({navigate: jest.fn(), goBack: mockGoBack}),
}))

const mockGoBack = jest.fn()

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
  i18n.load('en', {})
  i18n.activate('en')
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
            <ClipScreen />
          </SessionProvider>
        </QueryClientProvider>
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

const post = makePost({id: 'p1', content: {mfm: 'clipped post', plain: 'clipped post'}})

const clip = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Fun',
  isPublic: false,
  description: 'keep',
  notesCount: 3,
  owner: {id: 'alice', username: 'alice'},
  isOwn: true,
  ...over,
})

const fullBackend = () => ({
  family: 'misskey',
  capabilities: {clips: 'supported'},
  clips: {
    show: jest.fn(async (): Promise<any> => clip()),
    notes: jest.fn(async () => ({items: [post], cursor: null, end: true})),
    update: jest.fn(async (id: string, patch: Record<string, unknown>) => ({id, ...patch})),
    delete: jest.fn(async () => undefined),
    removeNote: jest.fn(async () => undefined),
    list: jest.fn(async () => ({items: [], cursor: null, end: true})),
  },
  me: jest.fn(async (): Promise<any> => makeAccount({id: 'alice', limits: {noteEachClipsLimit: 200}})),
})

describe('Clip screen', () => {
  it('loads via show (never list().find)', async () => {
    const backend = fullBackend()
    const list = jest.fn(async () => ({items: [], cursor: null, end: true}))
    backend.clips.list = list
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Fun')).toBeTruthy()
      expect(await screen.findByText('clipped post')).toBeTruthy()
      expect(backend.clips.show).toHaveBeenCalledWith('c1')
      expect(list).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('header shows visibility + count against the limit', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Private')).toBeTruthy()
      expect(screen.getByText('3 / 200 notes')).toBeTruthy()
      expect(screen.getByText('keep')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('edit sends the full body and delete confirms', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      fireEvent.press(await screen.findByTestId('clip-screen-menu'))
      fireEvent.press(await screen.findByText('Edit'))
      fireEvent.press(screen.getByTestId('clip-dialog-save'))
      await waitFor(() =>
        expect(backend.clips.update).toHaveBeenCalledWith('c1', {
          name: 'Fun',
          isPublic: false,
          description: 'keep',
        }),
      )
      fireEvent.press(screen.getByTestId('clip-screen-menu'))
      fireEvent.press(await screen.findByText('Delete'))
      expect(await screen.findByTestId('clip-delete')).toBeTruthy()
      fireEvent.press(screen.getByTestId('clip-delete-confirm'))
      await waitFor(() => expect(backend.clips.delete).toHaveBeenCalledWith('c1'))
    } finally {
      done()
    }
  })

  it('hides edit/delete for non-owners', async () => {
    const backend = fullBackend()
    backend.clips.show.mockResolvedValueOnce(clip({owner: {id: 'mallory', username: 'mallory'}, isOwn: false}))
    backend.me.mockResolvedValueOnce(makeAccount({id: 'alice'}))
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Fun')).toBeTruthy()
      expect(screen.queryByTestId('clip-screen-menu')).toBeNull()
    } finally {
      done()
    }
  })

  it('missing clip renders not-found without a retry loop', async () => {
    const backend = fullBackend()
    backend.clips.show.mockResolvedValueOnce(null)
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('This clip does not exist.')).toBeTruthy()
    } finally {
      done()
    }
  })
})

describe('buildRemoveFromClip', () => {
  it('removes the note and invalidates only the clip feed + mosaic keys', async () => {
    const removeNote = jest.fn(async () => undefined)
    const backend = {family: 'misskey', capabilities: {}, clips: {removeNote}} as unknown as Backend
    const qc = new QueryClient()
    qc.setQueryData(feedQueryKey('s1', 'clip|c1'), {pages: []})
    qc.setQueryData(clipMosaicQueryKey('s1', 'c1'), {images: []})
    qc.setQueryData(feedQueryKey('s1', 'timeline|home'), {pages: []})
    const row = buildRemoveFromClip({backend, queryClient: qc, sessionId: 's1', clipId: 'c1', descriptor: 'clip|c1' as never})
    expect(row.label).toBe('Remove from this clip')
    await row.run({id: 'p9'} as never)
    expect(removeNote).toHaveBeenCalledWith('c1', 'p9')
    expect(qc.getQueryState(feedQueryKey('s1', 'clip|c1'))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(clipMosaicQueryKey('s1', 'c1'))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(feedQueryKey('s1', 'timeline|home'))?.isInvalidated).not.toBe(true)
  })
})
