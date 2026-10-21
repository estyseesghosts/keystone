// Clip detail screen: signed-out, unsupported, name + feed posts,
// honest missing state. The feed runs through the real FeedView against
// a fake `clips.notes`.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {makePost} from '#/components/__tests__/fixtures'

import {ClipScreen} from './Clip'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: {id: 'c1'}}),
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
  i18n.load('en', {})
  i18n.activate('en')
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
            <ClipScreen />
          </SessionProvider>
        </QueryClientProvider>
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

const post = makePost({id: 'p1', content: {mfm: 'clipped post', plain: 'clipped post'}})

const fullBackend = () => ({
  family: 'misskey',
  capabilities: {clips: 'supported'},
  clips: {
    list: jest.fn(async () => [{id: 'c1', name: 'Fun'}]),
    notes: jest.fn(async () => ({items: [post], cursor: null, end: true})),
  },
})

describe('Clip screen', () => {
  it('asks to sign in when signed out', async () => {
    const {done} = await setup()
    try {
      expect(screen.getByText('Sign in to see this clip.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('is honestly unavailable without a clips module', async () => {
    const {done} = await setup({backend: {family: 'misskey', capabilities: {}}})
    try {
      expect(await screen.findByText('Clips are not available on this server.')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('shows the clip name and its notes', async () => {
    const backend = fullBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByText('Fun')).toBeTruthy()
      expect(await screen.findByText('clipped post')).toBeTruthy()
      expect(backend.clips.notes).toHaveBeenCalledWith('c1', expect.anything())
    } finally {
      done()
    }
  })

  it('is honest when the clip does not exist', async () => {
    const {done} = await setup({
      backend: {
        family: 'misskey',
        capabilities: {clips: 'supported'},
        clips: {
          list: jest.fn(async () => [{id: 'other', name: 'Other'}]),
          notes: jest.fn(async () => ({items: [], cursor: null, end: true})),
        },
      },
    })
    try {
      expect(await screen.findByText('This clip does not exist.')).toBeTruthy()
    } finally {
      done()
    }
  })
})
