// WS-F MD1 acceptance: a grouped `notification_groups` row shows "N others"
// off the SERVER total (`ext.groupedCount`), never off the sampled actor
// length. Flat rows (no groupedCount) keep the actor-list count.

import {render, screen} from '@testing-library/react-native'

import type {Account, Notification} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'

import {NotificationRow} from './NotificationRow'

function account(over: Partial<Account> = {}): Account {
  return {
    id: 'u1',
    username: 'alice',
    acct: 'alice',
    host: null,
    name: 'Alice',
    displayName: 'Alice',
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

function notification(over: Partial<Notification> = {}): Notification {
  return {
    id: 'wsf-g1',
    kind: 'favourite',
    rawType: 'favourite',
    createdAt: new Date().toISOString(),
    read: false,
    actors: [],
    post: null,
    reaction: null,
    ext: {},
    ...over,
  } as Notification
}

describe('NotificationRow grouped server total (WS-F MD1)', () => {
  it('counts "others" off groupedCount, not the sampled actors', () => {
    // Real-envelope shape: server total 12, three sampled actors.
    render(
      <ThemeProvider theme="light">
        <NotificationRow
          notification={notification({
            actors: [
              {id: '2', account: account({id: '2', username: 'alice'}), reaction: null},
              {id: '3', account: account({id: '3', username: 'bob'}), reaction: null},
              {id: '4', account: null, reaction: null},
            ],
            ext: {groupedCount: 12},
          })}
        />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('notification-others-wsf-g1')).toBeTruthy()
    expect(screen.getByText('and 11 others')).toBeTruthy()
  })

  it('falls back to the actor list when the group reports no count', () => {
    render(
      <ThemeProvider theme="light">
        <NotificationRow
          notification={notification({
            id: 'wsf-g2',
            actors: [
              {id: '2', account: account({id: '2', username: 'alice'}), reaction: null},
              {id: '3', account: account({id: '3', username: 'bob'}), reaction: null},
            ],
          })}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText('and 1 other')).toBeTruthy()
  })

  it('never understates known actors on an inconsistent envelope', () => {
    render(
      <ThemeProvider theme="light">
        <NotificationRow
          notification={notification({
            id: 'wsf-g3',
            actors: [
              {id: '2', account: account({id: '2', username: 'alice'}), reaction: null},
              {id: '3', account: account({id: '3', username: 'bob'}), reaction: null},
              {id: '4', account: null, reaction: null},
            ],
            ext: {groupedCount: 2},
          })}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText('and 2 others')).toBeTruthy()
  })
})
