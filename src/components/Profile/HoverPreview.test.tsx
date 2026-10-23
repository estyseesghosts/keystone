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

import {HoverPreview} from './HoverPreview'

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
      fireEvent(anchor, 'hoverIn')
      act(() => {
        jest.advanceTimersByTime(399)
      })
      expect(screen.queryByTestId('hover-prev')).toBeNull()
      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(screen.getByTestId('hover-prev')).toBeTruthy()
      fireEvent(anchor, 'hoverOut')
      act(() => {
        jest.advanceTimersByTime(249)
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
