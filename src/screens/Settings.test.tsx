import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage, readDeviceState} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'
import {SETTINGS_SECTIONS} from '#/routes'

import {SettingsScreen} from './Settings'

const mockNavigateHolder: {current: jest.Mock} = {current: jest.fn()}
const mockRouteHolder: {current: {params?: unknown}} = {current: {}}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: (...args: Array<unknown>) => mockNavigateHolder.current(...args)}),
  useRoute: () => mockRouteHolder.current,
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

const misskeyBackend = () => ({
  family: 'misskey',
  capabilities: {},
  me: jest.fn(async () => fakeAccount()),
  updateProfile: jest.fn(async () => fakeAccount()),
  mutes: jest.fn(async () => ({
    items: [fakeAccount({id: 'm1', displayName: 'muted-one', acct: 'muted-one'})],
    cursor: null,
    end: true,
  })),
  blocks: jest.fn(async () => ({
    items: [fakeAccount({id: 'b1', displayName: 'blocked-one', acct: 'blocked-one'})],
    cursor: null,
    end: true,
  })),
  mute: jest.fn(async () => undefined),
  unmute: jest.fn(async () => undefined),
  muteRenotes: jest.fn(async () => undefined),
  unmuteRenotes: jest.fn(async () => undefined),
  block: jest.fn(async () => undefined),
  unblock: jest.fn(async () => undefined),
  search: {
    accounts: jest.fn(async () => ({
      items: [fakeAccount({id: 's1', displayName: 'found-one', acct: 'found-one'})],
      cursor: null,
      end: true,
    })),
  },
})

async function setup({backend, section}: {backend?: any; section?: unknown} = {}) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = backend ?? null
  mockRouteHolder.current = section === undefined ? {} : {params: {section}}
  mockNavigateHolder.current = jest.fn()
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
  const rendered = render(
    <ThemeProvider theme="light">
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        <SettingsScreen />
      </SessionProvider>
    </ThemeProvider>,
  )
  return {
    sessionStore,
    storage,
    navigate: mockNavigateHolder.current,
    done: () => {
      rendered.unmount()
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
      mockRouteHolder.current = {}
    },
  }
}

describe('Settings tree index', () => {
  it('lists all nine v1 sections', async () => {
    const {done} = await setup()
    try {
      for (const id of SETTINGS_SECTIONS) {
        expect(screen.getByTestId(`settings-row-${id}`)).toBeTruthy()
      }
      expect(screen.queryByTestId('settings-back')).toBeNull()
    } finally {
      done()
    }
  })

  it('navigates to the section route on row press', async () => {
    for (const id of SETTINGS_SECTIONS) {
      const {navigate, done} = await setup()
      try {
        fireEvent.press(screen.getByTestId(`settings-row-${id}`))
        expect(navigate).toHaveBeenCalledWith('Settings', {section: id})
      } finally {
        done()
      }
    }
  })

  it('deep-linked sections render directly with a working Back', async () => {
    for (const id of SETTINGS_SECTIONS) {
      const {navigate, done} = await setup({section: id})
      try {
        expect(screen.getByTestId(`settings-section-${id}`)).toBeTruthy()
        expect(screen.queryByTestId(`settings-row-${id}`)).toBeNull()
        fireEvent.press(screen.getByTestId('settings-back'))
        expect(navigate).toHaveBeenCalledWith('Settings', {})
      } finally {
        done()
      }
    }
  })

  it('falls back to the index on an unknown section', async () => {
    const {navigate, done} = await setup({section: 'nope'})
    try {
      for (const id of SETTINGS_SECTIONS) {
        expect(screen.getByTestId(`settings-row-${id}`)).toBeTruthy()
      }
      expect(screen.queryByTestId('settings-back')).toBeNull()
      expect(navigate).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })
})

describe('Display section', () => {
  it('persists colour mode and text size to device storage', async () => {
    const {storage, done} = await setup({section: 'display'})
    try {
      expect(screen.getByTestId('color-mode-system').props.accessibilityState.selected).toBe(true)
      fireEvent.press(screen.getByTestId('color-mode-dark'))
      expect(readDeviceState(storage).prefs.theme).toBe('dark')
      fireEvent.press(screen.getByTestId('text-size-increase'))
      expect(readDeviceState(storage).prefs.textScale).toBe(1.1)
      expect(screen.getByTestId('text-size-value').props.children.join('')).toBe('110%')
      fireEvent.press(screen.getByTestId('text-size-reset'))
      expect(readDeviceState(storage).prefs.textScale).toBe(1)
      // Emoji style lives here per v1 (relocated, not duplicated).
      expect(screen.getByTestId('emoji-style-openmoji')).toBeTruthy()
      // Theme/palette/font have no consumer: placeholders. Content mode
      // is real (P3): auto by default, persists to device storage.
      expect(screen.getByTestId('placeholder-theme').props.accessibilityState.disabled).toBe(true)
      expect(screen.getByTestId('placeholder-palette')).toBeTruthy()
      expect(screen.getByTestId('placeholder-font')).toBeTruthy()
      expect(screen.queryByTestId('placeholder-content-mode')).toBeNull()
      expect(screen.getByTestId('content-mode-auto').props.accessibilityState.selected).toBe(true)
      fireEvent.press(screen.getByTestId('content-mode-plain'))
      expect(readDeviceState(storage).prefs.contentMode).toBe('plain')
      expect(screen.getByTestId('content-mode-plain').props.accessibilityState.selected).toBe(true)
    } finally {
      done()
    }
  })
})

describe('Reactions section', () => {
  it('saves a custom like emoji device-locally and sends it to the server', async () => {
    const backend = misskeyBackend()
    const {storage, done} = await setup({backend, section: 'reactions'})
    try {
      expect(await screen.findByTestId('like-emoji-row')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('like-emoji-field'), '🍮')
      fireEvent.press(screen.getByTestId('like-emoji-save'))
      expect(storage.getItem(`keystone.likeemoji.${ORIGIN} alice`)).toBe('🍮')
      await waitFor(() =>
        expect(backend.updateProfile).toHaveBeenCalledWith({ext: {defaultReaction: '🍮'}}),
      )
      fireEvent.press(screen.getByTestId('like-emoji-reset'))
      expect(screen.getByTestId('like-emoji-current').props.children).toBe('❤')
    } finally {
      done()
    }
  })

  it('manages favourites per session', async () => {
    const {storage, done} = await setup({backend: misskeyBackend(), section: 'reactions'})
    try {
      expect(await screen.findByTestId('favourites-row')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('favourite-field'), '👍')
      fireEvent.press(screen.getByTestId('favourite-add'))
      expect(await screen.findByTestId('favourite-remove-👍')).toBeTruthy()
      fireEvent.press(screen.getByTestId('favourite-remove-👍'))
      await waitFor(() => expect(screen.queryByTestId('favourite-remove-👍')).toBeNull())
      expect(storage.getItem(`keystone.emojifavs.${ORIGIN} alice`)).toBe('[]')
    } finally {
      done()
    }
  })

  it('pins and hides unicode groups device-globally', async () => {
    const {storage, done} = await setup({backend: misskeyBackend(), section: 'reactions'})
    try {
      expect(await screen.findByTestId('unicode-groups-row')).toBeTruthy()
      fireEvent.press(screen.getByTestId('group-pin-symbols'))
      expect(JSON.parse(storage.getItem('keystone.pinnedemojigroups')!)).toEqual(['symbols'])
      fireEvent.press(screen.getByTestId('group-hide-face'))
      expect(JSON.parse(storage.getItem('keystone.hiddenemojigroups')!)).toEqual(['face'])
      expect(screen.getByTestId('placeholder-emoji-backup').props.accessibilityState.disabled).toBe(
        true,
      )
    } finally {
      done()
    }
  })
})

describe('Feeds section', () => {
  it('persists tab prefs device-locally', async () => {
    const {storage, done} = await setup({section: 'feeds'})
    try {
      fireEvent.press(screen.getByTestId('feed-show-local-toggle'))
      expect(JSON.parse(storage.getItem('keystone.feedprefs')!)).toEqual({
        showLocal: true,
        showFederated: true,
      })
      fireEvent.press(screen.getByTestId('feed-show-federated-toggle'))
      expect(JSON.parse(storage.getItem('keystone.feedprefs')!)).toEqual({
        showLocal: true,
        showFederated: false,
      })
    } finally {
      done()
    }
  })
})

describe('Mutes section', () => {
  it('lists mutes and blocks from fakes and unmutes/unblocks', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend, section: 'mutes'})
    try {
      expect(await screen.findByText('muted-one')).toBeTruthy()
      expect(screen.getByText('blocked-one')).toBeTruthy()
      fireEvent.press(screen.getAllByText('Unmute')[0])
      await waitFor(() => expect(backend.unmute).toHaveBeenCalledWith('m1'))
      fireEvent.press(screen.getAllByText('Unblock')[0])
      await waitFor(() => expect(backend.unblock).toHaveBeenCalledWith('b1'))
      // Renote-mute lists have no backend method: placeholder.
      expect(screen.getByTestId('placeholder-renote-mutes').props.accessibilityState.disabled).toBe(
        true,
      )
    } finally {
      done()
    }
  })

  it('saves a word filter through updateProfile', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend, section: 'mutes'})
    try {
      expect(await screen.findByTestId('wordfield-mutedWords')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('wordfield-mutedWords-input'), 'spoiler')
      fireEvent.press(screen.getByTestId('wordfield-mutedWords-save'))
      await waitFor(() =>
        expect(backend.updateProfile).toHaveBeenCalledWith({ext: {mutedWords: [['spoiler']]}}),
      )
    } finally {
      done()
    }
  })

  it('searches accounts and mutes from results', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend, section: 'mutes'})
    try {
      expect(await screen.findByTestId('mute-search')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('mute-search-input'), 'found')
      fireEvent.press(screen.getByTestId('mute-search-run'))
      expect(await screen.findByText('found-one')).toBeTruthy()
      fireEvent.press(screen.getByTestId('mute-search-mute-s1'))
      await waitFor(() => expect(backend.mute).toHaveBeenCalledWith('s1'))
    } finally {
      done()
    }
  })

  it('requires sign-in', async () => {
    const {done} = await setup({section: 'mutes'})
    try {
      expect(screen.getByText('Sign in to manage mutes and blocks.')).toBeTruthy()
    } finally {
      done()
    }
  })
})

describe('Filters section', () => {
  it('renders a placeholder on the Misskey family (no filter endpoints)', async () => {
    const {done} = await setup({backend: misskeyBackend(), section: 'filters'})
    try {
      expect(await screen.findByTestId('placeholder-filters')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('does full CRUD on backends with filters', async () => {
    const filters = {
      list: jest.fn(async () => [{id: 'f1', phrase: 'spoiler', context: [], expiresAt: null, irreversible: false, wholeWord: false}]),
      create: jest.fn(async (phrase: string) => ({id: 'f2', phrase, context: [], expiresAt: null, irreversible: false, wholeWord: false})),
      delete: jest.fn(async () => undefined),
    }
    const {done} = await setup({backend: {...misskeyBackend(), family: 'mastodon', filters}, section: 'filters'})
    try {
      expect(await screen.findByText('spoiler')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('filter-phrase-input'), 'leak')
      fireEvent.press(screen.getByTestId('filter-add'))
      await waitFor(() => expect(filters.create).toHaveBeenCalled())
      expect(await screen.findByText('leak')).toBeTruthy()
      fireEvent.press(screen.getByTestId('filter-remove-f1'))
      await waitFor(() => expect(filters.delete).toHaveBeenCalledWith('f1'))
    } finally {
      done()
    }
  })
})

describe('Import/export/language sections', () => {
  it('renders import/export placeholders and the language radio list', async () => {
    const {done} = await setup({backend: misskeyBackend(), section: 'import'})
    try {
      for (const kind of ['following', 'blocking', 'mute', 'notes']) {
        const row = screen.getByTestId(`placeholder-import-${kind}`)
        expect(row.props.accessibilityState.disabled).toBe(true)
      }
    } finally {
      done()
    }
    const second = await setup({backend: misskeyBackend(), section: 'export'})
    try {
      for (const kind of [
        'following',
        'blocking',
        'mute',
        'notes',
        'user-lists',
        'antennas',
        'clips',
        'favorites',
      ]) {
        expect(screen.getByTestId(`placeholder-export-${kind}`)).toBeTruthy()
      }
    } finally {
      second.done()
    }
    const third = await setup({backend: misskeyBackend(), section: 'language'})
    try {
      // P5: the language section is a real radio list now (no placeholders).
      for (const code of ['en', 'fr', 'de', 'zh-CN', 'zh-TW', 'yue-HK', 'ja', 'hi']) {
        expect(screen.getByTestId(`locale-${code}`)).toBeTruthy()
      }
      expect(screen.getByTestId('locale-en').props.accessibilityState.selected).toBe(true)
    } finally {
      third.done()
    }
  })
})

describe('Account section', () => {
  it('shows the session identity and persists quote refusal server-side', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend, section: 'account'})
    try {
      expect(await screen.findByTestId('settings-section-account')).toBeTruthy()
      expect(screen.getByText(`Signed in as alice on ${ORIGIN}.`)).toBeTruthy()
      const toggle = await screen.findByTestId('reject-quotes-toggle')
      fireEvent.press(toggle)
      await waitFor(() =>
        expect(backend.updateProfile).toHaveBeenCalledWith({ext: {rejectQuotes: true}}),
      )
    } finally {
      done()
    }
  })

  it('shows a placeholder for quote refusal on the Mastodon family', async () => {
    const {done} = await setup({backend: {...misskeyBackend(), family: 'mastodon'}, section: 'account'})
    try {
      expect(await screen.findByTestId('reject-quotes-placeholder')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('routes add-account and follow-requests through the navigator', async () => {
    const {navigate, done} = await setup({backend: misskeyBackend(), section: 'account'})
    try {
      expect(await screen.findByTestId('settings-section-account')).toBeTruthy()
      fireEvent.press(screen.getByText('Add account'))
      expect(navigate).toHaveBeenCalledWith('Login')
      fireEvent.press(screen.getByTestId('follow-requests-open'))
      expect(navigate).toHaveBeenCalledWith('FollowRequests')
    } finally {
      done()
    }
  })
})
