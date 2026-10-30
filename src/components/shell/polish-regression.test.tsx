// polish/6-regression (Deliverable 6): gap-fill pins for changed surface
// the slices left unasserted. Slice 5 touched Pagehead, MobileStrip, and
// the AccountMenu trigger (raw RN Pressable → shared Pressable + new
// Tooltip) but nav-polish.test.tsx only pinned Sidebar + rail chrome.
// Slice 2–4 changed the rail body without pinning that the Tooltip stays
// shell-only. None of these assertions exist elsewhere — verified by grep
// before adding (no Pagehead/strip/account-trigger tooltip or press test,
// no post-tree Tooltip-absence pin).
//
// Quote/repost rendering itself is NOT duplicated here: PostCard trees
// import nothing the polish chain touched (grep: zero hits for Tooltip,
// shell/*, widgetsPanel, #/widgets in Post/Note paths), and the existing
// suites (Post/quotes, __tests__/post boost headers) are preserved as-is.
// The last describe only pins the composition risk the new Tooltip
// introduced: no tooltip wrapper may appear inside post rendering.

import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {Platform} from 'react-native'
import {SafeAreaProvider} from 'react-native-safe-area-context'

import {createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {Pagehead} from '#/components/Pagehead'
import {PostCard} from '#/components/Post/index'
import {AccountButton} from '#/components/shell/AccountMenu'
import {MobileStrip} from '#/components/shell/MobileStrip'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {navigationRef} from '#/navigationRef'
import {i18n} from '#/locale/i18n'
import {makeAccount, makePost} from '../__tests__/fixtures'

// Switchable shell width: Pagehead renders on rail/full, null on mobile.
const widthHolder: {width: number} = {width: 1280}
jest.mock('#/alf/useViewportWidth', () => ({
  useViewportWidth: () => widthHolder.width,
}))

jest.mock('expo-video', () => {
  const React = require('react')
  const {View} = require('react-native')
  return {
    useVideoPlayer: () => ({
      play: jest.fn(),
      pause: jest.fn(),
      addListener: () => ({remove: jest.fn()}),
    }),
    VideoView: ({testID}: {testID?: string}) => <View testID={testID} />,
  }
})

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

async function signedInStore(): Promise<ReturnType<typeof createSessionStore>> {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://app.example',
  })
  await store.add({
    origin: 'https://mastodon.example',
    family: 'mastodon',
    flavor: 'mastodon',
    accountId: 'alice',
    token: 'token-a',
    grant: 'oauth-pkce',
    hosting: 'third-party',
  })
  return store
}

function providers(children: React.ReactElement, store?: ReturnType<typeof createSessionStore>) {
  return render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        {store ? (
          <SessionProvider store={store} homeOrigin="https://app.example">
            <ThemeProvider theme="light">
              <SafeAreaProvider
                initialMetrics={{
                  frame: {x: 0, y: 0, width: 390, height: 844},
                  insets: {top: 47, bottom: 0, left: 0, right: 0},
                }}>
                {children}
              </SafeAreaProvider>
            </ThemeProvider>
          </SessionProvider>
        ) : (
          <ThemeProvider theme="light">
            <SafeAreaProvider
              initialMetrics={{
                frame: {x: 0, y: 0, width: 390, height: 844},
                insets: {top: 47, bottom: 0, left: 0, right: 0},
              }}>
              {children}
            </SafeAreaProvider>
          </ThemeProvider>
        )}
      </QueryClientProvider>
    </I18nProvider>,
  )
}

/** Titles of every Tooltip wrapper in the current tree (host spans only). */
function tooltipTitles(): string[] {
  return screen
    .UNSAFE_queryAllByType('span' as never)
    .map(el => (el.props as {title?: unknown}).title)
    .filter((title): title is string => typeof title === 'string')
}

function navMocks() {
  const ref = navigationRef as unknown as {
    isReady: jest.Mock
    canGoBack: jest.Mock
    goBack: jest.Mock
    navigate: jest.Mock
  }
  // createNavigationContainerRef without a container is never ready;
  // drive it explicitly per test instead of mocking the module.
  jest.spyOn(ref, 'isReady').mockReturnValue(true)
  jest.spyOn(ref, 'canGoBack').mockReturnValue(true)
  jest.spyOn(ref, 'goBack').mockImplementation(() => {})
  jest.spyOn(ref, 'navigate').mockImplementation((..._args: unknown[]) => {})
  return ref
}

describe('Pagehead back (slice-5 Pressable swap)', () => {
  it('names the icon-only back control on web, mirroring its label', () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      widthHolder.width = 1280
      providers(<Pagehead title="Home" />)
      expect(tooltipTitles()).toContain('Back')
      expect(screen.getByTestId('pagehead-back').props.accessibilityLabel).toBe('Back')
      expect(screen.getByText('Home')).toBeTruthy()
    } finally {
      restoreOs.restore()
    }
  })

  it('goes back when history exists, falls back to Home on a deep link', () => {
    widthHolder.width = 1280
    const ref = navMocks()
    providers(<Pagehead title="Home" />)
    fireEvent.press(screen.getByTestId('pagehead-back'))
    expect(ref.goBack).toHaveBeenCalledTimes(1)
    ;(ref.canGoBack as jest.Mock).mockReturnValue(false)
    fireEvent.press(screen.getByTestId('pagehead-back'))
    expect(ref.navigate).toHaveBeenCalledWith('Main', {screen: 'Home'})
    jest.restoreAllMocks()
  })

  it('stays out of the mobile layout (strip owns back there)', () => {
    widthHolder.width = 390
    providers(<Pagehead title="Home" />)
    expect(screen.queryByTestId('pagehead-back')).toBeNull()
    expect(screen.queryByText('Home')).toBeNull()
  })
})

describe('MobileStrip back (slice-5 Pressable swap)', () => {
  it('names the back control on web and keeps the section title', () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      providers(<MobileStrip leaf={{name: 'Home'}} />)
      expect(tooltipTitles()).toContain('Back')
      expect(screen.getByTestId('strip-back').props.accessibilityLabel).toBe('Back')
      expect(screen.getByText('Home')).toBeTruthy()
    } finally {
      restoreOs.restore()
    }
  })

  it('falls back to the feed tab when there is no back history', () => {
    const ref = navMocks()
    ;(ref.canGoBack as jest.Mock).mockReturnValue(false)
    providers(<MobileStrip leaf={{name: 'Home'}} />)
    fireEvent.press(screen.getByTestId('strip-back'))
    expect(ref.goBack).not.toHaveBeenCalled()
    expect(ref.navigate).toHaveBeenCalledWith('Main', expect.objectContaining({screen: 'Home'}))
    jest.restoreAllMocks()
  })
})

describe('AccountMenu trigger (slice-5 Pressable swap)', () => {
  it('names the avatar trigger on web and opens the menu on press', async () => {
    const store = await signedInStore()
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      providers(<AccountButton testPrefix="reg-account" menuSide="below" />, store)
      expect(tooltipTitles()).toContain('Account menu')
      const trigger = screen.getByTestId('reg-account')
      expect(trigger.props.accessibilityLabel).toBe('Account menu')
      expect(trigger.props.accessibilityState).toMatchObject({expanded: false})
      fireEvent.press(trigger)
      expect(screen.getByTestId('reg-account-menu')).toBeTruthy()
      expect(screen.getByTestId('reg-account').props.accessibilityState).toMatchObject({
        expanded: true,
      })
    } finally {
      restoreOs.restore()
    }
  })
})

describe('post rendering stays Tooltip-free (D6 quote/repost risk pin)', () => {
  it('quote card + repost attribution render with no tooltip wrapper', () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      const quoted = makePost({id: 'q1'})
      const quotePost = makePost({
        id: 'p1',
        content: {mfm: 'look at this', plain: 'look at this'},
        renoteId: 'q1',
        renote: quoted,
        quote: quoted,
      })
      const boostTarget = makePost({id: 'orig'})
      const boost = makePost({
        id: 'wrap',
        author: makeAccount({id: 'b1', username: 'bob', acct: 'bob', host: null, name: 'Bob', displayName: 'Bob'}),
        content: {plain: ''},
        renoteId: 'orig',
        renote: boostTarget,
      })
      render(
        <I18nProvider i18n={i18n}>
          <ThemeProvider theme="light">
            <PostCard post={quotePost} sessionId="sess-1" />
            <PostCard post={boost} sessionId="sess-1" />
          </ThemeProvider>
        </I18nProvider>,
      )
      // Quote + repost presentation unchanged by the polish chain.
      expect(screen.getByTestId('post-quote-p1-card')).toBeTruthy()
      expect(screen.getByTestId('boost-header-wrap')).toBeTruthy()
      // The new Tooltip never leaked into post rendering on any platform.
      expect(tooltipTitles()).toHaveLength(0)
    } finally {
      restoreOs.restore()
    }
  })
})
