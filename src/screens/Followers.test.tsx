import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {SessionProvider} from '#/state/session/SessionProvider'
import {makeAccount} from '#/components/__tests__/fixtures'

import {FollowersScreen} from './Followers'

const mockNavigate = jest.fn()
const routeHolder: {id: string} = {id: 'u1'}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate}),
  useRoute: () => ({params: {id: routeHolder.id}}),
}))

const backendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => backendHolder.current,
}))

const HOME = 'https://app.example'

let snap: {sessions: any[]; activeId: string | null} = {sessions: [], activeId: null}

function sessionFor(sessionId: string, accountId: string) {
  return {
    id: sessionId,
    origin: 'https://m.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId,
    token: 't',
    grant: 'password',
    hosting: 'third-party',
  }
}

function setup({
  backend,
  sessionId = 's1',
  accountId = 'viewer',
  routeId = 'u1',
}: {
  backend?: any
  sessionId?: string
  accountId?: string
  routeId?: string
} = {}) {
  mockNavigate.mockClear()
  routeHolder.id = routeId
  backendHolder.current = backend ?? null
  snap = backend
    ? {sessions: [sessionFor(sessionId, accountId)], activeId: sessionId}
    : {sessions: [], activeId: null}
  const store = {
    subscribe: () => () => {},
    getSnapshot: () => snap,
    initialize: () => {},
    hydrate: async () => {},
  }
  return render(
    <ThemeProvider theme="light">
      <SessionProvider store={store as never} homeOrigin={HOME}>
        <FollowersScreen />
      </SessionProvider>
    </ThemeProvider>,
  )
}

const target = (over: Record<string, unknown> = {}) =>
  makeAccount({id: 'u1', username: 'target', displayName: 'Target', ffVisibility: 'public', ...over})

function backendWith({
  targetAccount,
  pages,
  failFirst = false,
}: {
  targetAccount?: any
  pages?: any[][]
  failFirst?: boolean
}) {
  const calls: unknown[][] = []
  let failed = false
  const followers = jest.fn(async (...args: unknown[]) => {
    calls.push(args)
    if (failFirst && !failed) {
      failed = true
      throw new Error('boom')
    }
    const index = calls.length - (failFirst ? 2 : 1)
    const rows = (pages ?? [[makeAccount({id: 'f1', username: 'fred', displayName: 'Fred'})]])[index] ?? []
    const hasNext = index + 1 < (pages ?? [[]]).length
    return {
      items: rows,
      cursor: hasNext ? (`c${index + 1}` as never) : null,
      end: !hasNext,
    }
  })
  return {
    family: 'misskey',
    capabilities: {},
    account: jest.fn(async () => targetAccount ?? target()),
    followers,
  }
}

describe('FollowersScreen', () => {
  it('asks to sign in when signed out', async () => {
    setup()
    expect(await screen.findByText('Sign in to see followers.')).toBeTruthy()
    expect(screen.getByTestId('followers-screen')).toBeTruthy()
  })

  it('lists follower rows and navigates to the account', async () => {
    const f1 = makeAccount({id: 'f1', username: 'fred', displayName: 'Fred', acct: 'fred'})
    const f2 = makeAccount({id: 'f2', username: 'gina', displayName: 'Gina', acct: 'gina'})
    setup({backend: backendWith({pages: [[f1, f2]]})})
    expect(await screen.findByTestId('follower-row-f1')).toBeTruthy()
    expect(screen.getByTestId('follower-row-f2')).toBeTruthy()
    fireEvent.press(screen.getByTestId('follower-row-f1'))
    expect(mockNavigate).toHaveBeenCalledWith('User', {id: 'f1'})
  })

  it('renders the honest hidden message for private lists without fetching them', async () => {
    const backend = backendWith({
      targetAccount: target({ffVisibility: 'private'}),
    })
    setup({backend})
    expect(await screen.findByText('Following and followers are hidden.')).toBeTruthy()
    expect(backend.followers).not.toHaveBeenCalled()
    expect(screen.queryByTestId('follower-row-f1')).toBeNull()
  })

  it('gates followers-only lists on the viewer follow state', async () => {
    const locked = target({ffVisibility: 'followers'})
    const f1 = makeAccount({id: 'f1', username: 'fred', displayName: 'Fred', acct: 'fred'})
    setup({backend: backendWith({targetAccount: locked, pages: [[f1]]})})
    expect(
      await screen.findByText('Following and followers are visible to followers.'),
    ).toBeTruthy()

    setup({backend: backendWith({targetAccount: {...locked, isFollowing: true}, pages: [[f1]]})})
    expect(await screen.findByTestId('follower-row-f1')).toBeTruthy()
  })

  it('does not gate the viewer’s own private list', async () => {
    const f1 = makeAccount({id: 'f1', username: 'fred', displayName: 'Fred', acct: 'fred'})
    setup({
      backend: backendWith({targetAccount: target({id: 'viewer', ffVisibility: 'private'}), pages: [[f1]]}),
      accountId: 'viewer',
      routeId: 'viewer',
    })
    expect(await screen.findByTestId('follower-row-f1')).toBeTruthy()
  })

  it('switching sessions never shows the previous account’s rows', async () => {
    const backendA = backendWith({
      pages: [[makeAccount({id: 'fa', username: 'anna', displayName: 'Anna', acct: 'anna'})]],
    })
    const backendB = backendWith({
      pages: [[makeAccount({id: 'fb', username: 'bob', displayName: 'Bob', acct: 'bob'})]],
    })
    backendHolder.current = backendA
    snap = {sessions: [sessionFor('s1', 'viewerA')], activeId: 's1'}
    routeHolder.id = 'u1'
    const store = {subscribe: () => () => {}, getSnapshot: () => snap, initialize: () => {}, hydrate: async () => {}}
    // Fresh element per render: reusing the same object lets React bail
    // out and skip the subtree entirely.
    const ui = () => (
      <ThemeProvider theme="light">
        <SessionProvider store={store as never} homeOrigin={HOME}>
          <FollowersScreen />
        </SessionProvider>
      </ThemeProvider>
    )
    const {rerender, unmount} = render(ui())
    try {
      expect(await screen.findByTestId('follower-row-fa')).toBeTruthy()
      backendHolder.current = backendB
      snap = {sessions: [sessionFor('s2', 'viewerB')], activeId: 's2'}
      rerender(ui())
      expect(await screen.findByTestId('follower-row-fb')).toBeTruthy()
      expect(screen.queryByTestId('follower-row-fa')).toBeNull()
    } finally {
      unmount()
    }
  })

  it('switching targets reloads the list for the new id', async () => {
    const backend = {
      family: 'misskey',
      capabilities: {},
      account: jest.fn(async ({id}: {id: string}) => target({id})),
      followers: jest.fn(async (id: string) => ({
        items: [makeAccount({id: `row-${id}`, username: id, displayName: id, acct: id})],
        cursor: null,
        end: true,
      })),
    }
    backendHolder.current = backend
    snap = {sessions: [sessionFor('s1', 'viewer')], activeId: 's1'}
    routeHolder.id = 'u1'
    const store = {subscribe: () => () => {}, getSnapshot: () => snap, initialize: () => {}, hydrate: async () => {}}
    const ui = () => (
      <ThemeProvider theme="light">
        <SessionProvider store={store as never} homeOrigin={HOME}>
          <FollowersScreen />
        </SessionProvider>
      </ThemeProvider>
    )
    const {rerender, unmount} = render(ui())
    try {
      expect(await screen.findByTestId('follower-row-row-u1')).toBeTruthy()
      routeHolder.id = 'u2'
      rerender(ui())
      expect(await screen.findByTestId('follower-row-row-u2')).toBeTruthy()
      expect(screen.queryByTestId('follower-row-row-u1')).toBeNull()
    } finally {
      unmount()
    }
  })

  it('pages with Load more and retries after a load failure', async () => {
    const p1 = [makeAccount({id: 'f1', username: 'fred', displayName: 'Fred', acct: 'fred'})]
    const p2 = [makeAccount({id: 'f2', username: 'gina', displayName: 'Gina', acct: 'gina'})]
    const backend = backendWith({pages: [p1, p2]})
    setup({backend})
    expect(await screen.findByTestId('follower-row-f1')).toBeTruthy()
    expect(backend.followers).toHaveBeenCalledWith('u1', {limit: 20, cursor: null})
    fireEvent.press(screen.getByTestId('followers-more'))
    await waitFor(() =>
      expect(backend.followers).toHaveBeenCalledWith('u1', {limit: 20, cursor: 'c1' as never}),
    )
    expect(await screen.findByTestId('follower-row-f2')).toBeTruthy()
    expect(screen.getByTestId('follower-row-f1')).toBeTruthy()
  })

  it('retries the initial load after a failure', async () => {
    const f1 = makeAccount({id: 'f1', username: 'fred', displayName: 'Fred', acct: 'fred'})
    setup({backend: backendWith({pages: [[f1]], failFirst: true})})
    expect(await screen.findByText('Could not load followers.')).toBeTruthy()
    fireEvent.press(screen.getByTestId('followers-retry'))
    expect(await screen.findByTestId('follower-row-f1')).toBeTruthy()
  })

  it('renders the honest empty state', async () => {
    setup({backend: backendWith({pages: [[]]})})
    expect(await screen.findByText('No followers yet.')).toBeTruthy()
  })
})
