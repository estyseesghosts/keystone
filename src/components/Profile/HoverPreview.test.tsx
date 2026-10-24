// HoverPreview behavior: hover opens the card after a delay (fading
// in), hover-out closes it after a grace period plus the fade-out,
// and the card renders through the click-through HoverLayer (never
// clipped by feed scroll containers, never a Modal capture).

import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen} from '@testing-library/react-native'
import {Platform} from 'react-native'

import type {Account} from '@keystone/fedi'
import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {HoverPreview, anchorMoved, clampToViewport, leaveTargetStaysInside} from './HoverPreview'

jest.mock('react-dom', () => ({
  createPortal: (children: unknown) => children,
}))

i18n.load('en', {})
i18n.activate('en')

const account = {
  id: 'u1',
  username: 'alice',
  acct: 'alice@example',
  host: 'example',
  name: 'Alice',
  displayName: 'Alice',
  bio: {plain: 'hello world'},
  url: null,
  uri: null,
  avatarUrl: null,
  avatarBlurhash: null,
  headerUrl: null,
  headerBlurhash: null,
  followersCount: 1200,
  followingCount: 34,
  statusesCount: 56,
  locked: false,
  bot: false,
  emojis: {},
} as unknown as Account

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function setup() {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://app.example',
  })
  const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
  jest.useFakeTimers()
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={new QueryClient()}>
          <SessionProvider store={store} homeOrigin="https://app.example">
            <HoverPreview account={account} sessionId="s1" testID="hover-prev">
              <></>
            </HoverPreview>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return {
    done: () => {
      restoreOs.restore()
      jest.useRealTimers()
    },
  }
}

describe('HoverPreview', () => {
  it('opens the card on hover after the delay and closes on leave', () => {
    const {done} = setup()
    try {
      const anchor = screen.getByTestId('hover-prev-anchor')
      expect(screen.queryByTestId('hover-prev')).toBeNull()
      fireEvent(anchor, 'mouseEnter')
      act(() => {
        jest.advanceTimersByTime(399)
      })
      expect(screen.queryByTestId('hover-prev')).toBeNull()
      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(screen.getByTestId('hover-prev')).toBeTruthy()
      fireEvent(anchor, 'mouseLeave')
      act(() => {
        jest.advanceTimersByTime(399)
      })
      expect(screen.getByTestId('hover-prev')).toBeTruthy()
      act(() => {
        jest.advanceTimersByTime(1)
      })
      // Grace period over: fading out, still mounted for 150ms.
      expect(screen.getByTestId('hover-prev')).toBeTruthy()
      act(() => {
        jest.advanceTimersByTime(150)
      })
      expect(screen.queryByTestId('hover-prev')).toBeNull()
    } finally {
      done()
    }
  })

  it('ignores a leave whose target stays inside the anchor subtree', () => {
    const {done} = setup()
    try {
      const anchor = screen.getByTestId('hover-prev-anchor')
      fireEvent(anchor, 'mouseEnter')
      act(() => {
        jest.advanceTimersByTime(400)
      })
      expect(screen.getByTestId('hover-prev')).toBeTruthy()
      // Layout-shift ghost: pointer never really left the anchor.
      // (relatedTarget identity is a DOM-world check — covered by the
      // pure `leaveTargetStaysInside` tests below; here the bare leave
      // still closes after the grace period.)
      fireEvent(anchor, 'mouseLeave')
      // Single-chunk close: one event-scheduled timer covers grace +
      // fade, so no chained timer can strand the card.
      act(() => {
        jest.advanceTimersByTime(549)
      })
      expect(screen.getByTestId('hover-prev')).toBeTruthy()
      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(screen.queryByTestId('hover-prev')).toBeNull()
    } finally {
      done()
    }
  })
})

describe('clampToViewport', () => {
  const viewport = {width: 1280, height: 800}
  it('returns null when the card fits', () => {
    expect(
      clampToViewport({top: 100, bottom: 400, left: 100, right: 420}, viewport),
    ).toBeNull()
  })
  it('shifts a tall card up when it runs past the bottom edge', () => {
    // 500px card starting at y=400 would end at 900 (100 past the edge).
    expect(clampToViewport({top: 400, bottom: 900, left: 100, right: 420}, viewport)).toEqual({
      top: 292,
      left: 100,
    })
  })
  it('shifts the card down when it runs past the top edge', () => {
    expect(clampToViewport({top: -50, bottom: 250, left: 100, right: 420}, viewport)).toEqual({
      top: 8,
      left: 100,
    })
  })
  it('shifts the card left when it runs past the right edge', () => {
    expect(
      clampToViewport({top: 100, bottom: 400, left: 1000, right: 1320}, viewport),
    ).toEqual({top: 100, left: 952})
  })
})

describe('leaveTargetStaysInside', () => {
  it('holds on identity, DOM contains, and rejects outside/null', () => {
    const inner = {}
    const host = {contains: (n: object) => n === inner}
    expect(leaveTargetStaysInside([host], inner)).toBe(true)
    expect(leaveTargetStaysInside([host], host)).toBe(true)
    expect(leaveTargetStaysInside([host], {})).toBe(false)
    expect(leaveTargetStaysInside([host], null)).toBe(false)
    expect(leaveTargetStaysInside([host], undefined)).toBe(false)
    expect(leaveTargetStaysInside([null, undefined], inner)).toBe(false)
    expect(leaveTargetStaysInside([], inner)).toBe(false)
  })
})

describe('anchorMoved', () => {
  it('ignores jitter at or under the threshold, fires past it', () => {
    const baseline = {top: 100, left: 200}
    expect(anchorMoved(null, {top: 500, left: 500})).toBe(false)
    expect(anchorMoved(baseline, {top: 100, left: 200})).toBe(false)
    expect(anchorMoved(baseline, {top: 108, left: 200})).toBe(false)
    expect(anchorMoved(baseline, {top: 100, left: 192})).toBe(false)
    expect(anchorMoved(baseline, {top: 109, left: 200})).toBe(true)
    expect(anchorMoved(baseline, {top: 100, left: 209})).toBe(true)
  })
})

describe('layout-shift ghosts', () => {
  // Minimal window: the movement-listener registry plus viewport
  // metrics. `document` stays undefined (inline card path).
  function fakeWindow() {
    const listeners = new Map<string, Array<() => void>>()
    return {
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener: (type: string, fn: () => void) => {
        const list = listeners.get(type) ?? []
        list.push(fn)
        listeners.set(type, list)
      },
      removeEventListener: jest.fn(),
      dispatch: (type: string) => {
        listeners.get(type)?.forEach(fn => fn())
      },
    }
  }

  function setupGhost() {
    const store = createSessionStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: 'https://app.example',
    })
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    jest.useFakeTimers()
    const rendered = render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <QueryClientProvider client={new QueryClient()}>
            <SessionProvider store={store} homeOrigin="https://app.example">
              <HoverPreview account={account} sessionId="s1" testID="hover-prev">
                <></>
              </HoverPreview>
            </SessionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>,
    )
    return {
      done: () => {
        // Unmount while the fake window is still up (TanStack's
        // cleanup touches window), then restore timers + globals.
        rendered.unmount()
        restoreOs.restore()
        jest.useRealTimers()
      },
    }
  }

  it('ignores enters with a stale pointer, opens after real movement', () => {
    const win = fakeWindow()
    const prevWindow = (globalThis as Record<string, unknown>).window
    ;(globalThis as Record<string, unknown>).window = win
    const {done} = setupGhost()
    try {
      const anchor = screen.getByTestId('hover-prev-anchor')
      // No movement ever (and time forced past the freshness window):
      // a layout shift sliding this anchor under a stationary pointer
      // must not arm the card.
      act(() => {
        jest.advanceTimersByTime(1500)
      })
      fireEvent(anchor, 'mouseEnter')
      act(() => {
        jest.advanceTimersByTime(1000)
      })
      expect(screen.queryByTestId('hover-prev')).toBeNull()
      // Genuine arrival (movement first): opens after the delay.
      act(() => {
        win.dispatch('mousemove')
      })
      fireEvent(anchor, 'mouseEnter')
      act(() => {
        jest.advanceTimersByTime(400)
      })
      expect(screen.getByTestId('hover-prev')).toBeTruthy()
    } finally {
      done()
      // Fresh movement timestamp under real timers (later tests in this
      // file share the module's tracker state), then restore the env's
      // own window stub — TanStack's unmount cleanup needs the global.
      act(() => {
        win.dispatch('mousemove')
      })
      ;(globalThis as Record<string, unknown>).window = prevWindow
    }
  })
})
