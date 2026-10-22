// Tag screen tests: the `tag|<tag>` feed resolves through FeedView,
// with honest signed-out and empty-tag states.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {ApiError, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {SessionProvider} from '#/state/session/SessionProvider'
import {makeAccount, makePost} from '#/components/__tests__/fixtures'

import {TagScreen} from './Tag'

const mockRouteParams: {current: {tag: string}} = {current: {tag: 'cats'}}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
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
  id: 'tag-test-session',
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

function setup({backend, tag, signedIn = true}: {backend?: unknown; tag?: string; signedIn?: boolean} = {}) {
  mockBackends.clear()
  mockRouteParams.current = {tag: tag ?? 'cats'}
  if (signedIn && backend) mockBackends.set(SESSION.id, backend)
  const qc = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider homeOrigin="https://a.example" store={storeFor(signedIn) as never}>
          <QueryClientProvider client={qc}>
            <TagScreen />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('TagScreen', () => {
  it('asks to sign in when signed out', () => {
    setup({signedIn: false})
    expect(screen.getByText('Sign in to browse this tag.')).toBeTruthy()
    expect(screen.queryByTestId('tag-feed')).toBeNull()
  })

  it('renders the tag feed through the search.tags descriptor', async () => {
    const post = makePost({id: 'p1', content: {mfm: 'tagged post', plain: 'tagged post'}})
    const searchTags = jest.fn(async () => ({items: [post], cursor: null, end: true}))
    const backend = {
      family: 'misskey',
      capabilities: {},
      me: jest.fn(async () => makeAccount({id: 'a1'})),
      mutes: jest.fn(async () => ({items: [], cursor: null, end: true})),
      blocks: jest.fn(async () => ({items: [], cursor: null, end: true})),
      search: {
        tags: searchTags,
        posts: jest.fn(async () => ({items: [], cursor: null, end: true})),
        accounts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      },
    }
    setup({backend, tag: 'cats'})
    await waitFor(() => expect(searchTags).toHaveBeenCalledWith('cats', expect.anything()))
    expect(await screen.findByText('tagged post')).toBeTruthy()
  })

  it('strips a leading # and reports an empty tag honestly', () => {
    setup({backend: {family: 'misskey', capabilities: {}}, tag: '#'})
    expect(screen.getByText('This tag is empty.')).toBeTruthy()
  })
})

// Clickstone §1.4: the tag action block. Follow/Unfollow mirrors the
// server state after every write; Feature/Don't feature is the vanilla
// Mastodon pin (absent on forks → disabled row with the reason); hashtag
// MUTE has no endpoint anywhere → an honest disabled row, never a fake.
describe('TagScreen actions (clickstone 1.4)', () => {
  const tagBackend = ({
    following = false,
    featuring = false,
    withFeature = true,
  }: {following?: boolean; featuring?: boolean; withFeature?: boolean} = {}) => {
    let state = {following, featuring}
    const backend: any = {
      family: 'mastodon',
      capabilities: {},
      me: jest.fn(async () => makeAccount({id: 'a1'})),
      mutes: jest.fn(async () => ({items: [], cursor: null, end: true})),
      blocks: jest.fn(async () => ({items: [], cursor: null, end: true})),
      search: {
        tags: jest.fn(async () => ({items: [], cursor: null, end: true})),
        posts: jest.fn(async () => ({items: [], cursor: null, end: true})),
        accounts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      },
      tags: {
        show: jest.fn(async (name: string) => ({
          name,
          url: `https://m.example/tags/${name}`,
          following: state.following,
          featuring: state.featuring,
        })),
        follow: jest.fn(async () => {
          state = {...state, following: true}
        }),
        unfollow: jest.fn(async () => {
          state = {...state, following: false}
        }),
        followed: jest.fn(async () => ({items: [], cursor: null, end: true})),
      },
    }
    if (withFeature) {
      backend.tags.feature = jest.fn(async () => {
        state = {...state, featuring: true}
      })
      backend.tags.unfeature = jest.fn(async () => {
        state = {...state, featuring: false}
      })
      backend.tags.featured = jest.fn(async () => [])
    }
    return backend
  }

  it('follows a tag and flips the label from the re-read state', async () => {
    const backend = tagBackend()
    setup({backend})
    expect(await screen.findByText('Follow hashtag')).toBeTruthy()
    fireEvent.press(screen.getByTestId('tag-follow'))
    await waitFor(() => expect(backend.tags.follow).toHaveBeenCalledWith('cats'))
    expect(await screen.findByText('Unfollow hashtag')).toBeTruthy()
  })

  it('unfollows a followed tag', async () => {
    const backend = tagBackend({following: true})
    setup({backend})
    expect(await screen.findByText('Unfollow hashtag')).toBeTruthy()
    fireEvent.press(screen.getByTestId('tag-follow'))
    await waitFor(() => expect(backend.tags.unfollow).toHaveBeenCalledWith('cats'))
    expect(await screen.findByText('Follow hashtag')).toBeTruthy()
  })

  it('features a tag on the profile and unpins it again', async () => {
    const backend = tagBackend()
    setup({backend})
    expect(await screen.findByText('Feature on profile')).toBeTruthy()
    fireEvent.press(screen.getByTestId('tag-feature'))
    await waitFor(() => expect(backend.tags.feature).toHaveBeenCalledWith('cats'))
    expect(await screen.findByText("Don't feature on profile")).toBeTruthy()
    fireEvent.press(screen.getByTestId('tag-feature'))
    await waitFor(() => expect(backend.tags.unfeature).toHaveBeenCalledWith('cats'))
    expect(await screen.findByText('Feature on profile')).toBeTruthy()
  })

  it('keeps a disabled feature row with the reason on a fork without featured tags', async () => {
    const backend = tagBackend({withFeature: false})
    setup({backend})
    const feature = await screen.findByTestId('tag-feature')
    expect(feature.props.accessibilityState.disabled).toBe(true)
    expect(
      screen.getByText('Featured hashtags are not available on this server.'),
    ).toBeTruthy()
    // Follow still works: the follow endpoint exists on that fork.
    expect(screen.getByTestId('tag-follow').props.accessibilityState.disabled).toBe(false)
  })

  it('documents the hashtag-mute gap with a disabled row (no endpoint anywhere)', async () => {
    setup({backend: tagBackend()})
    const mute = await screen.findByTestId('tag-mute')
    expect(mute.props.accessibilityState.disabled).toBe(true)
    expect(
      screen.getByText(
        'There is no hashtag-mute endpoint on this server; use a keyword filter instead.',
      ),
    ).toBeTruthy()
  })

  it('disables follow with a reason when the tag endpoint 404s, keeping the feed', async () => {
    const backend = tagBackend()
    backend.tags.show = jest.fn(async () => {
      throw new ApiError('Not found', 404)
    })
    setup({backend})
    const follow = await screen.findByTestId('tag-follow')
    expect(follow.props.accessibilityState.disabled).toBe(true)
    expect(screen.getByText('This server has no state for this hashtag yet.')).toBeTruthy()
    expect(screen.getByTestId('tag-feed')).toBeTruthy()
    expect(screen.queryByTestId('tag-actions-error')).toBeNull()
  })

  it('explains the family gap when the backend has no tag API at all', async () => {
    const backend = {
      family: 'misskey',
      capabilities: {},
      search: {
        tags: jest.fn(async () => ({items: [], cursor: null, end: true})),
        posts: jest.fn(async () => ({items: [], cursor: null, end: true})),
        accounts: jest.fn(async () => ({items: [], cursor: null, end: true})),
      },
    }
    setup({backend})
    const follow = await screen.findByTestId('tag-follow')
    expect(follow.props.accessibilityState.disabled).toBe(true)
    expect(screen.getByText('Hashtag following needs a Mastodon-family server.')).toBeTruthy()
  })
})
