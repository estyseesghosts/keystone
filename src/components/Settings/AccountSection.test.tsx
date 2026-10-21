// Account identity block (P6): backend family/flavor label, handle, and
// the external-account note (v1 `/settings/account` parity).

import {render, screen} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {
  AccountSection,
  backendLabelFor,
  handleFor,
} from './AccountSection'

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
    ext: {me: {rejectQuotes: false}},
    ...overrides,
  }) as any

async function setup({
  session,
}: {
  session?: {
    family?: 'misskey' | 'mastodon'
    flavor?: string
    hosting?: 'first-party' | 'third-party'
    user?: any
  }
} = {}) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = session
    ? {
        family: session.family ?? 'misskey',
        me: jest.fn(async () => fakeAccount()),
        updateProfile: jest.fn(async () => fakeAccount()),
      }
    : null
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  if (session) {
    await sessionStore.add({
      origin: ORIGIN,
      family: session.family ?? 'misskey',
      flavor: (session.flavor ?? 'misskey') as 'misskey',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'password',
      hosting: session.hosting ?? 'third-party',
      ...(session.user === undefined ? {} : {user: session.user}),
    })
  }
  const rendered = render(
    <ThemeProvider theme="light">
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        <AccountSection onAddAccount={() => {}} onOpenFollowRequests={() => {}} />
      </SessionProvider>
    </ThemeProvider>,
  )
  return {
    done: () => {
      rendered.unmount()
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    },
  }
}

describe('AccountSection identity (P6)', () => {
  it('shows the backend label, handle, and external-account note', async () => {
    const {done} = await setup({session: {}})
    try {
      expect(await screen.findByTestId('settings-section-account')).toBeTruthy()
      expect(screen.getByText(`Signed in as alice on ${ORIGIN}.`)).toBeTruthy()
      expect(screen.getByTestId('account-backend-label')).toBeTruthy()
      const label = screen.getByTestId('account-backend-label').props.children.join('')
      expect(label).toBe('Misskey · Misskey family · @alice')
      // Third-party session with no first-party home: external.
      expect(screen.getByTestId('account-external-note')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('hides the external note for a first-party (home) session', async () => {
    const {done} = await setup({session: {hosting: 'first-party'}})
    try {
      expect(await screen.findByTestId('settings-section-account')).toBeTruthy()
      expect(screen.queryByTestId('account-external-note')).toBeNull()
      expect(screen.getByTestId('account-backend-label')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('keeps the signed-out copy', async () => {
    const {done} = await setup()
    try {
      expect(await screen.findByTestId('settings-section-account')).toBeTruthy()
      expect(screen.getByText('Signed out. Add an account to sign in.')).toBeTruthy()
      expect(screen.queryByTestId('account-backend-label')).toBeNull()
      expect(screen.queryByTestId('account-external-note')).toBeNull()
    } finally {
      done()
    }
  })

  it('falls back to the family name and stored id', () => {
    expect(backendLabelFor({family: 'mastodon', flavor: 'unknown'})).toBe('Mastodon family')
    expect(backendLabelFor({family: 'mastodon', flavor: 'akkoma'})).toBe(
      'Akkoma · Mastodon family',
    )
    expect(handleFor({accountId: 'alice'})).toBe('@alice')
    expect(handleFor({accountId: 'alice', user: null})).toBe('@alice')
  })
})
