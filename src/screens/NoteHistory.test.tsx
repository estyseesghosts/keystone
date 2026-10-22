// Edit-history screen (clickstone §1.7): revisions render newest-first
// through the shared RichText; a family WITHOUT a history endpoint (the
// Misskey family) gets the honest unsupported state, never a fabricated
// single revision; a fork that answers 404 while advertising the method
// lands on the same honest state.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react-native'

import {ApiError, type PostRevision, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {SessionProvider} from '#/state/session/SessionProvider'

import {makeMedia} from '#/components/__tests__/fixtures'
import {NoteHistoryScreen} from './NoteHistory'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({params: {id: 'p1'}}),
}))

const mockBackends = new Map<string, unknown>()
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}))

i18n.load('en', {})
i18n.activate('en')

const SESSION: Session = {
  id: 'history-test-session',
  origin: 'https://m.example',
  family: 'mastodon',
  flavor: 'mastodon',
  accountId: 'a1',
  token: 't',
  grant: 'oauth',
  hosting: 'external',
} as unknown as Session

function revision(over: Partial<PostRevision> = {}): PostRevision {
  return {
    content: {html: '<p>original text</p>', plain: 'original text'},
    cw: null,
    sensitive: false,
    createdAt: '2026-10-20T00:00:00.000Z',
    media: [],
    accountId: 'a1',
    original: false,
    ...over,
  }
}

function setup(backend: Record<string, unknown>, session: Session = SESSION) {
  mockBackends.set(session.id, backend)
  const snap = {sessions: [session], activeId: session.id}
  const store = {
    subscribe: () => () => {},
    getSnapshot: () => snap,
    initialize: () => {},
    hydrate: async () => {},
  }
  const qc = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider homeOrigin={session.origin} store={store as never}>
          <QueryClientProvider client={qc}>
            <NoteHistoryScreen />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('NoteHistoryScreen', () => {
  beforeEach(() => mockBackends.clear())

  it('renders every revision, newest first, through the shared AST renderer', async () => {
    const backend = {
      family: 'mastodon',
      capabilities: {},
      editHistory: jest.fn(async () => [
        revision({
          content: {html: '<p>second <strong>draft</strong></p>', plain: 'second draft'},
          createdAt: '2026-10-21T00:00:00.000Z',
          cw: 'spoilers',
          media: [makeMedia({id: 'm1', description: 'a cat'})],
        }),
        revision({original: true}),
      ]),
    }
    setup(backend)
    await waitFor(() => expect(screen.getByTestId('note-history-list')).toBeTruthy())
    expect(backend.editHistory).toHaveBeenCalledWith('p1')
    // Newest first: revision-0 is the edit, revision-1 the original.
    expect(screen.getByTestId('revision-0-label')).toHaveTextContent(/^Edited/)
    expect(screen.getByTestId('revision-1-label')).toHaveTextContent(/^Original/)
    expect(screen.getByTestId('revision-0-cw')).toHaveTextContent('spoilers')
    // The body is parsed HTML → text nodes (no raw markup leaks).
    expect(screen.getByTestId('revision-0-body')).toHaveTextContent('second draft')
    expect(screen.getByTestId('revision-0-media-0')).toHaveTextContent('Attachment 1: a cat')
    expect(screen.getByTestId('note-history-count')).toHaveTextContent('1 edit')
  })

  it('says the server keeps no history when the backend has no endpoint (Misskey)', async () => {
    const session = {...SESSION, family: 'misskey', flavor: 'sharkey'} as Session
    setup({family: 'misskey', capabilities: {}}, session)
    await waitFor(() => expect(screen.getByTestId('note-history-unsupported')).toBeTruthy())
    expect(screen.getByText('This server keeps no edit history.')).toBeTruthy()
  })

  it('maps a 404 from a fork to the honest unsupported state, not an error wall', async () => {
    const backend = {
      family: 'mastodon',
      capabilities: {},
      editHistory: jest.fn(async () => {
        throw new ApiError('not found', 404, 'errors.shape')
      }),
    }
    setup(backend)
    await waitFor(() => expect(screen.getByTestId('note-history-error')).toBeTruthy())
    expect(screen.getByText('This server keeps no edit history.')).toBeTruthy()
  })
})
