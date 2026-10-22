// Explore screen tests: URL-backed tabs, trending per tab, unified
// search, `#`/`@` autocomplete gating, and honest unavailable states.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import type {Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {SessionProvider} from '#/state/session/SessionProvider'
import {makeAccount, makePost} from '#/components/__tests__/fixtures'

import {ExploreScreen} from './Explore'

const mockNavigate = jest.fn()
const mockSetParams = jest.fn()
const mockRouteParams: {current: {tab?: string; tag?: string} | undefined} = {current: undefined}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate, setParams: mockSetParams}),
  useRoute: () => ({params: mockRouteParams.current}),
}))

const mockBackends = new Map<string, unknown>()
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

i18n.load('en', {})
i18n.activate('en')

const SESSION = {
  id: 'explore-test-session',
  origin: 'https://a.example',
  family: 'misskey',
  flavor: 'misskey',
  accountId: 'a1',
  token: 't',
  grant: 'miauth',
  hosting: 'external',
} as unknown as Session

function storeFor(signedIn: boolean) {
  const snap = signedIn ? {sessions: [SESSION], activeId: SESSION.id} : {sessions: [], activeId: null}
  return {
    subscribe: () => () => {},
    getSnapshot: () => snap,
    initialize: () => {},
    hydrate: async () => {},
  }
}

function baseBackend(over: Record<string, unknown> = {}) {
  return {
    family: 'misskey',
    capabilities: {},
    me: jest.fn(async () => makeAccount({id: 'a1'})),
    mutes: jest.fn(async () => ({items: [], cursor: null, end: true})),
    blocks: jest.fn(async () => ({items: [], cursor: null, end: true})),
    search: {
      posts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      tags: jest.fn(async () => ({items: [], cursor: null, end: true})),
      accounts: jest.fn(async () => ({items: [], cursor: null, end: true})),
    },
    ...over,
  }
}

function setup({
  backend,
  params,
  signedIn = true,
}: {
  backend?: unknown
  params?: {tab?: string; tag?: string}
  signedIn?: boolean
} = {}) {
  mockNavigate.mockClear()
  mockSetParams.mockClear()
  mockBackends.clear()
  mockRouteParams.current = params
  if (signedIn && backend) mockBackends.set(SESSION.id, backend)
  const qc = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider homeOrigin="https://a.example" store={storeFor(signedIn) as never}>
          <QueryClientProvider client={qc}>
            <ExploreScreen />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('ExploreScreen', () => {
  it('asks to sign in when signed out, with no sample data', () => {
    setup({signedIn: false})
    expect(screen.getByText('Sign in to explore.')).toBeTruthy()
    expect(screen.queryByTestId('explore-users')).toBeNull()
  })

  it('defaults to the posts tab with trending posts when idle', async () => {
    const post = makePost({id: 'p1', content: {mfm: 'trending post', plain: 'trending post'}})
    const backend = baseBackend({
      explore: {
        posts: jest.fn(async () => ({items: [post], cursor: null, end: true})),
      },
    })
    setup({backend})
    expect(await screen.findByText('trending post')).toBeTruthy()
    expect(screen.getByTestId('explore-posts-feed')).toBeTruthy()
  })

  it('switching tabs navigates with the tab param', async () => {
    const backend = baseBackend({
      explore: {posts: jest.fn(async () => ({items: [], cursor: null, end: true}))},
    })
    setup({backend})
    expect(await screen.findByTestId('explore-tab-tags')).toBeTruthy()
    fireEvent.press(screen.getByTestId('explore-tab-tags'))
    expect(mockSetParams).toHaveBeenCalledWith({tab: 'tags'})
  })

  it('tags tab renders trending tags that open the tag screen', async () => {
    const backend = baseBackend({
      explore: {
        tags: jest.fn(async () => [
          {name: 'cats', users: 3, uses: 7},
          {name: 'dogs', users: null, uses: 2},
        ]),
      },
    })
    setup({backend, params: {tab: 'tags'}})
    expect(await screen.findByText('#cats')).toBeTruthy()
    expect(screen.getByText('#dogs')).toBeTruthy()
    expect(screen.getAllByTestId('explore-tags-sep')).toHaveLength(1)
    fireEvent.press(screen.getByTestId('explore-tag-cats'))
    expect(mockNavigate).toHaveBeenCalledWith('Tag', {tag: 'cats'})
  })

  it('users tab renders pinned and suggested accounts with avatars and separators', async () => {
    const alice = makeAccount({
      id: 'a1',
      username: 'alice',
      acct: 'alice@example.social',
      avatarUrl: 'https://img.example/alice.png',
    })
    const bob = makeAccount({id: 'b1', username: 'bob', acct: 'bob@example.social'})
    const backend = baseBackend({
      explore: {users: jest.fn(async () => ({pinned: [alice], suggested: [bob]}))},
    })
    setup({backend, params: {tab: 'users'}})
    expect(await screen.findByTestId('explore-users')).toBeTruthy()
    // Profile pictures ride left of each row (real photo or initial fallback).
    expect(screen.getByTestId('explore-avatar-a1')).toBeTruthy()
    expect(screen.getByTestId('explore-avatar-b1')).toBeTruthy()
    // Label + Alice + label + Bob: one rule between every pair.
    expect(screen.getAllByTestId('explore-users-sep')).toHaveLength(3)
    fireEvent.press(screen.getByTestId('explore-account-b1'))
    expect(mockNavigate).toHaveBeenCalledWith('User', {id: 'b1'})
  })

  it('hides the news tab without explore.news and shows it with', async () => {
    const without = baseBackend({
      explore: {posts: jest.fn(async () => ({items: [], cursor: null, end: true}))},
    })
    setup({backend: without})
    expect(await screen.findByTestId('explore-posts-feed')).toBeTruthy()
    expect(screen.queryByTestId('explore-tab-news')).toBeNull()
  })

  it('news tab prefetches the next page on scroll, no button', async () => {
    const news = jest
      .fn()
      .mockResolvedValueOnce({
        items: [
          {url: 'https://n.example/1', title: 'Big news', description: null, providerName: 'N', image: null},
        ],
        cursor: 'c1',
        end: false,
      })
      .mockResolvedValue({items: [], cursor: null, end: true})
    const backend = baseBackend({
      explore: {
        posts: jest.fn(async () => ({items: [], cursor: null, end: true})),
        news,
      },
    })
    setup({backend, params: {tab: 'news'}})
    expect(await screen.findByText('Big news')).toBeTruthy()
    // No overlay row, no button: the next page loads from the scroll edge.
    expect(screen.queryByTestId('explore-news-more')).toBeNull()
    const list = screen.getByTestId('explore-news')
    ;(list.props as {onEndReached: () => void}).onEndReached()
    await waitFor(() => expect(news).toHaveBeenCalledTimes(2))
    expect(news).toHaveBeenLastCalledWith({limit: 10, cursor: 'c1'})
  })

  it('news tab renders trending links with photos and separators', async () => {
    const backend = baseBackend({
      explore: {
        posts: jest.fn(async () => ({items: [], cursor: null, end: true})),
        news: jest.fn(async () => ({
          items: [
            {
              url: 'https://n.example/1',
              title: 'Big news',
              description: null,
              providerName: 'N',
              image: 'https://n.example/1.png',
            },
            {
              url: 'https://n.example/2',
              title: 'Small news',
              description: null,
              providerName: null,
              image: null,
            },
          ],
          cursor: null,
          end: true,
        })),
      },
    })
    setup({backend, params: {tab: 'news'}})
    expect(screen.getByTestId('explore-tab-news')).toBeTruthy()
    expect(await screen.findByText('Big news')).toBeTruthy()
    expect(screen.getByText('Small news')).toBeTruthy()
    // Only the link with an image renders a photo; one rule per pair.
    expect(screen.getAllByTestId('explore-news-photo')).toHaveLength(1)
    expect(screen.getAllByTestId('explore-news-sep')).toHaveLength(1)
  })

  it('posts search runs the search.posts feed', async () => {
    const post = makePost({id: 'p9', content: {mfm: 'found it', plain: 'found it'}})
    const searchPosts = jest.fn(async () => ({items: [post], cursor: null, end: true}))
    const backend = baseBackend({
      explore: {posts: jest.fn(async () => ({items: [], cursor: null, end: true}))},
      search: {
        posts: searchPosts,
        tags: jest.fn(async () => ({items: [], cursor: null, end: true})),
        accounts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      },
    })
    setup({backend})
    expect(await screen.findByTestId('explore-posts-feed')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('explore-search-input'), 'hello')
    fireEvent.press(screen.getByTestId('explore-search-submit'))
    await waitFor(() => expect(searchPosts).toHaveBeenCalledWith('hello', expect.anything()))
    expect(await screen.findByText('found it')).toBeTruthy()
  })

  it('legacy ?tag= seeds the posts query', async () => {
    const searchPosts = jest.fn(async () => ({items: [], cursor: null, end: true}))
    const backend = baseBackend({
      explore: {posts: jest.fn(async () => ({items: [], cursor: null, end: true}))},
      search: {
        posts: searchPosts,
        tags: jest.fn(async () => ({items: [], cursor: null, end: true})),
        accounts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      },
    })
    setup({backend, params: {tag: 'cats'}})
    await waitFor(() => expect(searchPosts).toHaveBeenCalledWith('cats', expect.anything()))
  })

  it('tag autocomplete pops up only when suggestTags exists, and picking fills the field', async () => {
    const suggestTags = jest.fn(async () => ['cats', 'catstodon'])
    const backend = baseBackend({
      explore: {posts: jest.fn(async () => ({items: [], cursor: null, end: true}))},
      search: {
        posts: jest.fn(async () => ({items: [], cursor: null, end: true})),
        tags: jest.fn(async () => ({items: [], cursor: null, end: true})),
        accounts: jest.fn(async () => ({items: [], cursor: null, end: true})),
        suggestTags,
      },
    })
    setup({backend})
    expect(await screen.findByTestId('explore-posts-feed')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('explore-search-input'), '#ca')
    expect(await screen.findByTestId('explore-suggest')).toBeTruthy()
    expect(suggestTags).toHaveBeenCalledWith('ca', expect.anything())
    fireEvent.press(screen.getByTestId('explore-suggest-0'))
    expect(screen.getByTestId('explore-search-input').props.value).toBe('#cats ')
  })

  it('no autocomplete popup when the backend offers no suggest members', async () => {
    const backend = baseBackend({
      explore: {posts: jest.fn(async () => ({items: [], cursor: null, end: true}))},
    })
    setup({backend})
    expect(await screen.findByTestId('explore-posts-feed')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('explore-search-input'), '#ca')
    await act(async () => {
      await new Promise(r => setTimeout(r, 450))
    })
    expect(screen.queryByTestId('explore-suggest')).toBeNull()
  })

  it('without an explore module the lists are unavailable but post search still works', async () => {
    const searchPosts = jest.fn(async () => ({items: [], cursor: null, end: true}))
    const backend = baseBackend({
      search: {
        posts: searchPosts,
        tags: jest.fn(async () => ({items: [], cursor: null, end: true})),
        accounts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      },
    })
    setup({backend, params: {tab: 'users'}})
    expect(await screen.findByText('Trending users are not available on this server.')).toBeTruthy()
  })

  it('users tab search finds profiles', async () => {
    const bob = makeAccount({id: 'b1', username: 'bob', acct: 'bob@example.social'})
    const searchAccounts = jest.fn(async () => ({items: [bob], cursor: null, end: true}))
    const backend = baseBackend({
      explore: {users: jest.fn(async () => ({pinned: [], suggested: []}))},
      search: {
        posts: jest.fn(async () => ({items: [], cursor: null, end: true})),
        tags: jest.fn(async () => ({items: [], cursor: null, end: true})),
        accounts: searchAccounts,
      },
    })
    setup({backend, params: {tab: 'users'}})
    expect(await screen.findByText('No trending users right now.')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('explore-search-input'), '@bob')
    fireEvent.press(screen.getByTestId('explore-search-submit'))
    await waitFor(() => expect(searchAccounts).toHaveBeenCalledWith('bob', expect.anything()))
    expect(await screen.findByTestId('explore-account-b1')).toBeTruthy()
  })
})
