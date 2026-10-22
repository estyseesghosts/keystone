// C13 + §1.8 tests: the profile editor loads `me()`, gates Misskey-only
// rows by family, saves via `backend.updateProfile`, uploads avatar/banner
// through `backend.uploadProfileImage` (picker mocked, no expo module),
// and surfaces errors honestly.
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {meQueryKey} from '#/state/queries/keys'
import {ThemeProvider} from '#/alf/index'

import {ProfileEditorScreen} from './ProfileEditor'

const mockGoBack = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn(), goBack: mockGoBack}),
}))

const mockPickProfileImage = jest.fn()

jest.mock('#/components/Profile/pickProfileImage', () => ({
  pickProfileImage: () => mockPickProfileImage(),
}))

beforeEach(() => {
  mockPickProfileImage.mockReset()
})

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
  uploadProfileImage: jest.fn(async (_kind: string, _file: File) =>
    fakeMe({avatarUrl: 'https://m.example/new-avatar.png', headerUrl: 'https://m.example/new-banner.png'}),
  ),
  ...overrides,
})

const pickedImage = () => ({
  kind: 'picked' as const,
  file: {
    file: new File(['png'], 'me.png', {type: 'image/png'}),
    name: 'me.png',
    previewUri: 'file:///picked/me.png',
  },
})

async function setup({
  backend,
  family = 'misskey',
  queryClient,
}: {
  backend?: any
  family?: string
  queryClient?: QueryClient
} = {}) {
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
  const sessionId = sessionStore.getSnapshot().activeId
  const tree = (
    <ThemeProvider theme="light">
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        <ProfileEditorScreen />
      </SessionProvider>
    </ThemeProvider>
  )
  render(
    queryClient ? (
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
    ) : (
      tree
    ),
  )
  return {
    sessionId,
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

  it('enables avatar and banner uploads on pick (no save round-trip)', async () => {
    const backend = misskeyBackend()
    mockPickProfileImage.mockResolvedValue(pickedImage())
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar-choose')).toBeTruthy())
      // The rows are real controls, not disabled placeholders.
      expect(screen.getByTestId('profile-editor-avatar-choose')).not.toBeDisabled()
      expect(screen.getByTestId('profile-editor-banner-choose')).not.toBeDisabled()

      fireEvent.press(screen.getByTestId('profile-editor-avatar-choose'))
      await waitFor(() => expect(backend.uploadProfileImage).toHaveBeenCalled())
      const [kind, file] = backend.uploadProfileImage.mock.calls[0]
      expect(kind).toBe('avatar')
      expect(file.name).toBe('me.png')
      // Upload-on-pick: the text save is NOT what carried the image, and the
      // editor does not close itself.
      expect(backend.updateProfile).not.toHaveBeenCalled()
      expect(mockGoBack).not.toHaveBeenCalled()
      // The server's URL is what the row shows afterwards.
      await waitFor(() =>
        expect(screen.getByTestId('profile-editor-avatar-preview').props.source).toEqual({
          uri: 'https://m.example/new-avatar.png',
        }),
      )
    } finally {
      done()
    }
  })

  it('shows progress on the row while the upload is in flight', async () => {
    let resolveUpload: (account: unknown) => void = () => {}
    const backend = misskeyBackend({
      uploadProfileImage: jest.fn(
        () => new Promise(resolve => {
          resolveUpload = resolve
        }),
      ),
    })
    mockPickProfileImage.mockResolvedValue(pickedImage())
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar-choose')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-avatar-choose'))

      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar-progress')).toBeTruthy())
      expect(screen.getByTestId('profile-editor-avatar-progress')).toHaveTextContent(/Uploading/)
      // A second image cannot start while one is in flight — with a reason.
      expect(screen.getByTestId('profile-editor-banner-choose')).toBeDisabled()

      resolveUpload(fakeMe({avatarUrl: 'https://m.example/new-avatar.png'}))
      await waitFor(() => expect(screen.queryByTestId('profile-editor-avatar-progress')).toBeNull())
    } finally {
      done()
    }
  })

  it('surfaces an upload failure honestly and keeps the previous picture', async () => {
    const backend = misskeyBackend({
      uploadProfileImage: jest.fn(async () => {
        throw new Error('That file is too large.')
      }),
    })
    mockPickProfileImage.mockResolvedValue(pickedImage())
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar-choose')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-avatar-choose'))
      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar-error')).toBeTruthy())
      expect(screen.getByTestId('profile-editor-avatar-error')).toHaveTextContent(/too large/)
      // The rejected local preview was rolled back (me() has no avatar URL).
      expect(screen.getByTestId('profile-editor-avatar-preview').props.source).toBeUndefined()
    } finally {
      done()
    }
  })

  it('reports denied photo access instead of doing nothing', async () => {
    const backend = misskeyBackend()
    mockPickProfileImage.mockResolvedValue({kind: 'denied', canAskAgain: false})
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar-choose')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-avatar-choose'))
      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar-error')).toBeTruthy())
      expect(screen.getByTestId('profile-editor-avatar-error')).toHaveTextContent(/settings/i)
      expect(backend.uploadProfileImage).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('treats a cancelled pick as a no-op (no error, no upload)', async () => {
    const backend = misskeyBackend()
    mockPickProfileImage.mockResolvedValue({kind: 'cancelled'})
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-banner-choose')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-banner-choose'))
      await waitFor(() => expect(mockPickProfileImage).toHaveBeenCalled())
      expect(screen.queryByTestId('profile-editor-banner-error')).toBeNull()
      expect(backend.uploadProfileImage).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('refreshes the cached account and the viewer query after an upload', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const backend = misskeyBackend()
    mockPickProfileImage.mockResolvedValue(pickedImage())
    const {done, sessionId} = await setup({backend, queryClient: qc})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar-choose')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-avatar-choose'))
      await waitFor(() => expect(backend.uploadProfileImage).toHaveBeenCalled())
      await waitFor(() =>
        expect(
          (qc.getQueryData(meQueryKey(sessionId!)) as {avatarUrl?: string} | undefined)?.avatarUrl,
        ).toBe('https://m.example/new-avatar.png'),
      )
    } finally {
      done()
      qc.clear()
    }
  })

  it('keeps the rows visible with a reason when the backend has no image endpoint', async () => {
    const backend = misskeyBackend({uploadProfileImage: undefined})
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-avatar-choose')).toBeTruthy())
      expect(screen.getByTestId('profile-editor-avatar-choose')).toBeDisabled()
      expect(screen.getByTestId('profile-editor-banner-choose')).toBeDisabled()
      expect(
        screen.getAllByText(/no endpoint for profile pictures/).length,
      ).toBe(2)
    } finally {
      done()
    }
  })
})

describe('ProfileEditorScreen (mastodon family)', () => {
  it('uploads a banner through the same seam (multipart lives in the backend)', async () => {
    const backend = misskeyBackend()
    backend.family = 'mastodon'
    mockPickProfileImage.mockResolvedValue(pickedImage())
    const {done} = await setup({backend, family: 'mastodon'})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-banner-choose')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-banner-choose'))
      await waitFor(() => expect(backend.uploadProfileImage).toHaveBeenCalled())
      expect(backend.uploadProfileImage.mock.calls[0][0]).toBe('banner')
      await waitFor(() =>
        expect(screen.getByTestId('profile-editor-banner-preview').props.source).toEqual({
          uri: 'https://m.example/new-banner.png',
        }),
      )
    } finally {
      done()
    }
  })
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
      // Avatar/banner are NOT among the disabled rows any more (§1.8).
      expect(screen.queryByText(/not supported on the Mastodon family yet/)).toBeNull()
      expect(screen.getByTestId('profile-editor-avatar-choose')).not.toBeDisabled()

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

describe('ProfileEditorScreen (overlay)', () => {
  it('renders the form as a floating card over a backdrop', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-name')).toBeTruthy())
      expect(screen.getByTestId('profile-editor-overlay')).toBeTruthy()
      expect(screen.getByTestId('profile-editor-backdrop')).toBeTruthy()
      expect(screen.getByTestId('profile-editor-card')).toBeTruthy()
      expect(screen.getByTestId('profile-editor-close')).toBeTruthy()
      // All fields still render inside the card.
      expect(screen.getByTestId('profile-editor-bio')).toBeTruthy()
      expect(screen.getByTestId('profile-editor-save')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('dismisses via the backdrop', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-backdrop')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-backdrop'))
      expect(mockGoBack).toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('dismisses via the close control', async () => {
    const backend = misskeyBackend()
    const {done} = await setup({backend})
    try {
      await waitFor(() => expect(screen.getByTestId('profile-editor-close')).toBeTruthy())
      fireEvent.press(screen.getByTestId('profile-editor-close'))
      expect(mockGoBack).toHaveBeenCalled()
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
