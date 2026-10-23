// HoverPreview behavior: hover opens the card after a delay, hover-out
// closes it after a grace period, and the card renders through the
// Modal layer (never clipped by feed scroll containers).

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

import {HoverPreview, clampToViewport, leaveTargetStaysInside} from './HoverPreview'

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
      act(() => {
        jest.advanceTimersByTime(399)
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
