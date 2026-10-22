// Compose overlay sheet (W6 C2/C3): full-bleed mobile sheet with grabber,
// backdrop + Cancel dismissal, and keyboard listeners that keep the card
// above the native keyboard. Desktop centered-card behavior is unchanged.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {Keyboard, StyleSheet} from 'react-native'

import {buildCapabilities, createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {clearRedraftSeeds, putRedraftSeed} from '#/lib/redraft'

import {ComposeScreen} from './Compose'

jest.mock('../components/Composer/pickMedia', () => ({pickMedia: jest.fn(async () => [])}))
jest.mock('#/components/EmojiPicker', () => ({EmojiPicker: () => null}))

const mockGoBack = jest.fn()
// Mutable route params: the redraft test below opens the sheet through the
// `redraftId` param, every other test uses the plain composer.
const mockRouteParams: {current: Record<string, unknown>} = {current: {}}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: mockRouteParams.current}),
  useNavigation: () => ({canGoBack: () => true, goBack: mockGoBack, dispatch: jest.fn()}),
}))

jest.mock('#/alf/breakpoints', () => ({
  ...jest.requireActual('#/alf/breakpoints'),
  useShellLayout: () => 'mobile',
}))

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
  fetchComposeLimits: jest.fn(async () => ({maxChars: 500, maxMedia: 4, maxPollOptions: 4})),
}))

const HOME_ORIGIN = 'https://app.example'
const ORIGIN = 'https://m.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function fakeBackend() {
  return {
    family: 'misskey',
    capabilities: buildCapabilities('sharkey'),
    post: jest.fn(async () => {
      throw new Error('no post')
    }),
    createPost: jest.fn(),
    customEmojis: jest.fn(async () => []),
    search: {},
    uploadMedia: jest.fn(),
  }
}

async function setup(opts: {expectComposer?: boolean} = {}) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = fakeBackend()
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  await sessionStore.add({
    origin: ORIGIN,
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-alice',
    grant: 'password',
    hosting: 'third-party',
  })
  const listeners: Record<string, (e: {endCoordinates?: {height?: number}}) => void> = {}
  const addSpy = jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation(((event: string, cb: (e: never) => void) => {
      listeners[event] = cb as (e: {endCoordinates?: {height?: number}}) => void
      return {remove: jest.fn()} as never
    }) as never)
  const tree = render(
    <ThemeProvider theme="light">
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          <ComposeScreen />
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  if (opts.expectComposer !== false) {
    await waitFor(() => expect(screen.getByTestId('composer-text')).toBeTruthy())
  }
  return {
    listeners,
    addSpy,
    ...tree,
    done: () => {
      addSpy.mockRestore()
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    },
  }
}

describe('ComposeScreen sheet', () => {
  beforeEach(() => {
    mockGoBack.mockClear()
    mockRouteParams.current = {}
    clearRedraftSeeds()
  })

  it('renders the mobile sheet: overlay, backdrop, grabber, scrollable card', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByTestId('compose-overlay')).toBeTruthy()
      expect(screen.getByTestId('compose-backdrop')).toBeTruthy()
      expect(screen.getByTestId('compose-grabber')).toBeTruthy()
      expect(screen.getByTestId('compose-sheet-scroll')).toBeTruthy()
      expect(screen.getByTestId('composer-text')).toBeTruthy()
      expect(screen.getByTestId('composer-submit')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('backdrop tap and Cancel both dismiss', async () => {
    const {done} = await setup()
    try {
      fireEvent.press(screen.getByTestId('compose-backdrop'))
      expect(mockGoBack).toHaveBeenCalledTimes(1)
      fireEvent.press(screen.getByTestId('composer-cancel'))
      expect(mockGoBack).toHaveBeenCalledTimes(2)
    } finally {
      done()
    }
  })

  it('subscribes to keyboard show/hide and caps the card above the keyboard', async () => {
    const {done, listeners, addSpy} = await setup()
    try {
      expect(addSpy).toHaveBeenCalledWith('keyboardDidShow', expect.any(Function))
      expect(addSpy).toHaveBeenCalledWith('keyboardDidHide', expect.any(Function))
      const before = StyleSheet.flatten(screen.getByTestId('compose-card').props.style) as {
        maxHeight?: number
      }
      expect(typeof before.maxHeight).toBe('number')
      act(() => {
        listeners['keyboardDidShow']({endCoordinates: {height: 300}})
      })
      const shown = StyleSheet.flatten(screen.getByTestId('compose-card').props.style) as {
        maxHeight?: number
      }
      expect(shown.maxHeight).toBe((before.maxHeight as number) - 300)
      act(() => {
        listeners['keyboardDidHide']({})
      })
      const hidden = StyleSheet.flatten(screen.getByTestId('compose-card').props.style) as {
        maxHeight?: number
      }
      expect(hidden.maxHeight).toBe(before.maxHeight)
    } finally {
      done()
    }
  })

  it('unsubscribes the keyboard listeners on unmount', async () => {
    const {done, unmount} = await setup()
    // KeyboardAvoidingView subscribes too — only our Did show/hide matter.
    const mock = Keyboard.addListener as jest.Mock
    const ours = mock.mock.calls
      .map((c, i) => i)
      .filter(i => mock.mock.calls[i][0] === 'keyboardDidShow' || mock.mock.calls[i][0] === 'keyboardDidHide')
    expect(ours).toHaveLength(2)
    unmount()
    for (const i of ours) expect(mock.mock.results[i].value.remove).toHaveBeenCalledTimes(1)
    done()
  })
})

describe('ComposeScreen delete-and-redraft handoff', () => {
  it('opens seeded from the handoff the delete flow left behind', async () => {
    mockRouteParams.current = {redraftId: 'p9'}
    putRedraftSeed('p9', {text: 'redrafted text', cw: '', cwEnabled: false, media: []})
    const {done} = await setup()
    try {
      expect(screen.getByTestId('composer-text').props.value).toBe('redrafted text')
    } finally {
      done()
    }
  })

  it('says there is nothing to redraft when the handoff is gone (cold start)', async () => {
    mockRouteParams.current = {redraftId: 'gone'}
    const {done} = await setup({expectComposer: false})
    try {
      expect(screen.getByText('There is nothing to redraft here.')).toBeTruthy()
      expect(screen.queryByTestId('composer-text')).toBeNull()
    } finally {
      done()
    }
  })
})
