import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react-native'
import {FlatList} from 'react-native'

import {
  NOTIFICATION_FILTER_PRESETS,
  createMemoryStore,
  notificationFilterPresets,
  type Backend,
  type Notification,
} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {NotificationRow, NotificationsScreen} from './Notifications'

const mockBackends = new Map<string, unknown>()
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

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
  it('covers the type presets plus the Misskey-only system rows', () => {
    const ids = NOTIFICATION_FILTER_PRESETS.map(p => p.id)
    expect(ids).toEqual([
      'all',
      'mentions',
      'reactions',
      'reposts',
      'follows',
      'polls',
      'notes',
      'system',
    ])
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

  // clickstone §1.11: the newly mapped Misskey types need a filter home,
  // and a preset the family cannot serve is hidden instead of always-empty.
  it('gives the mapped Misskey types a preset that Misskey serves', () => {
    const system = NOTIFICATION_FILTER_PRESETS.find(p => p.id === 'system')
    for (const kind of [
      'scheduledNotePosted',
      'scheduledNotePostFailed',
      'exportCompleted',
      'roleAssigned',
      'achievement',
      'login',
      'createToken',
      'test',
    ]) {
      expect(system?.includeTypes).toContain(kind)
    }
    const notes = NOTIFICATION_FILTER_PRESETS.find(p => p.id === 'notes')
    expect(notes?.includeTypes).toEqual(['note'])
  })

  it('hides the Misskey-only presets on the Mastodon family', () => {
    const misskey = notificationFilterPresets('misskey').map(p => p.id)
    const mastodon = notificationFilterPresets('mastodon').map(p => p.id)
    expect(misskey).toContain('notes')
    expect(misskey).toContain('system')
    expect(mastodon).not.toContain('notes')
    expect(mastodon).not.toContain('system')
    // The six shared presets stay identical on both families.
    expect(mastodon).toEqual(['all', 'mentions', 'reactions', 'reposts', 'follows', 'polls'])
  })
})

describe('NotificationRow', () => {
  it('renders the actor, kind label, and unread state (never faked)', () => {
    renderWithTheme(<NotificationRow notification={baseNotification} />)
    // The actor name renders through DisplayName (custom-emoji aware), so
    // the name and the kind label are sibling text nodes — never one
    // concatenated string.
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText('reacted ❤')).toBeTruthy()
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

describe('NotificationsScreen prefetch (seamless infinite scroll)', () => {
  it('fetches the next page well before the bottom edge', async () => {
    const vault: TokenVault = {
      getToken: async () => null,
      setToken: async () => {},
      removeToken: async () => {},
    }
    const store = createSessionStore({storage: createMemoryStore(), vault, homeOrigin: 'https://a.example'})
    const added = await store.add({
      origin: 'https://a.example',
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'alice',
      token: 'token-a',
      grant: 'password',
      hosting: 'third-party',
    })
    mockBackends.set(added.id, {
      family: 'misskey',
      capabilities: {},
      notifications: jest.fn(async () => ({items: [], cursor: null, end: true})),
    } as unknown as Backend)
    i18n.load('en', {})
    i18n.activate('en')
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <QueryClientProvider client={new QueryClient()}>
            <SessionProvider store={store} homeOrigin="https://a.example">
              <NotificationsScreen />
            </SessionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>,
    )
    expect(await screen.findByText('No notifications.')).toBeTruthy()
    const list = screen.UNSAFE_getByType(FlatList)
    expect((list.props as {onEndReachedThreshold?: number}).onEndReachedThreshold).toBeGreaterThanOrEqual(2)
  })
})
