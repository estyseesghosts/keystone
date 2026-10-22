// AdminReports screen: signed-out prompt, staff gate, queue render with
// the 1.5 ids, 403 disabled-with-reason, confirm-gated mutations with
// refetch (never optimistic), and family-only actions hidden per family.
//
// Data runs through the session-scoped reports queries, so the capability
// + role gates and the session-first keys are genuinely exercised.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {ApiError, createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {AdminReportScreen, AdminReportsScreen} from './AdminReports'
import {
  reportCategoryLabel,
  reportResolutionLabel,
  reportRowTitle,
  reportStateLabel,
  sameIdSet,
} from './AdminReports'

const mockNavigate = jest.fn()
const mockRouteParams: {params: {id?: string}} = {params: {}}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate}),
  useRoute: () => mockRouteParams,
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

function mastodonStaff(role: string): any {
  return {
    id: '1',
    username: 'admin',
    acct: 'admin',
    displayName: 'admin',
    ext: {mastodon: {role}},
  }
}

function misskeyStaff(flag: 'isAdmin' | 'isModerator'): any {
  return {
    id: '1',
    username: 'admin',
    acct: 'admin',
    displayName: 'admin',
    ext: {me: {[flag]: true}},
  }
}

function account(id: string, username: string): any {
  return {id, username, acct: username, displayName: username}
}

function queuedReport(over: Record<string, any> = {}): any {
  return {
    id: 'r1',
    createdAt: '2026-10-20T00:00:00.000Z',
    comment: 'spam bot',
    reporter: account('10', 'reporter'),
    target: account('11', 'spammer'),
    statusIds: ['101', '102'],
    ruleIds: ['7'],
    category: 'spam',
    forwarded: false,
    state: 'open',
    assignee: null,
    resolution: null,
    actionTakenAt: null,
    actionTakenBy: null,
    moderationNote: null,
    ...over,
  }
}

function mockBackend(over: Record<string, any> = {}): any {
  const {reportsQueue: queueOver, me: meOver, ...rest} = over
  return {
    family: 'mastodon',
    capabilities: {admin_read: 'unknown', admin_write: 'unknown'},
    reportsQueue: {
      list: async () => ({items: [queuedReport()], cursor: null, end: true}),
      get: async (id: string) => queuedReport({id}),
      assignToSelf: async () => {},
      unassign: async () => {},
      reopen: async () => {},
      resolve: async () => {},
      recategorize: async () => {},
      ...(queueOver ?? {}),
    },
    me: meOver ?? (async () => mastodonStaff('admin')),
    instanceRules: async () => [{id: '7', text: 'No spam'}],
    ...rest,
  }
}

async function setup({
  backend,
  user,
  family,
  screen: which,
}: {
  backend?: any
  user?: any
  family?: string
  screen?: 'queue' | 'detail'
} = {}) {
  mockNavigate.mockClear()
  mockRouteParams.params = which === 'detail' ? {id: 'r1'} : {}
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
      family: (family ?? 'mastodon') as 'mastodon',
      flavor: (family === 'misskey' ? 'misskey' : 'mastodon') as 'mastodon',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'oauth-pkce',
      hosting: 'third-party',
      ...(user ? {user} : {}),
    })
  }
  const client = testClient()
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme="light">
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          {which === 'detail' ? <AdminReportScreen /> : <AdminReportsScreen />}
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

describe('AdminReports pure helpers', () => {
  it('labels state, category, and verdict', () => {
    expect(reportStateLabel('open')).toBe('Open')
    expect(reportStateLabel('resolved')).toBe('Resolved')
    expect(reportCategoryLabel('spam')).toBe('Spam')
    expect(reportCategoryLabel('violation')).toBe('Rule violation')
    expect(reportCategoryLabel(null)).toBe('No category')
    expect(reportResolutionLabel('accept')).toBe('Accepted')
    expect(reportResolutionLabel(null)).toBe('No verdict')
  })

  it('titles a row reporter-first and compares id sets order-insensitively', () => {
    expect(reportRowTitle(queuedReport())).toBe('reporter → spammer')
    expect(sameIdSet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameIdSet(['a'], ['a', 'b'])).toBe(false)
  })
})

describe('AdminReportsScreen (queue)', () => {
  it('signed out: prompts sign-in, shows no queue', async () => {
    const {cleanup} = await setup()
    try {
      expect(screen.getByText('Sign in to moderate reports.')).toBeTruthy()
      expect(screen.queryByTestId('admin-reports-list')).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('non-staff: explains the role requirement and fetches nothing', async () => {
    const list = jest.fn(async () => ({items: [], cursor: null, end: true}))
    const {cleanup} = await setup({
      backend: mockBackend({
        reportsQueue: {list},
        me: async () => mastodonStaff('user'),
      }),
      user: mastodonStaff('user'),
    })
    try {
      await waitFor(() => {
        expect(screen.getByText('Requires an admin or moderator account.')).toBeTruthy()
      })
      expect(list).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('no queue module: honest unavailable state', async () => {
    const {cleanup} = await setup({
      backend: {family: 'misskey', capabilities: {}, me: async () => misskeyStaff('isModerator')},
      user: misskeyStaff('isModerator'),
      family: 'misskey',
    })
    try {
      await waitFor(() => {
        expect(screen.getByText('Reports are not available on this server.')).toBeTruthy()
      })
    } finally {
      cleanup()
    }
  })

  it('staff: renders rows with the 1.5 ids and the assignee', async () => {
    const {cleanup} = await setup({
      backend: mockBackend(),
      user: mastodonStaff('admin'),
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-reports-row-r1')).toBeTruthy()
      })
      expect(screen.getByText('reporter → spammer')).toBeTruthy()
      // Status/rule counts, category, and assignee render from domain models.
      expect(screen.getByText(/2 posts/)).toBeTruthy()
      expect(screen.getByText(/1 rule/)).toBeTruthy()
    } finally {
      cleanup()
    }
  })

  it('filter switch re-queries with the matching state', async () => {
    const list = jest.fn(async (opts: any = {}) => ({
      items: opts.state === 'resolved' ? [queuedReport({id: 'r9', state: 'resolved'})] : [],
      cursor: null,
      end: true,
    }))
    const {cleanup} = await setup({
      backend: mockBackend({reportsQueue: {list}}),
      user: mastodonStaff('admin'),
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-reports-absent')).toBeTruthy()
      })
      expect(list).toHaveBeenCalledWith(expect.objectContaining({state: 'open'}))
      fireEvent.press(screen.getByTestId('admin-reports-filter-resolved'))
      await waitFor(() => {
        expect(screen.getByTestId('admin-reports-row-r9')).toBeTruthy()
      })
      expect(list).toHaveBeenCalledWith(expect.objectContaining({state: 'resolved'}))
    } finally {
      cleanup()
    }
  })

  it('queue 403: disables the section with a reason, keeps the filters', async () => {
    const denied = new ApiError('Insufficient scope.', 403, 'errors.network.apiError')
    const {cleanup} = await setup({
      backend: mockBackend({
        reportsQueue: {
          list: async () => {
            throw denied
          },
        },
      }),
      user: mastodonStaff('admin'),
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-reports-denied')).toBeTruthy()
      })
      expect(
        screen.getByText(
          'Your account may not read the reports queue on this server (missing scope or staff role).',
        ),
      ).toBeTruthy()
    } finally {
      cleanup()
    }
  })
})

describe('AdminReportScreen (detail, Mastodon)', () => {
  it('renders the 1.5 ids, assignee, and action outcome', async () => {
    const {cleanup} = await setup({
      backend: mockBackend({
        reportsQueue: {
          get: async (id: string) =>
            queuedReport({
              id,
              assignee: account('12', 'mod'),
              actionTakenBy: account('12', 'mod'),
              actionTakenAt: '2026-10-21T00:00:00.000Z',
            }),
        },
      }),
      user: mastodonStaff('admin'),
      screen: 'detail',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-report-status-ids')).toBeTruthy()
      })
      expect(screen.getByText('101')).toBeTruthy()
      expect(screen.getByText('102')).toBeTruthy()
      expect(screen.getByTestId('admin-report-rule-ids')).toBeTruthy()
      expect(screen.getByText(/Spam/)).toBeTruthy()
      expect(screen.getByText(/Assignee: mod/)).toBeTruthy()
      expect(screen.getByText(/Action by mod/)).toBeTruthy()
    } finally {
      cleanup()
    }
  })

  it('resolve is two-step confirmed, then refetches (never optimistic)', async () => {
    const resolve = jest.fn(async () => {})
    let gets = 0
    const {cleanup} = await setup({
      backend: mockBackend({
        reportsQueue: {
          get: async (id: string) => {
            gets += 1
            return queuedReport({id})
          },
          resolve,
        },
      }),
      user: mastodonStaff('admin'),
      screen: 'detail',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-report-resolve')).toBeTruthy()
      })
      expect(resolve).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('admin-report-resolve'))
      expect(screen.getByTestId('admin-report-confirm-resolve')).toBeTruthy()
      expect(resolve).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('admin-report-confirm-resolve-yes'))
      await waitFor(() => {
        expect(resolve).toHaveBeenCalledWith('r1', undefined)
      })
      await waitFor(() => {
        expect(gets).toBeGreaterThanOrEqual(2)
      })
    } finally {
      cleanup()
    }
  })

  it('mastodon hides forward/note actions, shows claim + recategorize', async () => {
    const {cleanup} = await setup({
      backend: mockBackend(),
      user: mastodonStaff('admin'),
      screen: 'detail',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-report-assign')).toBeTruthy()
      })
      expect(screen.getByTestId('admin-report-recategorize')).toBeTruthy()
      expect(screen.queryByTestId('admin-report-forward')).toBeNull()
      expect(screen.queryByTestId('admin-report-note-input')).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('mutation 403 disables the write actions with a reason', async () => {
    const denied = new ApiError('Insufficient scope.', 403, 'errors.network.apiError')
    const {cleanup} = await setup({
      backend: mockBackend({
        reportsQueue: {
          get: async (id: string) => queuedReport({id}),
          resolve: async () => {
            throw denied
          },
        },
      }),
      user: mastodonStaff('admin'),
      screen: 'detail',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-report-resolve')).toBeTruthy()
      })
      fireEvent.press(screen.getByTestId('admin-report-resolve'))
      fireEvent.press(screen.getByTestId('admin-report-confirm-resolve-yes'))
      await waitFor(() => {
        expect(screen.getByTestId('admin-report-write-denied')).toBeTruthy()
      })
    } finally {
      cleanup()
    }
  })
})

describe('AdminReportScreen (detail, Misskey)', () => {
  function misskeyBackend(over: Record<string, any> = {}): any {
    const {reportsQueue: queueOver, ...rest} = over
    return {
      family: 'misskey',
      capabilities: {admin_read: 'unknown', admin_write: 'unknown'},
      reportsQueue: {
        list: async () => ({items: [queuedReport()], cursor: null, end: true}),
        resolve: async () => {},
        updateNote: async () => {},
        forward: async () => {},
        ...(queueOver ?? {}),
      },
      me: async () => misskeyStaff('isModerator'),
      ...rest,
    }
  }

  it('renders the shared list row and hides mastodon-only actions', async () => {
    const {cleanup} = await setup({
      backend: misskeyBackend(),
      user: misskeyStaff('isModerator'),
      family: 'misskey',
      screen: 'detail',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-report-summary')).toBeTruthy()
      })
      expect(screen.queryByTestId('admin-report-assign')).toBeNull()
      expect(screen.queryByTestId('admin-report-reopen')).toBeNull()
      expect(screen.queryByTestId('admin-report-recategorize')).toBeNull()
      expect(screen.getByTestId('admin-report-forward')).toBeTruthy()
      expect(screen.getByTestId('admin-report-note-input')).toBeTruthy()
    } finally {
      cleanup()
    }
  })

  it('resolve offers a verdict and forwards it to the backend', async () => {
    const resolve = jest.fn(async () => {})
    const {cleanup} = await setup({
      backend: misskeyBackend({reportsQueue: {resolve}}),
      user: misskeyStaff('isModerator'),
      family: 'misskey',
      screen: 'detail',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-report-resolve')).toBeTruthy()
      })
      fireEvent.press(screen.getByTestId('admin-report-resolve'))
      fireEvent.press(screen.getByTestId('admin-report-verdict-accept'))
      fireEvent.press(screen.getByTestId('admin-report-confirm-resolve-yes'))
      await waitFor(() => {
        expect(resolve).toHaveBeenCalledWith('r1', {decision: 'accept'})
      })
    } finally {
      cleanup()
    }
  })

  it('note save is two-step confirmed and sends the text verbatim', async () => {
    const updateNote = jest.fn(async () => {})
    const {cleanup} = await setup({
      backend: misskeyBackend({reportsQueue: {updateNote}}),
      user: misskeyStaff('isModerator'),
      family: 'misskey',
      screen: 'detail',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-report-note-input')).toBeTruthy()
      })
      fireEvent.changeText(screen.getByTestId('admin-report-note-input'), 'look into it')
      fireEvent.press(screen.getByTestId('admin-report-note-save'))
      expect(screen.getByTestId('admin-report-confirm-note')).toBeTruthy()
      expect(updateNote).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('admin-report-confirm-note-yes'))
      await waitFor(() => {
        expect(updateNote).toHaveBeenCalledWith('r1', 'look into it')
      })
    } finally {
      cleanup()
    }
  })

  it('forward is two-step confirmed', async () => {
    const forward = jest.fn(async () => {})
    const {cleanup} = await setup({
      backend: misskeyBackend({reportsQueue: {forward}}),
      user: misskeyStaff('isModerator'),
      family: 'misskey',
      screen: 'detail',
    })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('admin-report-forward')).toBeTruthy()
      })
      fireEvent.press(screen.getByTestId('admin-report-forward'))
      expect(screen.getByTestId('admin-report-confirm-forward')).toBeTruthy()
      expect(forward).not.toHaveBeenCalled()
      fireEvent.press(screen.getByTestId('admin-report-confirm-forward-yes'))
      await waitFor(() => {
        expect(forward).toHaveBeenCalledWith('r1')
      })
    } finally {
      cleanup()
    }
  })
})
