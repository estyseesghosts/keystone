// NotificationRow tests (W4/N20/C12, F11-half): pressable actor/post
// navigation, grouped "and N others" with first-actor navigation,
// DisplayName emoji names, relative time, and honest id-only fallback.

import {fireEvent, render, screen} from '@testing-library/react-native'

import type {Account, Notification, Post} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {navigationRef} from '#/navigationRef'

import {NotificationRow} from './NotificationRow'

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme="light">{ui}</ThemeProvider>)
}

function account(over: Partial<Account> = {}): Account {
  return {
    id: 'u1',
    username: 'bob',
    acct: 'bob',
    host: null,
    name: 'Bob',
    displayName: 'Bob',
    bio: {plain: ''},
    url: null,
    uri: null,
    avatarUrl: null,
    avatarBlurhash: null,
    headerUrl: null,
    headerBlurhash: null,
    followersCount: 0,
    followingCount: 0,
    statusesCount: 0,
    locked: false,
    bot: false,
    cat: false,
    silenced: false,
    suspended: false,
    onlineStatus: null,
    location: null,
    birthday: null,
    createdAt: null,
    updatedAt: null,
    lastFetchedAt: null,
    emojis: {},
    fields: [],
    movedTo: null,
    ffVisibility: null,
    pinnedPostIds: null,
    pinnedPosts: null,
    ext: {},
    ...over,
  } as Account
}

function post(over: Partial<Post> = {}): Post {
  return {
    id: 'p1',
    content: {plain: 'hello excerpt world'},
  } as unknown as Post
}

function notification(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    kind: 'reaction',
    rawType: 'reaction',
    createdAt: new Date().toISOString(),
    read: false,
    actors: [{id: 'u1', account: account(), reaction: null}],
    post: post(),
    reaction: null,
    ext: {},
    ...over,
  } as Notification
}

describe('NotificationRow navigation (N20)', () => {
  let navigateSpy: jest.SpyInstance
  beforeEach(() => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('tapping the actor area opens the actor profile', () => {
    renderWithTheme(<NotificationRow notification={notification()} />)
    fireEvent.press(screen.getByTestId('notification-actor-n1'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {screen: 'User', params: {id: 'u1'}})
  })

  it('tapping the actor name opens the actor profile', () => {
    renderWithTheme(<NotificationRow notification={notification()} />)
    fireEvent.press(screen.getByTestId('notification-actor-name-n1'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {screen: 'User', params: {id: 'u1'}})
  })

  it('tapping the post excerpt opens the post detail', () => {
    renderWithTheme(<NotificationRow notification={notification()} />)
    fireEvent.press(screen.getByTestId('notification-post-n1'))
    expect(navigateSpy).toHaveBeenCalledWith('Note', {id: 'p1'})
  })

  it('does nothing without a mounted navigator', () => {
    jest.restoreAllMocks()
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(false)
    const quiet = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
    renderWithTheme(<NotificationRow notification={notification()} />)
    fireEvent.press(screen.getByTestId('notification-actor-n1'))
    fireEvent.press(screen.getByTestId('notification-post-n1'))
    expect(quiet).not.toHaveBeenCalled()
  })
})

describe('NotificationRow grouped rows (C12)', () => {
  let navigateSpy: jest.SpyInstance
  beforeEach(() => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shows "and N others" and navigates to the FIRST actor', () => {
    const grouped = notification({
      id: 'g1',
      kind: 'reaction',
      actors: [
        {id: 'u1', account: account({id: 'u1', username: 'bob', displayName: 'Bob'}), reaction: null},
        {id: 'u2', account: account({id: 'u2', username: 'ann', displayName: 'Ann'}), reaction: null},
        {id: 'ghost-abcdef123456', account: null, reaction: null},
      ],
    })
    renderWithTheme(<NotificationRow notification={grouped} />)
    expect(screen.getByTestId('notification-others-g1')).toBeTruthy()
    expect(screen.getByText('and 2 others')).toBeTruthy()
    fireEvent.press(screen.getByTestId('notification-actor-g1'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {screen: 'User', params: {id: 'u1'}})
  })

  it('renders id-only actors without inventing a profile', () => {
    const ghost = notification({
      actors: [{id: 'ghost-id-123456', account: null, reaction: null}],
      post: null,
    })
    renderWithTheme(<NotificationRow notification={ghost} />)
    expect(screen.getByText('…123456')).toBeTruthy()
    fireEvent.press(screen.getByTestId('notification-actor-n1'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {
      screen: 'User',
      params: {id: 'ghost-id-123456'},
    })
  })
})

describe('NotificationRow content (F11-half, relative time)', () => {
  beforeEach(() => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders custom-emoji display names via DisplayName, never raw codes', () => {
    const emoji = notification({
      actors: [
        {
          id: 'u9',
          account: account({
            id: 'u9',
            username: 'ann',
            displayName: 'Ann :blobcat:',
            emojis: {':blobcat:': 'https://example.com/blobcat.png'},
          }),
          reaction: null,
        },
      ],
    })
    renderWithTheme(<NotificationRow notification={emoji} />)
    expect(screen.getByLabelText(':blobcat:')).toBeTruthy()
    expect(screen.queryByText(/:blobcat:/)).toBeNull()
  })

  it('shows relative time instead of raw ISO', () => {
    renderWithTheme(<NotificationRow notification={notification()} />)
    const time = screen.getByTestId('notification-time-n1')
    expect((time.props as {children: unknown}).children).toBe('now')
  })

  it('marks unread and read states honestly', () => {
    const {unmount} = renderWithTheme(<NotificationRow notification={notification({read: false})} />)
    expect(screen.getByText('New')).toBeTruthy()
    expect(screen.queryByText('Read')).toBeNull()
    unmount()
    renderWithTheme(<NotificationRow notification={notification({read: true})} />)
    expect(screen.getByText('Read')).toBeTruthy()
    expect(screen.queryByText('New')).toBeNull()
  })

  it('falls back to the raw type for unknown kinds', () => {
    renderWithTheme(
      <NotificationRow notification={notification({kind: 'unknown', rawType: 'customType'})} />,
    )
    expect(screen.getByText('customType')).toBeTruthy()
  })

  it('collapses name==handle to a single handle line (v1)', () => {
    const collapsed = notification({
      actors: [
        {
          id: 'u2',
          account: account({id: 'u2', username: 'ann', host: null, name: 'ann', displayName: 'ann'}),
          reaction: null,
        },
      ],
    })
    renderWithTheme(<NotificationRow notification={collapsed} />)
    expect(screen.getByTestId('notification-actor-displayname-n1')).toHaveTextContent('@ann')
    expect(screen.queryByText('ann')).toBeNull()
  })

  it('keeps two lines for a real display name', () => {
    renderWithTheme(<NotificationRow notification={notification()} />)
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText('@bob')).toBeTruthy()
  })
})
