// C13 tests: the profile editor loads `me()`, gates Misskey-only rows by
// family, saves via `backend.updateProfile`, and surfaces errors honestly.
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {ProfileEditorScreen} from './ProfileEditor'

const mockGoBack = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn(), goBack: mockGoBack}),
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

const fakeMe = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'u1',
    username: 'alice',
    acct: 'alice',
    host: null,
    name: 'Alice',
    displayName: 'Alice',
    bio: {plain: 'hello'},
    url: null,
    uri: null,
    avatarUrl: null,
    avatarBlurhash: null,
    headerUrl: null,
    headerBlurhash: null,
    followersCount: 1,
    followingCount: 2,
    statusesCount: 3,
    locked: false,
    bot: false,
    cat: false,
    silenced: false,
    suspended: false,
    onlineStatus: null,
    location: 'Paris',
    birthday: '1990-01-01',
    createdAt: null,
    updatedAt: null,
    lastFetchedAt: null,
    emojis: {},
    fields: [{name: 'site', value: 'example.com', verifiedAt: null}],
    movedTo: null,
    ffVisibility: 'public',
    pinnedPostIds: null,
    pinnedPosts: null,
    ext: {me: {followedMessage: 'hi followers', lang: 'en'}},
    ...overrides,
  }) as any

const misskeyBackend = (overrides: Record<string, unknown> = {}) => ({
  family: 'misskey',
  capabilities: {},
  me: jest.fn(async () => fakeMe()),
  updateProfile: jest.fn(async () => fakeMe()),
  ...overrides,
})

async function setup({backend, family = 'misskey'}: {backend?: any; family?: string} = {}) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = backend ?? null
  mockGoBack.mockClear()
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  if (backend) {
    await sessionStore.add({
      origin: ORIGIN,
      family,
      flavor: family === 'mastodon' ? 'mastodon' : 'misskey',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'password',
      hosting: 'third-party',
    } as any)
  }
  render(
    <ThemeProvider theme="light">
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        <ProfileEditorScreen />
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

describe('ProfileEditorScreen (misskey family)', () => {
  it('loads the profile, saves editable rows, and goes back', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-name')).toBeTruthy())
      expect(screen.getByTestId('profile-editor-name').props.value).toBe('Alice')
      expect(screen.getByTestId('profile-editor-location').props.editable).toBe(true)

      fireEvent.changeText(screen.getByTestId('profile-editor-name'), 'Alice Cooper')
      fireEvent.press(screen.getByTestId('profile-editor-save'))

      await waitFor(() => expect(backend.updateProfile).toHaveBeenCalled())
      const calls = backend.updateProfile.mock.calls as unknown[][]
      const patch = calls[0]?.[0] as Record<string, unknown>
      expect(patch.name).toBe('Alice Cooper')
      expect(patch.location).toBe('Paris')
      expect(patch.birthday).toBe('1990-01-01')
      expect(patch.followedMessage).toBe('hi followers')
      expect(patch.lang).toBe('en')
      expect(patch.fields).toEqual([{name: 'site', value: 'example.com'}])
      await waitFor(() => expect(mockGoBack).toHaveBeenCalled())
    } finally {
      done()
    }
  })

  it('supports adding and removing profile fields', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-name')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-field-add'))
      expect(screen.getByTestId('profile-editor-field-name-1')).toBeTruthy()
      fireEvent.changeText(screen.getByTestId('profile-editor-field-name-1'), 'blog')
      fireEvent.changeText(screen.getByTestId('profile-editor-field-value-1'), 'https://x.example')
      fireEvent.press(screen.getByTestId('profile-editor-field-remove-0'))
      fireEvent.press(screen.getByTestId('profile-editor-save'))
      await waitFor(() => expect(backend.updateProfile).toHaveBeenCalled())
      const fieldCalls = backend.updateProfile.mock.calls as unknown[][]
      expect((fieldCalls[0]?.[0] as Record<string, unknown>).fields).toEqual([
        {name: 'blog', value: 'https://x.example'},
      ])
    } finally {
      done()
    }
  })

  it('surfaces save errors honestly and stays on the screen', async () => {
    const backend = misskeyBackend({
      updateProfile: jest.fn(async () => {
        throw new Error('invalid birthday')
      }),
    })
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-name')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-save'))
      await waitFor(() => expect(screen.getByTestId('profile-editor-error')).toBeTruthy())
      expect(screen.getByTestId('profile-editor-error')).toHaveTextContent('invalid birthday')
      expect(mockGoBack).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('renders avatar/banner disabled with a reason', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar')).toBeTruthy())
      expect(screen.getByTestId('profile-editor-avatar').props.editable).toBe(false)
      expect(screen.getByTestId('profile-editor-banner').props.editable).toBe(false)
      expect(screen.getAllByText(/not available in this editor yet/).length).toBe(2)
    } finally {
      done()
    }
  })
})

describe('ProfileEditorScreen (mastodon family)', () => {
  it('disables Misskey-only rows with a reason and omits them from the patch', async () => {
    const backend = misskeyBackend()
    backend.family = 'mastodon'
    const {done} = await setup({backend, family: 'mastodon'})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-name')).toBeTruthy())
      for (const id of [
        'profile-editor-location',
        'profile-editor-birthday',
        'profile-editor-followedMessage',
        'profile-editor-lang',
      ]) {
        expect(screen.getByTestId(id).props.editable).toBe(false)
      }
      expect(screen.getAllByText('Only available on Misskey-family servers.').length).toBe(4)
      expect(screen.getAllByText(/not supported on the Mastodon family yet/).length).toBe(2)

      fireEvent.press(screen.getByTestId('profile-editor-save'))
      await waitFor(() => expect(backend.updateProfile).toHaveBeenCalled())
      const mastoCalls = backend.updateProfile.mock.calls as unknown[][]
      const patch = mastoCalls[0]?.[0] as Record<string, unknown>
      expect(patch.location).toBeUndefined()
      expect(patch.birthday).toBeUndefined()
      expect(patch.followedMessage).toBeUndefined()
      expect(patch.lang).toBeUndefined()
      expect(patch.name).toBe('Alice')
    } finally {
      done()
    }
  })
})

describe('ProfileEditorScreen (signed out)', () => {
  it('asks to sign in instead of showing the form', async () => {
    const {done} = await setup()
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor')).toBeTruthy())
      expect(screen.getByText('Sign in to edit your profile.')).toBeTruthy()
      expect(screen.queryByTestId('profile-editor-save')).toBeNull()
    } finally {
      done()
    }
  })
})
