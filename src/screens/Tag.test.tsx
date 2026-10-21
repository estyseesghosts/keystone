// Tag screen tests: the `tag|<tag>` feed resolves through FeedView,
// with honest signed-out and empty-tag states.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react-native'

import type {Session} from '@keystone/fedi'

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
