import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {Text} from 'react-native'

import {ApiError, createMemoryStore, type Backend} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {
  countNewItems,
  defaultNetworkTab,
  descriptorForNetworkTab,
  feedQueryKey,
  parseFeedDescriptor,
  profileTabDescriptor,
  profileTabOpts,
  supportsSocialTimeline,
  visibleNetworkTabs,
  FeedView,
} from './HomeFeed'

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function renderWithProviders(ui: React.ReactElement, store: ReturnType<typeof createSessionStore>) {
  return render(
    <ThemeProvider theme="light">
      <SessionProvider store={store} homeOrigin={HOME_ORIGIN}>
        {ui}
      </SessionProvider>
    </ThemeProvider>,
  )
}

describe('feed-visibility rule (ported rule, own code)', () => {
  it('hides Local while Social exists on the Misskey family', () => {
    expect(supportsSocialTimeline('misskey')).toBe(true)
    expect(visibleNetworkTabs('misskey')).toEqual(['social', 'global'])
  })

  it('keeps Local on the Mastodon family (no Social timeline there)', () => {
    expect(supportsSocialTimeline('mastodon')).toBe(false)
    expect(visibleNetworkTabs('mastodon')).toEqual(['local', 'global'])
  })

  it('falls back to Local + Federated when the family is unknown', () => {
    expect(visibleNetworkTabs(null)).toEqual(['local', 'global'])
    expect(visibleNetworkTabs(undefined)).toEqual(['local', 'global'])
  })

  it('never defaults to Federated', () => {
    for (const family of ['misskey', 'mastodon', null, undefined] as const) {
      expect(defaultNetworkTab(family)).not.toBe('global')
    }
    expect(defaultNetworkTab('misskey')).toBe('social')
    expect(defaultNetworkTab('mastodon')).toBe('local')
  })

  it('maps tabs to timeline descriptors', () => {
    expect(descriptorForNetworkTab('social')).toBe('timeline|social')
    expect(descriptorForNetworkTab('local')).toBe('timeline|local')
    expect(descriptorForNetworkTab('global')).toBe('timeline|global')
  })
})

describe('feed descriptors', () => {
  it('round-trips timeline, user-tab, and tag descriptors', () => {
    expect(parseFeedDescriptor('timeline|home')).toEqual({kind: 'timeline', timeline: 'home'})
    expect(parseFeedDescriptor(profileTabDescriptor('abc', 'replies'))).toEqual({
      kind: 'user',
      userId: 'abc',
      tab: 'replies',
    })
    expect(parseFeedDescriptor('tag|Solarpunk' as never)).toEqual({kind: 'tag', tag: 'Solarpunk'})
    expect(parseFeedDescriptor('bogus' as never)).toEqual({kind: 'unknown'})
  })

  it('sends explicit falses on the posts tab (server defaults differ)', () => {
    expect(profileTabOpts('posts')).toEqual({withReplies: false, withRenotes: false})
    expect(profileTabOpts('replies')).toEqual({withReplies: true, withRenotes: false})
    expect(profileTabOpts('media')).toEqual({withFiles: true})
    expect(profileTabOpts('featured')).toEqual({featured: true})
  })

  it('keys every query by session id (account switches never leak rows)', () => {
    const a = feedQueryKey('https://a.example alice', 'timeline|home')
    const b = feedQueryKey('https://b.example bob', 'timeline|home')
    expect(a[1]).toBe('https://a.example alice')
    expect(a).not.toEqual(b)
    expect(feedQueryKey(null, 'timeline|home')[1]).toBeNull()
  })
})

describe('countNewItems', () => {
  const items = [{id: '3'}, {id: '2'}, {id: '1'}]
  it('reports 0 on first load (the list is the baseline)', () => {
    expect(countNewItems(items, null)).toBe(0)
  })
  it('counts rows above the last-seen first id', () => {
    expect(countNewItems(items, '3')).toBe(0)
    expect(countNewItems([{id: '5'}, {id: '4'}, ...items], '3')).toBe(2)
  })
  it('treats an evicted baseline as all-unseen', () => {
    expect(countNewItems(items, 'gone')).toBe(3)
  })
})

describe('FeedView states', () => {
  it('shows the signed-out state without sample data', async () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: HOME_ORIGIN})
    renderWithProviders(
      <FeedView sessionId={null} descriptor="timeline|home" backend={null} testID="feed" />,
      store,
    )
    expect(screen.getByText('Sign in to see this feed.')).toBeTruthy()
    expect(screen.queryByTestId('post-1')).toBeNull()
  })

  it('shows an error with retry, and reports unsupported feeds honestly', async () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: HOME_ORIGIN})
    const added = await store.add({
      origin: 'https://a.example',
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'alice',
      token: 'token-a',
      grant: 'password',
      hosting: 'third-party',
    })
    const timeline = jest.fn(() => Promise.reject(new ApiError('nope', 404, 'NOT_FOUND' as never)))
    const backend = {timeline} as unknown as Backend
    renderWithProviders(
      <FeedView sessionId={added.id} descriptor="timeline|social" backend={backend} testID="feed" />,
      store,
    )
    expect(await screen.findByText('Not on this server.')).toBeTruthy()
    expect(timeline).toHaveBeenCalledTimes(1)
    fireEvent.press(screen.getByTestId('feed-retry'))
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(2))
  })

  it('renders rows from the session backend (no wire in src)', async () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: HOME_ORIGIN})
    const added = await store.add({
      origin: 'https://a.example',
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'alice',
      token: 'token-a',
      grant: 'password',
      hosting: 'third-party',
    })
    const post = {
      id: 'p1',
      createdAt: '2026-10-20T00:00:00.000Z',
      author: {id: 'alice', username: 'alice', acct: 'alice', host: null, name: 'Alice', displayName: 'Alice'},
      accountId: 'alice',
      content: {plain: 'hello timeline'},
      cw: null,
      visibility: {kind: 'public', localOnly: false, raw: 'public'},
      counts: {replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0},
      reactions: null,
      favourite: null,
      media: [],
      mediaIds: [],
      poll: null,
      card: null,
      quote: null,
      quoteState: null,
      quoteUnavailable: false,
      renote: null,
      reply: null,
      replyToId: null,
      renoteId: null,
      uri: null,
      url: null,
      emojis: {},
      mentions: [],
      tags: [],
      editedAt: null,
      filtered: [],
      pinned: false,
      ext: {},
    }
    const backend = {
      timeline: jest.fn(() => Promise.resolve({items: [post], cursor: null, end: true})),
    } as unknown as Backend
    renderWithProviders(
      <FeedView sessionId={added.id} descriptor="timeline|home" backend={backend} testID="feed" />,
      store,
    )
    expect(await screen.findByText('hello timeline')).toBeTruthy()
    expect(screen.getByTestId('post-p1')).toBeTruthy()
  })

  it('sanity: test renderer works', () => {
    render(
      <ThemeProvider theme="light">
        <Text>ok</Text>
      </ThemeProvider>,
    )
    expect(screen.getByText('ok')).toBeTruthy()
  })
})
