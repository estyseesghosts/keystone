// Compose overlay sheet (W6 C2/C3, X6.5): full-bleed mobile sheet with
// grabber, backdrop + Cancel dismissal. Keyboard compensation is exactly
// one mechanism per platform (X6.5): iOS mounts the sheet KAV, Android caps
// the card via keyboard show/hide listeners, web uses CSS.
// Desktop centered-card behavior is unchanged.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {Keyboard, KeyboardAvoidingView, Platform, StyleSheet} from 'react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import {buildCapabilities, createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {clearRedraftSeeds, putRedraftSeed} from '#/lib/redraft'

import {ComposeScreen} from './Compose'

i18n.load('en', {})
i18n.activate('en')

jest.mock('../components/Composer/pickMedia', () => ({pickMedia: jest.fn(async () => ({kind: 'cancelled'}))}))
jest.mock('#/components/EmojiPicker', () => ({EmojiPicker: () => null}))

const mockGoBack = jest.fn()
const mockAddListener = jest.fn((_event: string, _cb: (e: {preventDefault: () => void}) => void) => jest.fn())
// Stable across renders (mirrors the real navigation object — a fresh
// identity per render would re-run `beforeRemove` subscriptions).
const mockNav = {canGoBack: () => true, goBack: mockGoBack, dispatch: jest.fn(), addListener: mockAddListener}
// Mutable route params: the redraft test below opens the sheet through the
// `redraftId` param, every other test uses the plain composer.
const mockRouteParams: {current: Record<string, unknown>} = {current: {}}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: mockRouteParams.current}),
  useNavigation: () => mockNav,
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
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
            <ComposeScreen />
          </SessionProvider>
        </QueryClientProvider>
      </I18nProvider>
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
  // Full-mount sheet setup (session store + queries) runs 2-4s on a loaded
  // box; give it the same 20s budget as the postquote-emoji tests rather
  // than a 5s default that flakes under full-suite load.
  jest.setTimeout(20000)
  beforeEach(() => {
    mockGoBack.mockClear()
    mockAddListener.mockClear()
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

  it('android: subscribes to keyboard show/hide and caps the card above the keyboard', async () => {
    // X6.5: the manual maxHeight cap is the Android mechanism (iOS is
    // KAV-owned, web is CSS-owned — neither subscribes here).
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'android')
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
      restoreOs.restore()
    }
  })

  it('iOS: offsets for the keyboard exactly once (single KeyboardAvoidingView)', async () => {
    // R0.3 + X6.5: the sheet owns the KAV on iOS; the composer's inner KAV
    // is skipped on this path so iOS does not double-offset. Home's
    // standalone composer keeps its own KAV (covered by
    // CompactComposer.test.tsx).
    const {done} = await setup()
    try {
      expect(screen.UNSAFE_queryAllByType(KeyboardAvoidingView)).toHaveLength(1)
    } finally {
      done()
    }
  })

  it.each([
    {os: 'ios', kavCount: 1, capped: false},
    {os: 'android', kavCount: 0, capped: true},
    {os: 'web', kavCount: 0, capped: false},
  ] as const)(
    'exactly one keyboard mechanism is active on $os (KAV xor maxHeight xor none)',
    async ({os, kavCount, capped}) => {
      // X6.5 acceptance (rn-ui L5): render-prop inspection per Platform.OS.
      // iOS = KAV only, Android = maxHeight cap only, web = neither (CSS).
      const restoreOs = jest.replaceProperty(Platform, 'OS', os)
      const {done, listeners} = await setup()
      try {
        expect(screen.UNSAFE_queryAllByType(KeyboardAvoidingView)).toHaveLength(kavCount)
        const card = StyleSheet.flatten(screen.getByTestId('compose-card').props.style) as {
          maxHeight?: number
          paddingBottom?: number
        }
        expect(card.maxHeight !== undefined).toBe(capped)
        const padBefore = card.paddingBottom
        if (os === 'android') {
          // The cap moves with the keyboard; no keyboard pad stacks with it.
          const before = card.maxHeight as number
          act(() => {
            listeners['keyboardDidShow']({endCoordinates: {height: 300}})
          })
          const shown = StyleSheet.flatten(screen.getByTestId('compose-card').props.style) as {
            maxHeight?: number
            paddingBottom?: number
          }
          expect(shown.maxHeight).toBe(before - 300)
          expect(shown.paddingBottom).toBe(padBefore)
          act(() => {
            listeners['keyboardDidHide']({})
          })
          const hidden = StyleSheet.flatten(screen.getByTestId('compose-card').props.style) as {
            maxHeight?: number
            paddingBottom?: number
          }
          expect(hidden.maxHeight).toBe(before)
          expect(hidden.paddingBottom).toBe(padBefore)
        } else {
          // iOS (KAV-owned) and web (CSS-owned) never subscribe our manual
          // keyboard listeners.
          expect(listeners['keyboardDidShow']).toBeUndefined()
          expect(listeners['keyboardDidHide']).toBeUndefined()
        }
        // Exactly one native mechanism active (web: none — CSS owns it).
        const activeCount = (kavCount === 1 ? 1 : 0) + (capped ? 1 : 0)
        if (os === 'web') expect(activeCount).toBe(0)
        else expect(activeCount).toBe(1)
      } finally {
        done()
        restoreOs.restore()
      }
    },
  )

  it('android: unsubscribes the keyboard listeners on unmount', async () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'android')
    const {done, unmount} = await setup()
    try {
      // KeyboardAvoidingView subscribes too — only our Did show/hide matter.
      const mock = Keyboard.addListener as jest.Mock
      const ours = mock.mock.calls
        .map((c, i) => i)
        .filter(i => mock.mock.calls[i][0] === 'keyboardDidShow' || mock.mock.calls[i][0] === 'keyboardDidHide')
      expect(ours).toHaveLength(2)
      unmount()
      for (const i of ours) expect(mock.mock.results[i].value.remove).toHaveBeenCalledTimes(1)
    } finally {
      done()
      restoreOs.restore()
    }
  })
})

describe('ComposeScreen close guard (slice 2)', () => {
  // Same loaded-box budget as the sheet block above (full-mount setup).
  jest.setTimeout(20000)
  beforeEach(() => {
    mockGoBack.mockClear()
    mockAddListener.mockClear()
    mockRouteParams.current = {}
    clearRedraftSeeds()
  })

  function beforeRemoveListener(): (e: {preventDefault: () => void}) => void {
    const calls = mockAddListener.mock.calls.filter(c => c[0] === 'beforeRemove')
    expect(calls).toHaveLength(1)
    return calls[0][1]
  }

  it('dirty backdrop routes through the guard; Save closes', async () => {
    const {done} = await setup()
    try {
      fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
      fireEvent.press(screen.getByTestId('compose-backdrop'))
      expect(mockGoBack).not.toHaveBeenCalled()
      expect(screen.getByTestId('composer-close-confirm')).toBeTruthy()
      fireEvent.press(screen.getByTestId('composer-close-save'))
      expect(mockGoBack).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('composer-close-confirm')).toBeNull()
    } finally {
      done()
    }
  })

  it('dirty Cancel then Discard closes without a second confirm', async () => {
    const {done} = await setup()
    try {
      fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
      fireEvent.press(screen.getByTestId('composer-cancel'))
      expect(screen.getByTestId('composer-close-confirm')).toBeTruthy()
      expect(mockGoBack).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('composer-close-discard'))
      expect(mockGoBack).toHaveBeenCalledTimes(1)
    } finally {
      done()
    }
  })

  it('Keep writing dismisses the sheet with state intact', async () => {
    const {done} = await setup()
    try {
      fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
      fireEvent.press(screen.getByTestId('compose-backdrop'))
      expect(screen.getByTestId('composer-close-confirm')).toBeTruthy()
      fireEvent.press(screen.getByTestId('composer-close-keep'))
      expect(screen.queryByTestId('composer-close-confirm')).toBeNull()
      expect(mockGoBack).not.toHaveBeenCalled()
      expect(screen.getByTestId('composer-text').props.value).toBe('hello')
    } finally {
      done()
    }
  })

  it('back nav with a dirty draft is blocked and shows the guard', async () => {
    const {done} = await setup()
    try {
      fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
      const preventDefault = jest.fn()
      // The nav listener fires outside a press event, so state updates need
      // an explicit act flush before asserting on the sheet.
      act(() => {
        beforeRemoveListener()({preventDefault})
      })
      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('composer-close-confirm')).toBeTruthy()
      expect(mockGoBack).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('back nav with a clean draft proceeds untouched', async () => {
    const {done} = await setup()
    try {
      const preventDefault = jest.fn()
      beforeRemoveListener()({preventDefault})
      expect(preventDefault).not.toHaveBeenCalled()
      expect(screen.queryByTestId('composer-close-confirm')).toBeNull()
    } finally {
      done()
    }
  })
})

describe('ComposeScreen delete-and-redraft handoff', () => {
  // Same loaded-box budget (full-mount setup).
  jest.setTimeout(20000)
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
      // X9.2: the sheet chrome renders translated (English source catalog).
      expect(screen.getByText('Close')).toBeTruthy()
      expect(screen.queryByTestId('composer-text')).toBeNull()
    } finally {
      done()
    }
  })
})
