// List screen: signed-out, unsupported, and missing-list states resolve
// through the catalog (translated chrome), never hard-coded literals.

import {render, screen} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'

import {ListScreen} from './List'

const routeHolder: {id: string} = {id: 'l1'}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: {id: routeHolder.id}}),
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

async function setup({backend}: {backend?: any} = {}, locale: 'en' | 'fr' = 'en') {
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
      family: 'mastodon',
      flavor: 'mastodon',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'oauth-pkce',
      hosting: 'third-party',
    })
  }
  i18n.load('en', {})
  i18n.activate(locale)
  render(
    <ThemeProvider theme="light">
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        <ListScreen />
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

describe('List screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see this list.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('renders signed-out chrome through the catalog (translated)', async () => {
    i18n.load('fr', {'list.signedOut': 'FR_SIGN_IN_LIST'})
    const {done} = await setup({}, 'fr')
    try {
      expect(await screen.findByText('FR_SIGN_IN_LIST')).toBeTruthy()
    } finally {
      i18n.activate('en')
      done()
    }
  })

  it('is honestly unavailable without a lists module', async () => {
    const {done} = await setup({backend: {family: 'mastodon', capabilities: {}}})
    try {
      expect(await screen.findByText('Lists are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('says honestly when the list does not exist', async () => {
    const {done} = await setup({
      backend: {
        family: 'mastodon',
        capabilities: {lists: 'supported'},
        lists: {list: jest.fn(async () => [{id: 'other', name: 'Other'}])},
      },
    })
    try {
      expect(await screen.findByText('This list does not exist.')).toBeTruthy()
    } finally {
      done()
    }
  })
})
