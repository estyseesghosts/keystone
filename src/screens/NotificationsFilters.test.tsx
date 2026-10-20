import {render, screen} from '@testing-library/react-native'

import {NOTIFICATION_FILTER_PRESETS, type Notification} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'

import {NotificationRow} from './Notifications'

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme="light">{ui}</ThemeProvider>)
}

const baseNotification: Notification = {
  id: 'n1',
  kind: 'reaction',
  rawType: 'reaction',
  createdAt: '2026-10-20T00:00:00.000Z',
  read: false,
  actors: [
    {
      id: 'u1',
      account: {
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
      },
      reaction: '❤',
    },
  ],
  post: null,
  reaction: '❤',
  ext: {},
}

describe('notification filter presets (single list, type presets only)', () => {
  it('covers all, mentions, reactions, reposts, follows, polls', () => {
    const ids = NOTIFICATION_FILTER_PRESETS.map(p => p.id)
    expect(ids).toEqual(['all', 'mentions', 'reactions', 'reposts', 'follows', 'polls'])
  })

  it('maps to include/exclude types (no second list UI)', () => {
    for (const preset of NOTIFICATION_FILTER_PRESETS) {
      if (preset.id !== 'all') {
        expect(preset.includeTypes && preset.includeTypes.length).toBeGreaterThan(0)
      }
    }
    const mentions = NOTIFICATION_FILTER_PRESETS.find(p => p.id === 'mentions')
    expect(mentions?.includeTypes).toContain('mention')
    const reactions = NOTIFICATION_FILTER_PRESETS.find(p => p.id === 'reactions')
    expect(reactions?.includeTypes).toContain('reaction')
  })
})

describe('NotificationRow', () => {
  it('renders the actor, kind label, and unread state (never faked)', () => {
    renderWithTheme(<NotificationRow notification={baseNotification} />)
    expect(screen.getByText('Bob reacted ❤')).toBeTruthy()
    expect(screen.getByText('New')).toBeTruthy()
    expect(screen.queryByText('Read')).toBeNull()
  })

  it('renders id-only actors without inventing a profile', () => {
    renderWithTheme(
      <NotificationRow
        notification={{...baseNotification, actors: [{id: 'ghost-id-123456', account: null, reaction: null}]}}
      />,
    )
    expect(screen.getByText(/sent a notification|reacted/)).toBeTruthy()
  })
})
