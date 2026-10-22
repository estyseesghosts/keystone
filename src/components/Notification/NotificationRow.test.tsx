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
    author: account(),
    emojis: {},
    ext: {},
    ...over,
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

describe('NotificationRow excerpt links (PF-E2/E3)', () => {
  let navigateSpy: jest.SpyInstance
  beforeEach(() => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  function mentionPost(): Post {
    return post({
      content: {mfm: 'hi @bob@ex.ample, see #cats', plain: 'hi @bob@ex.ample, see #cats'},
      author: account(),
      emojis: {},
      ext: {},
    })
  }

  it('E2: tapping an excerpt mention opens the profile, not the post', () => {
    renderWithTheme(<NotificationRow notification={notification({post: mentionPost()})} />)
    fireEvent.press(screen.getByText('@bob@ex.ample'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {
      screen: 'User',
      params: {acct: 'bob@ex.ample'},
    })
    expect(navigateSpy).not.toHaveBeenCalledWith('Note', expect.anything())
  })

  it('E3: tapping an excerpt hashtag opens the Tag screen, not the post', () => {
    renderWithTheme(<NotificationRow notification={notification({post: mentionPost()})} />)
    fireEvent.press(screen.getByText('#cats'))
    expect(navigateSpy).toHaveBeenCalledWith('Tag', {tag: 'cats'})
    expect(navigateSpy).not.toHaveBeenCalledWith('Note', expect.anything())
  })

  it('tapping the excerpt body still opens the post', () => {
    renderWithTheme(<NotificationRow notification={notification({post: mentionPost()})} />)
    fireEvent.press(screen.getByTestId('notification-post-n1'))
    expect(navigateSpy).toHaveBeenCalledWith('Note', {id: 'p1'})
  })
})

// clickstone §1.11 — the Misskey types that used to read "unknown" now get
// a real label, and the one type without a surface (chat) says what it is.
describe('NotificationRow kind labels (clickstone §1.11)', () => {
  function labelless(over: Partial<Notification>): Notification {
    // System rows pack no actor at all (Misskey sends no `user`).
    return notification({actors: [], post: null, reaction: null, ...over})
  }

  it('labels the newly mapped system kinds', () => {
    const cases: Array<[string, string, string]> = [
      ['note', 'note', 'posted a new note'],
      ['scheduledNotePosted', 'scheduledNotePosted', 'posted your scheduled note'],
      ['scheduledNotePostFailed', 'scheduledNotePostFailed', 'could not post your scheduled note'],
      ['exportCompleted', 'exportCompleted', 'completed your export'],
      ['roleAssigned', 'roleAssigned', 'gave you a role'],
      ['login', 'login', 'signed in to your account'],
      ['createToken', 'createToken', 'created an access token'],
      ['test', 'test', 'sent a test notification'],
      ['achievementEarned', 'achievement', 'earned an achievement'],
    ]
    for (const [rawType, kind, label] of cases) {
      const view = renderWithTheme(
        <NotificationRow notification={labelless({kind: kind as Notification['kind'], rawType})} />,
      )
      expect(screen.getByText(label)).toBeTruthy()
      // Never the old generic fallback (a bare raw type) for these kinds.
      expect(screen.queryByText(rawType)).toBeNull()
      view.unmount()
    }
  })

  it('labels the chat invitation with its own kind and deep-links to the room (2.2)', () => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    const navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
    try {
      renderWithTheme(
        <NotificationRow
          notification={labelless({
            kind: 'chatRoomInvitation',
            rawType: 'chatRoomInvitationReceived',
            ext: {invitedRoomId: 'room1', invitedRoomName: 'Lounge'},
          })}
        />,
      )
      expect(screen.getByText('invited you to a chat room')).toBeTruthy()
      expect(screen.queryByText('chatRoomInvitationReceived')).toBeNull()
      fireEvent.press(screen.getByTestId('notification-room-n1'))
      expect(navigateSpy).toHaveBeenCalledWith('ChatRoom', {roomId: 'room1'})
    } finally {
      jest.restoreAllMocks()
    }
  })

  it('labels the invitation without a room link when the wire packed none', () => {
    renderWithTheme(
      <NotificationRow
        notification={labelless({kind: 'chatRoomInvitation', rawType: 'chatRoomInvitationReceived'})}
      />,
    )
    expect(screen.getByText('invited you to a chat room')).toBeTruthy()
    expect(screen.queryByTestId('notification-room-n1')).toBeNull()
  })

  it('still falls back to the raw type for a genuinely new type', () => {
    renderWithTheme(
      <NotificationRow notification={labelless({kind: 'unknown', rawType: 'someFutureThing'})} />,
    )
    expect(screen.getByText('someFutureThing')).toBeTruthy()
  })

  it('renders a viewer-event row without an invented actor', () => {
    renderWithTheme(
      <NotificationRow
        notification={labelless({
          kind: 'roleAssigned',
          rawType: 'roleAssigned',
          ext: {roleName: 'Moderator'},
        })}
      />,
    )
    expect(screen.getByText('gave you a role')).toBeTruthy()
    // The role name the server packed is the honest secondary line.
    expect(screen.getByText('Moderator')).toBeTruthy()
    // No avatar, no "Someone" placeholder, no profile link.
    expect(screen.queryByTestId('notification-avatar-n1')).toBeNull()
    expect(screen.queryByTestId('notification-avatar-fallback-n1')).toBeNull()
    expect(screen.queryByTestId('notification-actor-n1')).toBeNull()
    expect(screen.queryByText('Someone')).toBeNull()
  })

  it('names the exported entity when the wire packed one', () => {
    renderWithTheme(
      <NotificationRow
        notification={labelless({
          kind: 'exportCompleted',
          rawType: 'exportCompleted',
          ext: {exportedEntity: 'note', exportedFileId: 'file1'},
        })}
      />,
    )
    expect(screen.getByText('completed your export')).toBeTruthy()
    expect(screen.getByTestId('notification-detail-n1')).toHaveTextContent('notes')
  })

  it('shows no detail line when the wire packed none', () => {
    renderWithTheme(
      <NotificationRow notification={labelless({kind: 'exportCompleted', rawType: 'exportCompleted'})} />,
    )
    expect(screen.queryByTestId('notification-detail-n1')).toBeNull()
  })
})

describe('NotificationRow dismiss (Mastodon, clickstone §1.11)', () => {
  it('renders no dismiss control when the screen passes no handler', () => {
    renderWithTheme(<NotificationRow notification={notification()} />)
    expect(screen.queryByTestId('notification-dismiss-n1')).toBeNull()
  })

  it('fires the handler and is labelled for screen readers', () => {
    const onDismiss = jest.fn()
    renderWithTheme(<NotificationRow notification={notification()} onDismiss={onDismiss} />)
    const button = screen.getByTestId('notification-dismiss-n1')
    fireEvent.press(button)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Dismiss notification')).toBeTruthy()
  })
})
