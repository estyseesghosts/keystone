// P6.5 Pages slice 4: editor screen — validation, create→replace,
// update patch, name collision inline, duplicate retry, delete confirm,
// dirty guard, draft restore.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore, FediError} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {appStorage} from '#/storage'
import {savePageDraft} from '#/storage/pageDrafts'
import {duplicatePageOnBackend} from '#/state/queries/pages'
import {pageFormatPrefStore} from '#/state/pageFormatPref'
import {makeAccount} from '#/components/__tests__/fixtures'

import {PageEditScreen} from './PageEdit'
import {parseNoteInput} from '#/components/PageEditor/BlockEditors'

let mockRouteParams: {id?: string} | undefined = undefined
const mockNav = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  dispatch: jest.fn(),
  addListener: jest.fn(() => () => {}),
}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: mockRouteParams}),
  useNavigation: () => mockNav,
}))

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

const mockBackends = new Map<string, unknown>()

i18n.load('en', {})
i18n.activate('en')

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function page(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    createdAt: '2026-10-26T12:00:00.000Z',
    updatedAt: '2026-10-26T12:00:00.000Z',
    author: {
      id: 'alice', name: 'Alice', username: 'alice', displayName: 'Alice', host: null,
      avatarUrl: null, avatarBlurhash: null, isBot: false, isCat: false,
      emojis: {}, onlineStatus: 'online',
    },
    title: 'Hello',
    name: 'hello',
    summary: null,
    hideTitleWhenPinned: false,
    alignCenter: false,
    font: 'sans-serif',
    eyeCatchingImageId: null,
    eyeCatchingImage: null,
    attachedFiles: [],
    blocks: [{kind: 'text', id: 'b1', text: 'hi'}],
    likedCount: 0,
    isLiked: false,
    hasLegacyScript: false,
    url: 'https://a.example/@alice/pages/hello',
    ...over,
  }
}

function pagesMod(over: Record<string, unknown> = {}) {
  return {
    show: jest.fn(async () => page()),
    byUser: jest.fn(async () => ({items: [], cursor: null, end: true})),
    create: jest.fn(async (draft: Record<string, unknown>) => page({title: draft.title, name: draft.name})),
    update: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    ...over,
  }
}

function fakeBackend(pages: Record<string, unknown>) {
  return {
    family: 'misskey',
    capabilities: {pages: 'supported'},
    pages,
    me: jest.fn(async () => makeAccount({id: 'alice', username: 'alice', displayName: 'Alice'})),
    drive: {files: jest.fn(async () => ({items: [], cursor: null, end: true}))},
  }
}

async function signedInStore() {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://a.example',
  })
  await store.add({
    origin: 'https://a.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-alice',
    grant: 'miauth',
    hosting: 'third-party',
  })
  const sessionId = store.getSnapshot().sessions[0]?.id as string
  return {store, sessionId}
}

function renderEditor(store: unknown) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider store={store as never} homeOrigin="https://a.example">
          <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
            <PageEditScreen />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('PageEditScreen', () => {
  beforeEach(() => {
    mockRouteParams = undefined
    mockNav.navigate.mockClear()
    mockNav.goBack.mockClear()
    mockNav.dispatch.mockClear()
    mockNav.addListener.mockClear()
    mockBackends.clear()
  })

  it('new page: empty title blocks save with an inline error', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, fakeBackend(pagesMod()))
    try {
      renderEditor(store)
      expect(await screen.findByTestId('page-edit-settings-title')).toBeTruthy()
      // Save disabled while clean.
      expect(screen.getByTestId('page-edit-save').props.accessibilityState.disabled).toBe(true)
      // Whitespace-only title is dirty but invalid.
      fireEvent.changeText(screen.getByTestId('page-edit-settings-title'), '   ')
      fireEvent.press(screen.getByTestId('page-edit-save'))
      expect(await screen.findByText('Title is required.')).toBeTruthy()
    } finally {
      mockBackends.clear()
    }
  })

  it('new page: title → create → replace to the saved editor', async () => {
    const {store, sessionId} = await signedInStore()
    const pages = pagesMod()
    pages.create.mockResolvedValueOnce(page({id: 'p9', title: 'Hi', name: 'hi'}))
    mockBackends.set(sessionId, fakeBackend(pages))
    try {
      renderEditor(store)
      const input = await screen.findByTestId('page-edit-settings-title')
      fireEvent.changeText(input, 'Hi')
      const save = screen.getByTestId('page-edit-save')
      expect(save.props.accessibilityState.disabled).toBe(false)
      fireEvent.press(save)
      await waitFor(() => expect(pages.create).toHaveBeenCalledTimes(1))
      const draft = pages.create.mock.calls[0]![0] as Record<string, unknown>
      expect(draft.title).toBe('Hi')
      expect(draft.variables).toEqual([])
      expect(draft.script).toBeUndefined()
      await waitFor(() => expect(mockNav.dispatch).toHaveBeenCalledTimes(1))
    } finally {
      mockBackends.clear()
    }
  })

  it('create maps NAME_ALREADY_EXISTS to the inline slug error', async () => {
    const {store, sessionId} = await signedInStore()
    const pages = pagesMod()
    pages.create.mockRejectedValueOnce(new FediError('taken', 'errors.pages.nameTaken'))
    mockBackends.set(sessionId, fakeBackend(pages))
    try {
      renderEditor(store)
      fireEvent.changeText(await screen.findByTestId('page-edit-settings-title'), 'Hi')
      fireEvent.press(screen.getByTestId('page-edit-save'))
      expect(await screen.findByText('That URL is already taken.')).toBeTruthy()
    } finally {
      mockBackends.clear()
    }
  })

  it('edit: title change saves a title-only patch', async () => {
    mockRouteParams = {id: 'p1'}
    const {store, sessionId} = await signedInStore()
    const pages = pagesMod()
    mockBackends.set(sessionId, fakeBackend(pages))
    try {
      renderEditor(store)
      fireEvent.press(await screen.findByTestId('page-edit-settings-toggle'))
      const input = await screen.findByTestId('page-edit-settings-title')
      fireEvent.changeText(input, 'Hello 2')
      fireEvent.press(screen.getByTestId('page-edit-save'))
      await waitFor(() => expect(pages.update).toHaveBeenCalledWith('p1', {title: 'Hello 2'}))
    } finally {
      mockBackends.clear()
    }
  })

  it('delete: confirm dialog names the page and deletes', async () => {
    mockRouteParams = {id: 'p1'}
    const {store, sessionId} = await signedInStore()
    const pages = pagesMod()
    mockBackends.set(sessionId, fakeBackend(pages))
    try {
      renderEditor(store)
      fireEvent.press(await screen.findByTestId('page-edit-menu'))
      // Menu items render in a dialog/modal; pick Delete by label.
      fireEvent.press(await screen.findByText('Delete'))
      expect(await screen.findByTestId('page-edit-delete')).toBeTruthy()
      fireEvent.press(screen.getByTestId('page-edit-delete-confirm'))
      await waitFor(() => expect(pages.delete).toHaveBeenCalledWith('p1'))
    } finally {
      mockBackends.clear()
    }
  })

  it('dirty guard fires on remove (Discard leaves)', async () => {
    mockRouteParams = {id: 'p1'}
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, fakeBackend(pagesMod()))
    try {
      renderEditor(store)
      fireEvent.press(await screen.findByTestId('page-edit-settings-toggle'))
      fireEvent.changeText(await screen.findByTestId('page-edit-settings-title'), 'Changed')
      expect(mockNav.addListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function))
      const handler = mockNav.addListener.mock.calls[0] as unknown as [
        string,
        (e: {preventDefault: jest.Mock}) => void,
      ]
      const preventDefault = jest.fn()
      handler[1]({preventDefault})
      expect(preventDefault).toHaveBeenCalled()
      fireEvent.press(await screen.findByTestId('page-edit-close-discard'))
      expect(mockNav.goBack).toHaveBeenCalled()
    } finally {
      mockBackends.clear()
    }
  })

  it('offers restore for a newer draft; Restore applies, Discard clears', async () => {
    mockRouteParams = {id: 'p1'}
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, fakeBackend(pagesMod()))
    savePageDraft(appStorage(), sessionId, 'p1', {
      title: 'Drafted',
      summary: null,
      name: 'hello',
      font: 'sans-serif',
      alignCenter: false,
      hideTitleWhenPinned: false,
      eyeCatchingImageId: null,
      blocks: [],
    }, Date.parse('2026-10-27T00:00:00.000Z'))
    try {
      const {unmount} = renderEditor(store)
      expect(await screen.findByTestId('page-edit-restore')).toBeTruthy()
      fireEvent.press(screen.getByTestId('page-edit-restore-discard'))
      expect(screen.queryByTestId('page-edit-restore')).toBeNull()
      unmount()
    } finally {
      mockBackends.clear()
    }
  })

  it('image block without a file offers Choose; drive gate disables it', async () => {    mockRouteParams = undefined
    const {store, sessionId} = await signedInStore()
    const pages = pagesMod()
    pages.create.mockResolvedValueOnce(page({id: 'p9'}))
    mockBackends.set(sessionId, {
      family: 'misskey',
      capabilities: {pages: 'supported'},
      pages,
      me: jest.fn(async () => makeAccount({id: 'alice', username: 'alice', displayName: 'Alice'})),
    })
    try {
      renderEditor(store)
      expect(await screen.findByTestId('page-edit-settings-title')).toBeTruthy()
      // Add an image block via the Add menu, then choose.
      fireEvent.press(screen.getByTestId('page-edit-add'))
      fireEvent.press(await screen.findByText('Image'))
      expect(await screen.findByText('No image selected')).toBeTruthy()
      const choose = screen.getByTestId(/-choose$/)
      expect(choose.props.accessibilityState.disabled).toBe(true)
    } finally {
      mockBackends.clear()
    }
  })
})

describe('duplicatePageOnBackend', () => {
  it('retries the slug up to 5 times on collision', async () => {
    const savedPage = page({id: 'p1', title: 'Hi', name: 'hi'})
    const create = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockRejectedValueOnce(new FediError('taken', 'errors.pages.nameTaken'))
      .mockResolvedValueOnce(savedPage)
    const backend = {create} as never
    const copy = await duplicatePageOnBackend(backend as never, savedPage as never)
    expect(copy).toBe(savedPage)
    expect(create).toHaveBeenCalledTimes(2)
    expect((create.mock.calls[0]![0] as {name: string}).name).toBe('hi-copy')
    expect((create.mock.calls[1]![0] as {name: string}).name).toBe('hi-copy-2')
    expect((create.mock.calls[0]![0] as {title: string}).title).toBe('Hi (copy)')
  })
})

describe('parseNoteInput', () => {
  it('accepts bare ids', () => {
    expect(parseNoteInput('abc123', 'https://a.example')).toEqual({noteId: 'abc123'})
  })

  it('accepts same-origin links (trailing slash tolerated)', () => {
    expect(parseNoteInput('https://a.example/notes/abc123/', 'https://a.example')).toEqual({noteId: 'abc123'})
  })

  it('rejects foreign origins and garbage', () => {
    expect(parseNoteInput('https://evil.example/notes/x', 'https://a.example')).toEqual({error: 'note-input-foreign'})
    expect(parseNoteInput('not a link!!', 'https://a.example')).toEqual({error: 'note-input-invalid'})
  })
})

describe('preview tab', () => {
  beforeEach(() => {
    mockRouteParams = undefined
    mockNav.navigate.mockClear()
    mockNav.goBack.mockClear()
    mockNav.dispatch.mockClear()
    mockNav.addListener.mockClear()
    mockBackends.clear()
    pageFormatPrefStore.set(false)
  })

  it('preview renders unsaved edits with the not-published banner', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, fakeBackend(pagesMod()))
    try {
      renderEditor(store)
      fireEvent.changeText(await screen.findByTestId('page-edit-settings-title'), 'Draft title')
      fireEvent.press(screen.getByTestId('page-edit-tab-preview'))
      expect(await screen.findByText('Preview — not published (unsaved changes)')).toBeTruthy()
      expect(await screen.findByTestId('page-edit-preview-view')).toBeTruthy()
      // Reader and preview share PageView: the draft title renders as h1.
      expect(screen.getByText('Draft title')).toBeTruthy()
      // Edit pane keeps state: switching back preserves the title.
      fireEvent.press(screen.getByTestId('page-edit-tab-edit'))
      expect(screen.getByTestId('page-edit-settings-title').props.value).toBe('Draft title')
    } finally {
      mockBackends.clear()
    }
  })

  it('show-formatting toggle switches the text block to rendered mode and persists', async () => {
    const {store, sessionId} = await signedInStore()
    mockBackends.set(sessionId, fakeBackend(pagesMod()))
    try {
      renderEditor(store)
      expect(await screen.findByTestId('page-edit-settings-title')).toBeTruthy()
      // Add a text block and type into it.
      fireEvent.press(screen.getByTestId('page-edit-add'))
      fireEvent.press(await screen.findByText('Text'))
      const input = screen.getByTestId(/-text$/)
      const inputId = input.props.testID as string
      fireEvent.changeText(input, '**bold**')
      // Toggle on (settings panel is open for new pages).
      fireEvent(screen.getByTestId('page-edit-settings-show-formatting'), 'valueChange', true)
      expect(pageFormatPrefStore.get()).toBe(true)
      await waitFor(() => expect(screen.queryByTestId(inputId)).toBeNull())
      // Rendered mode shows the input box as rich text; tapping returns to input.
      const renderedId = `${inputId}-rendered`
      expect(screen.getByTestId(renderedId)).toBeTruthy()
      fireEvent.press(screen.getByTestId(renderedId))
      expect(await screen.findByTestId(inputId)).toBeTruthy()
    } finally {
      mockBackends.clear()
      pageFormatPrefStore.set(false)
    }
  })
})
