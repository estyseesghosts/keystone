// AdminInsight screen: signed-out prompt, staff gate, ready render, the
// 403 disabled-with-reason path (never a session clear), and the
// unsupported-module state. Data runs through the session-scoped insight
// queries, so the capability + role gates are genuinely exercised.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {ApiError, createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {AdminInsightScreen} from './AdminInsight'
import {insightKeyLabel, measureDisplayValue, visiblePeers} from './AdminInsight'
import {formatBytes, queueCountDisplay} from './AdminInsight'

const mockNavigate = jest.fn()

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate}),
  useRoute: () => ({params: {}}),
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

function testClient() {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

function staffAccount(role: string): any {
  return {
    id: '1',
    username: 'admin',
    acct: 'admin',
    displayName: 'admin',
    ext: {mastodon: {role}},
  }
}

function mockBackend(over: Record<string, any> = {}): any {
  const {adminInsight: adminOver, ...rest} = over
  return {
    family: 'mastodon',
    capabilities: {admin_read: 'unknown', admin_write: 'unknown'},
    adminInsight: {
      measures: async () => [
        {key: 'active_users', unit: null, total: '120', humanValue: '120', previousTotal: '100', data: []},
      ],
      dimensions: async () => [{key: 'sources', rows: [{key: 'web', label: 'Website', value: '42'}]}],
      peers: async () => ['a.example', 'b.example'],
      extendedDescription: async () => ({updatedAt: null, html: '<p>Hello</p>'}),
      activity: async () => [{week: '1729468800', statuses: '12', logins: '3', registrations: '1'}],
      ...(adminOver ?? {}),
    },
    me: async () => staffAccount('admin'),
    instanceRules: async () => [{id: '1', text: 'No spam'}],
    ...rest,
  }
}

async function setup({backend, userRole}: {backend?: any; userRole?: string | null} = {}) {
  mockNavigate.mockClear()
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
      ...(userRole ? {user: staffAccount(userRole)} : {}),
    })
  }
  const client = testClient()
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme="light">
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          <AdminInsightScreen />
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return {
    client,
    cleanup: () => {
      client.clear()
      __setStorageForTests({storage: restore})
    },
  }
}

describe('AdminInsight pure helpers', () => {
  it('labels known keys and passes unknown keys through', () => {
    expect(insightKeyLabel('measure', 'active_users')).toBe('Active users')
    expect(insightKeyLabel('dimension', 'sources')).toBe('Posting apps')
    expect(insightKeyLabel('measure', 'future_key')).toBe('future_key')
  })

  it('prefers the human value, else the raw total', () => {
    expect(
      measureDisplayValue({key: 'k', unit: null, total: '120', humanValue: '120', previousTotal: null, data: []}),
    ).toBe('120')
    expect(
      measureDisplayValue({key: 'k', unit: null, total: '7', humanValue: null, previousTotal: null, data: []}),
    ).toBe('7')
  })

  it('truncates the peer list with an honest remainder', () => {
    const peers = Array.from({length: 25}, (_, i) => `p${i}.example`)
    const {shown, remaining} = visiblePeers(peers, 20)
    expect(shown).toHaveLength(20)
    expect(remaining).toBe(5)
    expect(visiblePeers(['a.example']).remaining).toBe(0)
  })
})

describe('AdminInsightScreen', () => {
  it('signed out: prompts sign-in, shows no sample data', async () => {
    const {cleanup} = await setup()
    try {
      expect(screen.getByTestId('admin-insight-screen')).toBeTruthy()
      expect(screen.getByText('Sign in to read server insight.')).toBeTruthy()
      expect(screen.queryByTestId('admin-insight-measures')).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('non-staff: explains the role requirement and fetches nothing', async () => {
    const measures = jest.fn(async () => [])
    const {cleanup} = await setup({
      backend: mockBackend({me: async () => staffAccount('user')}),
      userRole: 'user',
    })
    try {
      mockBackendHolder.current.adminInsight.measures = measures
      await waitFor(() => {
        expect(screen.getByText('Requires an admin or moderator account.')).toBeTruthy()
      })
      expect(measures).not.toHaveBeenCalled()
      expect(screen.queryByTestId('admin-insight-measures')).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('staff: renders metrics, public info, and rules', async () => {
    const {cleanup} = await setup({backend: mockBackend(), userRole: 'admin'})
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-measure-active_users')).toBeTruthy()
      })
      expect(screen.getByText('Active users')).toBeTruthy()
      expect(screen.getByText('Website: 42')).toBeTruthy()
      expect(screen.getByText('a.example')).toBeTruthy()
      expect(screen.getByText('No spam')).toBeTruthy()
    } finally {
      cleanup()
    }
  })

  it('measures 403: disables the section with a reason, keeps the fallback sections', async () => {
    const denied = new ApiError('Insufficient scope.', 403, 'errors.network.apiError')
    const {cleanup} = await setup({
      backend: mockBackend({
        adminInsight: {
          measures: async () => {
            throw denied
          },
        },
      }),
      userRole: 'admin',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-measures-denied')).toBeTruthy()
      })
      expect(
        screen.getByText(
          'Your account may not read admin metrics on this server (missing scope or staff role).',
        ),
      ).toBeTruthy()
      // The public fallback still renders — one section's 403 never blanks the others.
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-peers')).toBeTruthy()
      })
    } finally {
      cleanup()
    }
  })

  it('no insight module (Misskey family): honest unavailable state', async () => {
    const {cleanup} = await setup({
      backend: {family: 'misskey', capabilities: {}, me: async () => staffAccount('admin')},
      userRole: 'admin',
    })
    try {
      await waitFor(() => {
        expect(screen.getByText('Server insight is not available on this server.')).toBeTruthy()
      })
    } finally {
      cleanup()
    }
  })

  it('retry re-fetches a failed section', async () => {
    let calls = 0
    const {cleanup} = await setup({
      backend: mockBackend({
        adminInsight: {
          peers: async () => {
            calls += 1
            if (calls === 1) throw new Error('boom')
            return ['a.example']
          },
        },
      }),
      userRole: 'admin',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-peers-retry')).toBeTruthy()
      })
      fireEvent.press(screen.getByTestId('admin-insight-peers-retry'))
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-peers')).toBeTruthy()
      })
      expect(calls).toBeGreaterThanOrEqual(2)
    } finally {
      cleanup()
    }
  })
})

describe('AdminInsight pure helpers (Misskey)', () => {
  it('formats byte counts 1024-based, never a fabricated zero', () => {
    expect(formatBytes(0)).toBe('0.0 B')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(17179869184)).toBe('16.0 GiB')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })

  it('renders missing queue counters as an honest dash', () => {
    expect(queueCountDisplay(3)).toBe('3')
    expect(queueCountDisplay(0)).toBe('0')
    expect(queueCountDisplay(null)).toBe('—')
  })
})

describe('AdminInsightScreen (Misskey family)', () => {
  function misskeyAccount(flags: {isAdmin?: boolean; isModerator?: boolean}): any {
    return {
      id: '1',
      username: 'admin',
      acct: 'admin',
      displayName: 'admin',
      ext: {me: {isAdmin: !!flags.isAdmin, isModerator: !!flags.isModerator}},
    }
  }

  function misskeyBackend(over: Record<string, any> = {}): any {
    const {adminInsight: adminOver, ...rest} = over
    return {
      family: 'misskey',
      capabilities: {admin_read: 'unknown', admin_write: 'unknown'},
      adminInsight: {
        serverInfo: async () => ({
          machine: 'host1',
          os: 'linux',
          node: 'v22.1.0',
          psql: '15.4',
          cpu: {model: 'Xeon', cores: 8},
          memTotal: 17179869184,
          fsTotal: 536870912000,
          fsUsed: 107374182400,
        }),
        instanceMeta: async () => ({
          name: 'Example',
          shortName: 'ex',
          description: 'An instance',
          maintainerName: 'Admin',
          maintainerEmail: 'admin@example.com',
          version: '2025.1.0',
          uri: 'example.com',
          disableRegistration: false,
          emailRequiredForSignup: true,
        }),
        queueStats: async () => ({
          deliver: {waiting: 3, active: 1, delayed: 0, completed: 100, failed: 2, paused: 0},
          inbox: {waiting: 0, active: 0, delayed: 0, completed: 50, failed: 0, paused: 0},
          db: {waiting: 0, active: 0, delayed: 0, completed: 10, failed: 0, paused: 0},
          objectStorage: {waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0, paused: 0},
        }),
        onlineUsersCount: async () => 42,
        ...(adminOver ?? {}),
      },
      me: async () => misskeyAccount({isAdmin: true}),
      instanceRules: async () => [{id: '1', text: 'No spam'}],
      ...rest,
    }
  }

  async function misskeySetup({
    backend,
    flags,
  }: {
    backend?: any
    flags?: {isAdmin?: boolean; isModerator?: boolean}
  } = {}) {
    mockNavigate.mockClear()
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
        grant: 'miauth',
        hosting: 'third-party',
        ...(flags ? {user: misskeyAccount(flags)} : {}),
      })
    }
    const client = testClient()
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme="light">
          <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
            <AdminInsightScreen />
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    )
    return {
      client,
      cleanup: () => {
        client.clear()
        __setStorageForTests({storage: restore})
      },
    }
  }

  it('non-staff: explains the role requirement and fetches nothing', async () => {
    const serverInfo = jest.fn(async () => ({}))
    const {cleanup} = await misskeySetup({
      backend: misskeyBackend({
        me: async () => misskeyAccount({}),
        adminInsight: {serverInfo},
      }),
      flags: {},
    })
    try {
      mockBackendHolder.current.adminInsight.serverInfo = serverInfo
      await waitFor(() => {
        expect(screen.getByText('Requires an admin or moderator account.')).toBeTruthy()
      })
      expect(serverInfo).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('staff: renders hardware, instance, queues, and the online count', async () => {
    const {cleanup} = await misskeySetup({
      backend: misskeyBackend(),
      flags: {isAdmin: true},
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-server-info')).toBeTruthy()
      })
      expect(screen.getByText('Machine host1')).toBeTruthy()
      expect(screen.getByText('Example')).toBeTruthy()
      expect(screen.getByText('deliver')).toBeTruthy()
      expect(screen.getByText('42 users online now')).toBeTruthy()
      expect(screen.getByText('No spam')).toBeTruthy()
      // The Mastodon sections never render on this family.
      expect(screen.queryByTestId('admin-insight-measures')).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('moderator without the admin role: settings deny with a reason, hardware still renders', async () => {
    const denied = new ApiError('You are not assigned to an administrator role.', 403, 'ROLE_PERMISSION_DENIED')
    const {cleanup} = await misskeySetup({
      backend: misskeyBackend({
        me: async () => misskeyAccount({isModerator: true}),
        adminInsight: {
          instanceMeta: async () => {
            throw denied
          },
        },
      }),
      flags: {isModerator: true},
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-instance-meta-denied')).toBeTruthy()
      })
      expect(
        screen.getByText('Instance settings need an admin account on this server.'),
      ).toBeTruthy()
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-server-info')).toBeTruthy()
      })
    } finally {
      cleanup()
    }
  })

  it('queue 403: disables the queue section with a reason, keeps the rest', async () => {
    const denied = new ApiError('Insufficient scope.', 403, 'errors.network.apiError')
    const {cleanup} = await misskeySetup({
      backend: misskeyBackend({
        adminInsight: {
          queueStats: async () => {
            throw denied
          },
        },
      }),
      flags: {isAdmin: true},
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-queue-stats-denied')).toBeTruthy()
      })
      await waitFor(() => {
        expect(screen.getByTestId('admin-insight-server-info')).toBeTruthy()
      })
    } finally {
      cleanup()
    }
  })
})
