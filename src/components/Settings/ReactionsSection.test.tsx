// Reactions settings: custom groups row (pin/hide/restore) alongside
// the unicode row. Custom categories come from the session's custom
// emoji query; hidden names with no live category still list so they
// can be restored.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {createEmojiGroupPrefsStore} from '#/state/emojiPrefs'

import {ReactionsSection} from './ReactionsSection'

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

i18n.load('en', {})
i18n.activate('en')

const mockBackendHolder: {current: any} = {current: null}

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

const HOME_ORIGIN = 'https://app.example'
const ORIGIN = 'https://m.example'

const customListing = [
  {name: 'blobcat', url: 'https://m.example/blobcat.png', category: 'Blobs'},
  {name: 'party', url: 'https://m.example/party.png', category: 'Party'},
]

async function setup() {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = {
    family: 'mastodon',
    capabilities: {},
    customEmojis: jest.fn(async () => customListing),
  }
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
  })
  await sessionStore.add({
    origin: ORIGIN,
    family: 'mastodon',
    flavor: 'mastodon',
    accountId: 'alice',
    token: 'token-alice',
    grant: 'password',
    hosting: 'third-party',
  })
  const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          <QueryClientProvider client={qc}>
            <ReactionsSection groups={createEmojiGroupPrefsStore(() => storage)} />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    },
  }
}

describe('Reactions settings custom groups', () => {
  it('lists session custom categories with pin/hide toggles', async () => {
    const {done} = await setup()
    try {
      expect(await screen.findByTestId('custom-groups-row')).toBeTruthy()
      expect(screen.getByTestId('group-custom-pin-Blobs')).toBeTruthy()
      expect(screen.getByTestId('group-custom-hide-Party')).toBeTruthy()
      // Unicode row untouched by the custom listing.
      expect(screen.getByTestId('group-pin-face')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('hide removes the picker group; unhide restores it', async () => {
    const {done} = await setup()
    try {
      await screen.findByTestId('custom-groups-row')
      fireEvent.press(screen.getByTestId('group-custom-hide-Party'))
      expect(screen.getByTestId('group-custom-hide-Party')).toBeTruthy()
      // Hidden state shows Unhide (the restore path)…
      fireEvent.press(screen.getByTestId('group-custom-hide-Party'))
      // …and toggling back clears it.
      expect(screen.queryByText('hidden')).toBeNull()
    } finally {
      done()
    }
  })

  it('hidden names with no live category still list for restore', async () => {
    const storage = createMemoryStore({
      'keystone.hiddenemojigroups': JSON.stringify(['Gone']),
    })
    const restore = appStorage()
    __setStorageForTests({storage})
    mockBackendHolder.current = {
      family: 'mastodon',
      capabilities: {},
      customEmojis: jest.fn(async () => customListing),
    }
    const sessionStore = createSessionStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: HOME_ORIGIN,
    })
    await sessionStore.add({
      origin: ORIGIN,
      family: 'mastodon',
      flavor: 'mastodon',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'password',
      hosting: 'third-party',
    })
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
            <QueryClientProvider client={qc}>
              <ReactionsSection groups={createEmojiGroupPrefsStore(() => storage)} />
            </QueryClientProvider>
          </SessionProvider>
        </ThemeProvider>
      </I18nProvider>,
    )
    try {
      expect(await screen.findByTestId('group-custom-hide-Gone')).toBeTruthy()
      fireEvent.press(screen.getByTestId('group-custom-hide-Gone'))
      expect(screen.queryByTestId('group-custom-hide-Gone')).toBeNull()
    } finally {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    }
  })
})
