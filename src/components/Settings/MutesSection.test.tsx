// Mutes section C18: renote-mute list renders as a real two-way list when
// the backend exposes `renoteMutes`, and keeps the honest placeholder when
// it does not (the Mastodon family has no endpoint and stays absent).

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {SettingsScreen} from '#/screens/Settings'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn()}),
  // The mutes rows live on the `mutes` settings section route (W5 N3).
  useRoute: () => ({params: {section: 'mutes'}}),
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

const fakeAccount = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'u1',
    username: 'alice',
    acct: 'alice',
    host: null,
    name: null,
    displayName: 'alice',
    ext: {me: {rejectQuotes: false, mutedWords: [], hardMutedWords: [], mutedInstances: []}},
    ...overrides,
  }) as any

const emptyPage = () => ({items: [], cursor: null, end: true})

const baseBackend = () => ({
  family: 'misskey',
  capabilities: {},
  me: jest.fn(async () => fakeAccount()),
  updateProfile: jest.fn(async () => fakeAccount()),
  mutes: jest.fn(async () => emptyPage()),
  blocks: jest.fn(async () => emptyPage()),
  mute: jest.fn(async () => undefined),
  unmute: jest.fn(async () => undefined),
  muteRenotes: jest.fn(async () => undefined),
  unmuteRenotes: jest.fn(async () => undefined),
  block: jest.fn(async () => undefined),
  unblock: jest.fn(async () => undefined),
  search: {accounts: jest.fn(async () => emptyPage())},
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
      family: backend.family ?? 'misskey',
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
        <SettingsScreen />
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

describe('Mutes section renote-mutes (C18)', () => {
  it('keeps the honest placeholder when the backend has no list endpoint', async () => {
    const {done} = await setup({backend: baseBackend()})
    try {
      // Deep-linked straight to the mutes section route (W5 N3).
      expect(await screen.findByTestId('muted-list')).toBeTruthy()
      expect(screen.getByTestId('placeholder-renote-mutes').props.accessibilityState.disabled).toBe(
        true,
      )
      expect(screen.queryByTestId('renote-mutes-list')).toBeNull()
    } finally {
      done()
    }
  })

  it('lists repost-mutes and unmutes when the backend exposes renoteMutes', async () => {
    const backend = {
      ...baseBackend(),
      renoteMutes: jest.fn(async () => ({
        items: [fakeAccount({id: 'r1', displayName: 'renote-muted', acct: 'renote-muted'})],
        cursor: null,
        end: true,
      })),
    }
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('renote-mutes-list')).toBeTruthy()
      expect(screen.getByText('renote-muted')).toBeTruthy()
      expect(screen.queryByTestId('placeholder-renote-mutes')).toBeNull()
      fireEvent.press(screen.getByText('Unmute reposts'))
      await waitFor(() => expect(backend.unmuteRenotes).toHaveBeenCalledWith('r1'))
    } finally {
      done()
    }
  })
})

describe('Mutes section search undo (C17)', () => {
  // Stateful fake: relations and the renote-mute list move with actions.
  const relationBackend = () => {
    const muted = new Set<string>(['s1'])
    const blocked = new Set<string>(['s2'])
    const renoteMuted = new Set<string>(['s1'])
    const rels = (ids: string[]) =>
      ids.map(id => ({id, isMuted: muted.has(id), isBlocked: blocked.has(id)}))
    return {
      ...baseBackend(),
      relationships: jest.fn(async (ids: string[]) => rels(ids)),
      mute: jest.fn(async (id: string) => {
        muted.add(id)
      }),
      unmute: jest.fn(async (id: string) => {
        muted.delete(id)
      }),
      block: jest.fn(async (id: string) => {
        blocked.add(id)
      }),
      unblock: jest.fn(async (id: string) => {
        blocked.delete(id)
      }),
      muteRenotes: jest.fn(async (id: string) => {
        renoteMuted.add(id)
      }),
      unmuteRenotes: jest.fn(async (id: string) => {
        renoteMuted.delete(id)
      }),
      renoteMutes: jest.fn(async () => ({
        items: [...renoteMuted].map(id =>
          fakeAccount({id, displayName: `name-${id}`, acct: `acct-${id}`}),
        ),
        cursor: null,
        end: true,
      })),
      search: {
        accounts: jest.fn(async () => ({
          items: [
            fakeAccount({id: 's1', displayName: 'found-one', acct: 'found-one'}),
            fakeAccount({id: 's2', displayName: 'found-two', acct: 'found-two'}),
          ],
          cursor: null,
          end: true,
        })),
      },
    }
  }

  async function searchOnce() {
    fireEvent.changeText(screen.getByTestId('mute-search-input'), 'found')
    fireEvent.press(screen.getByTestId('mute-search-run'))
    expect(await screen.findByText('found-one')).toBeTruthy()
  }

  it('renders relation-loaded labels after search', async () => {
    const {done} = await setup({backend: relationBackend()})
    try {
      await searchOnce()
      // s1 starts muted + renote-muted: undo paths.
      expect(await screen.findByTestId('mute-search-unmute-s1')).toBeTruthy()
      expect(screen.getByTestId('mute-search-unmuterenotes-s1')).toBeTruthy()
      expect(screen.getByTestId('mute-search-block-s1')).toBeTruthy()
      // s2 starts blocked only: one-way mute, one-way renote-mute, unblock.
      expect(screen.getByTestId('mute-search-mute-s2')).toBeTruthy()
      expect(screen.getByTestId('mute-search-muterenotes-s2')).toBeTruthy()
      expect(screen.getByTestId('mute-search-unblock-s2')).toBeTruthy()
      expect(screen.queryByTestId('mute-search-mute-s1')).toBeNull()
      expect(screen.queryByTestId('mute-search-block-s2')).toBeNull()
    } finally {
      done()
    }
  })

  it('unmute round-trips through a relation re-read', async () => {
    const backend = relationBackend()
    const {done} = await setup({backend})
    try {
      await searchOnce()
      fireEvent.press(await screen.findByTestId('mute-search-unmute-s1'))
      await waitFor(() => expect(backend.unmute).toHaveBeenCalledWith('s1'))
      // The re-read flips the label back to the one-way Mute.
      expect(await screen.findByTestId('mute-search-mute-s1')).toBeTruthy()
      expect(screen.queryByTestId('mute-search-unmute-s1')).toBeNull()
    } finally {
      done()
    }
  })

  it('unblock round-trips through a relation re-read', async () => {
    const backend = relationBackend()
    const {done} = await setup({backend})
    try {
      await searchOnce()
      fireEvent.press(await screen.findByTestId('mute-search-unblock-s2'))
      await waitFor(() => expect(backend.unblock).toHaveBeenCalledWith('s2'))
      expect(await screen.findByTestId('mute-search-block-s2')).toBeTruthy()
      expect(screen.queryByTestId('mute-search-unblock-s2')).toBeNull()
    } finally {
      done()
    }
  })

  it('renote unmute round-trips through the list re-read', async () => {
    const backend = relationBackend()
    const {done} = await setup({backend})
    try {
      await searchOnce()
      fireEvent.press(await screen.findByTestId('mute-search-unmuterenotes-s1'))
      await waitFor(() => expect(backend.unmuteRenotes).toHaveBeenCalledWith('s1'))
      expect(await screen.findByTestId('mute-search-muterenotes-s1')).toBeTruthy()
      expect(screen.queryByTestId('mute-search-unmuterenotes-s1')).toBeNull()
    } finally {
      done()
    }
  })

  it('keeps one-way buttons when relations are unsupported', async () => {
    const backend = {
      ...baseBackend(),
      // No `relationships`, no `renoteMutes`: the misskeyBackend shape in
      // Settings.test (and old servers) must not crash or error.
      search: {
        accounts: jest.fn(async () => ({
          items: [fakeAccount({id: 's1', displayName: 'found-one', acct: 'found-one'})],
          cursor: null,
          end: true,
        })),
      },
    }
    const {done} = await setup({backend})
    try {
      await searchOnce()
      expect(await screen.findByTestId('mute-search-mute-s1')).toBeTruthy()
      expect(screen.getByTestId('mute-search-muterenotes-s1')).toBeTruthy()
      expect(screen.getByTestId('mute-search-block-s1')).toBeTruthy()
      expect(screen.queryByTestId('mute-search-unmute-s1')).toBeNull()
      expect(screen.queryByTestId('mute-search-unblock-s1')).toBeNull()
      expect(screen.queryByTestId('mute-search-unmuterenotes-s1')).toBeNull()
      // One-way actions still work.
      fireEvent.press(screen.getByTestId('mute-search-mute-s1'))
      await waitFor(() => expect(backend.mute).toHaveBeenCalledWith('s1'))
    } finally {
      done()
    }
  })
})
