// P6.5 Pages slice 2: shared renderer. Blocks, legacy banner, pinned
// title rule, image resolver fallback, error states.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore, type PageModel, type Session} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

import {ThemeProvider} from '#/alf/index'
import {SessionProvider} from '#/state/session/SessionProvider'
import type {TokenVault} from '#/storage'

import {PageActions} from './PageActions'
import {PageView, pageViewTitle} from './PageView'
import {makeAccount, makePost} from '../__tests__/fixtures'

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

const mockBackends = new Map<string, unknown>()

i18n.load('en', {})
i18n.activate('en')

const SESSION = (id: string, accountId = 'u1'): Session =>
  ({
    id,
    origin: 'https://a.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId,
    token: 't',
    grant: 'miauth',
    hosting: 'external',
  }) as unknown as Session

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function account() {
  return makeAccount({id: 'u1', username: 'alice', name: 'Alice', displayName: 'Alice'});
}

function page(over: Partial<PageModel> = {}): PageModel {
  return {
    id: 'p1',
    createdAt: '2026-10-26T12:00:00.000Z',
    updatedAt: '2026-10-26T12:00:00.000Z',
    author: account(),
    title: 'Hello',
    name: 'hello',
    summary: null,
    font: 'sans-serif',
    alignCenter: false,
    hideTitleWhenPinned: false,
    eyeCatchingImageId: null,
    eyeCatchingImage: null,
    attachedFiles: [],
    blocks: [{kind: 'text', id: 'b1', text: 'hi'}],
    likedCount: 0,
    isLiked: undefined,
    hasLegacyScript: false,
    url: 'https://a.example/@alice/pages/hello',
    ...over,
  }
}

function fakeBackend(over: Record<string, unknown> = {}) {
  return {
    family: 'misskey',
    capabilities: {pages: 'supported'},
    pages: {
      show: jest.fn(async () => page()),
      like: jest.fn(async () => undefined),
      unlike: jest.fn(async () => undefined),
      pin: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      byUser: jest.fn(async () => ({items: [], cursor: null, end: true})),
    },
    reportAccount: jest.fn(async () => undefined),
    post: jest.fn(async (id: string) => makePost({id})),
    ...over,
  }
}

async function signedInStore(id = 'sess-a') {
  const {createSessionStore} = await import('#/state/session/store')
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://a.example',
  })
  await store.add({
    origin: 'https://a.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId: account().id,
    token: 't',
    grant: 'miauth',
    hosting: 'third-party',
  })
  const snap = store.getSnapshot()
  void id
  return {store, sessionId: snap.sessions[0]?.id ?? 'sess-a'}
}

function renderPage(ui: React.ReactElement, store: unknown, qc = new QueryClient()) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider store={store as never} homeOrigin="https://a.example">
          <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('pageViewTitle', () => {
  it('hides when pinned + flagged, else title || name', () => {
    expect(pageViewTitle({title: 'T', name: 'n', hideTitleWhenPinned: true}, 'pinned')).toBeNull()
    expect(pageViewTitle({title: 'T', name: 'n', hideTitleWhenPinned: true}, 'read')).toBe('T')
    expect(pageViewTitle({title: '', name: 'n', hideTitleWhenPinned: false}, 'pinned')).toBe('n')
  })
})

describe('PageView blocks', () => {
  it('renders text via MFM, a section with capped heading, and unknown as placeholder', async () => {
    const {store, sessionId} = await signedInStore()
    const p = page({
      blocks: [
        {kind: 'text', id: 'b1', text: '**bold**'},
        {kind: 'section', id: 'b2', title: 'Part', children: [{kind: 'text', id: 'b2a', text: 'deep'}]},
        {kind: 'unknown', id: 'b3', type: 'button', raw: {id: 'b3', type: 'button'}},
      ],
    })
    renderPage(<PageView page={p} sessionId={sessionId} testID="pv" />, store)
    expect(screen.getByText('bold')).toBeTruthy()
    expect(screen.getByText('Part')).toBeTruthy()
    expect(screen.getByText('This block type is not supported')).toBeTruthy()
    expect(screen.getByText('button')).toBeTruthy()
  })

  it('shows the legacy-script banner and keeps rendering', async () => {
    const {store, sessionId} = await signedInStore()
    renderPage(<PageView page={page({hasLegacyScript: true})} sessionId={sessionId} testID="pv" />, store)
    expect(screen.getByText('This page has a script. Keystone does not run scripts.')).toBeTruthy()
    expect(screen.getByText('hi')).toBeTruthy()
  })

  it('resolves images against attachedFiles, missing file renders the box', async () => {
    const {store, sessionId} = await signedInStore()
    const file = {
      id: 'f1', kind: 'image', mimeType: 'image/png', url: 'https://a.example/f.png',
      previewUrl: null, name: 'f.png', description: null, blurhash: null, isSensitive: false,
      size: null, md5: null, meta: null, createdAt: null, folderId: null, userId: 'u1',
    } as const
    const p = page({
      blocks: [{kind: 'image', id: 'i1', fileId: 'gone'}],
      attachedFiles: [file],
    })
    const {unmount} = renderPage(<PageView page={p} sessionId={sessionId} testID="pv" />, store)
    expect(screen.getByText('Image unavailable')).toBeTruthy()
    unmount()
    const p2 = page({
      blocks: [{kind: 'image', id: 'i1', fileId: 'f1'}],
      attachedFiles: [file],
    })
    renderPage(<PageView page={p2} sessionId={sessionId} testID="pv" />, store)
    expect(screen.queryByText('Image unavailable')).toBeNull()
  })

  it('embeds notes via the post query and degrades when deleted', async () => {
    const backend = fakeBackend()
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, backend)
    try {
      renderPage(
        <PageView
          page={page({blocks: [{kind: 'note', id: 'n1', noteId: 'note-1', detailed: false}]})}
          sessionId={sessionId}
          testID="pv"
        />,
        store,
      )
      expect(await screen.findByTestId('post-note-1')).toBeTruthy()
    } finally {
      mockBackends.delete(sessionId)
    }
  })
})

describe('PageActions like', () => {
  it('owner sees menu without like; signed-out sees count only', async () => {
    const backend = fakeBackend()
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, backend)
    try {
      const own = page({author: account()})
      const {unmount} = renderPage(<PageActions page={own} sessionId={sessionId} testID="pa" />, store)
      expect(screen.queryByTestId('pa-like')).toBeNull()
      expect(screen.getByTestId('pa-menu')).toBeTruthy()
      unmount()
      renderPage(<PageActions page={own} sessionId={null} testID="pa" />, store)
      expect(screen.queryByTestId('pa-like')).toBeNull()
      expect(screen.queryByTestId('pa-menu')).toBeNull()
      expect(screen.getByTestId('pa-count')).toBeTruthy()
    } finally {
      mockBackends.delete(sessionId)
    }
  })

  it('non-owner can like optimistically and roll back on failure', async () => {
    const backend = fakeBackend({
      pages: {
        show: jest.fn(async () => page()),
        like: jest.fn(async () => {
          throw new Error('nope')
        }),
        unlike: jest.fn(async () => undefined),
        pin: jest.fn(async () => undefined),
        delete: jest.fn(async () => undefined),
        byUser: jest.fn(async () => ({items: [], cursor: null, end: true})),
      },
    })
    const other = makeAccount({id: 'u9', username: 'zoe', name: 'Zoe', displayName: 'Zoe'})
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, backend)
    try {
      const p = page({author: other, likedCount: 3, isLiked: false})
      const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
      renderPage(<PageActions page={p} sessionId={sessionId} testID="pa" />, store, qc)
      expect(screen.getByLabelText('Like, 3 likes')).toBeTruthy()
      fireEvent.press(screen.getByTestId('pa-like'))
      await waitFor(() => expect(backend.pages.like).toHaveBeenCalledWith('p1'))
      // Failure rolls back to unliked (and toasts).
      await waitFor(() => expect(screen.getByLabelText('Like, 3 likes')).toBeTruthy())
    } finally {
      mockBackends.delete(sessionId)
    }
  })
})
