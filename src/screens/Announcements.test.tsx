// Announcements screen (clickstone §1.12): signed-out, capability/unknown
// gate, newest-first list + read states, dismiss (success and 404), honest
// empty and load-error states. Runs through the real backend seam (a fake
// `announcements` module), so the capability gate is genuinely exercised.

import {fireEvent, render, screen} from '@testing-library/react-native'

import {createMemoryStore, ApiError, type Announcement} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {
  AnnouncementsScreen,
  announcementReadLabel,
  sortAnnouncementsNewestFirst,
} from './Announcements'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn()}),
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
  render(
    <ThemeProvider theme="light">
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        <AnnouncementsScreen />
      </SessionProvider>
    </ThemeProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    },
  }
}

const announcement = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: 'a1',
  title: 'Maintenance',
  content: {mfm: 'Server restarts at 03:00 UTC.', plain: 'Server restarts at 03:00 UTC.'},
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: null,
  imageUrl: null,
  icon: 'warning',
  needConfirmationToRead: false,
  startsAt: null,
  endsAt: null,
  allDay: false,
  isRead: false,
  ...overrides,
})

const fullBackend = (module: any = {}) => ({
  family: 'misskey',
  capabilities: {announcements: 'supported'},
  announcements: {
    list: jest.fn(async () => [announcement()]),
    dismiss: jest.fn(async () => undefined),
    ...module,
  },
})

describe('Announcements screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to read server announcements.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without an announcements module', async () => {
    const {done} = await setup({backend: {family: 'pinetree', capabilities: {announcements: 'unsupported'}}})
    try {
      expect(await screen.findByText('Announcements are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('does not unlock an unknown capability even when the module exists', async () => {
    const {done} = await setup({
      backend: {
        family: 'misskey',
        capabilities: {announcements: 'unknown'},
        announcements: fullBackend().announcements,
      },
    })
    try {
      expect(await screen.findByText('Announcements are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('lists announcements newest-first with their read state', async () => {
    const older = announcement({
      id: 'old',
      title: 'Older notice',
      createdAt: '2026-10-01T10:00:00.000Z',
      isRead: true,
    })
    const newer = announcement({id: 'new', title: 'Newer notice'})
    const backend = fullBackend({list: jest.fn(async () => [older, newer])})
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Newer notice')).toBeTruthy()
      expect(screen.getByText('Older notice')).toBeTruthy()
      // Sort is the screen's decision (Mastodon sends oldest-first).
      expect(sortAnnouncementsNewestFirst([older, newer]).map(a => a.id)).toEqual(['new', 'old'])
      expect(screen.getByTestId('announcements-state-new').props.children).toBe('Unread')
      expect(screen.getByTestId('announcements-state-old').props.children).toBe('Read')
    } finally {
      done()
    }
  })

  it('dismisses an unread announcement and flips its read state', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      fireEvent.press(await screen.findByTestId('announcements-dismiss-a1'))
      expect(backend.announcements.dismiss).toHaveBeenCalledWith('a1')
      // The server records exactly "read": the row mirrors that, no removal.
      expect(await screen.findByTestId('announcements-state-a1')).toBeTruthy()
      expect(screen.getByTestId('announcements-state-a1').props.children).toBe('Read')
      expect(screen.queryByTestId('announcements-dismiss-a1')).toBeNull()
    } finally {
      done()
    }
  })

  it('disables dismiss with a reason when the family has no dismiss member', async () => {
    const module = fullBackend().announcements
    const {done} = await setup({backend: fullBackend({...module, dismiss: undefined})})
    try {
      const button = await screen.findByTestId('announcements-dismiss-a1')
      expect(button.props.accessibilityState.disabled).toBe(true)
      expect(button.props.accessibilityLabel).toMatch(/does not support marking announcements/i)
    } finally {
      done()
    }
  })

  it('disables dismiss with a reason when the endpoint 404s on this fork', async () => {
    const backend = fullBackend({
      dismiss: jest.fn(async () => {
        throw new ApiError('HTTP 404', 404)
      }),
    })
    const {done} = await setup({backend})
    try {
      fireEvent.press(await screen.findByTestId('announcements-dismiss-a1'))
      const button = await screen.findByTestId('announcements-dismiss-a1')
      expect(button.props.accessibilityState.disabled).toBe(true)
      expect(button.props.accessibilityLabel).toMatch(/does not provide the announcement dismiss/i)
    } finally {
      done()
    }
  })

  it('shows an honest empty state', async () => {
    const {done} = await setup({backend: fullBackend({list: jest.fn(async () => [])})})
    try {
      expect(await screen.findByText('No announcements from this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('shows a load error with retry, not a fake empty list', async () => {
    const list = jest.fn(async () => {
      throw new Error('network down')
    })
    const {done} = await setup({backend: fullBackend({list})})
    try {
      expect(await screen.findByText('Could not load announcements.')).toBeTruthy()
      fireEvent.press(screen.getByTestId('announcements-retry'))
      expect(list).toHaveBeenCalledTimes(2)
    } finally {
      done()
    }
  })

  it('treats a 404 list as the unsupported server state', async () => {
    const list = jest.fn(async () => {
      throw new ApiError('HTTP 404', 404)
    })
    const {done} = await setup({backend: fullBackend({list})})
    try {
      expect(await screen.findByText('Announcements are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('labels an unreported read flag as unknown, never unread', () => {
    expect(announcementReadLabel(announcement({isRead: null}))).toBe('Read state unknown')
    expect(announcementReadLabel(announcement({isRead: true}))).toBe('Read')
    expect(announcementReadLabel(announcement({isRead: false}))).toBe('Unread')
  })
})
