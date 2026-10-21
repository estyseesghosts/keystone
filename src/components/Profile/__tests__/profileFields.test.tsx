// C14 + F11-half tests: profile fields render through the allow-listed
// AST, the name line renders custom emoji (never the raw code), and the
// reactions block degrades honestly per family.
import {render, screen, waitFor} from '@testing-library/react-native'
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'

import {ApiError, type Account} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {ProfileHeader} from '#/components/Profile/ProfileHeader'
import {AccountReactionsBlock} from '#/components/Profile/AccountReactions'

i18n.load('en', {})
i18n.activate('en')

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'u1',
    username: 'jules',
    acct: 'jules',
    host: null,
    name: 'Jules Verne',
    displayName: 'Jules Verne',
    bio: {plain: 'hello there'},
    url: null,
    uri: null,
    avatarUrl: null,
    avatarBlurhash: null,
    headerUrl: null,
    headerBlurhash: null,
    followersCount: 10,
    followingCount: 5,
    statusesCount: 42,
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
    ffVisibility: 'public',
    pinnedPostIds: null,
    pinnedPosts: null,
    ext: {},
    ...overrides,
  } as Account
}

describe('ProfileHeader fields (C14)', () => {
  it('renders profile fields with values and the verified marker', () => {
    renderWithProviders(
      <ProfileHeader
        account={account({
          fields: [
            {name: 'site', value: 'example.com', verifiedAt: '2024-01-01'},
            {name: 'pronouns', value: 'he/him', verifiedAt: null},
          ],
        })}
        isSelf
        relationship={null}
      />,
    )
    expect(screen.getByTestId('profile-fields')).toBeTruthy()
    expect(screen.getByTestId('profile-field-0')).toBeTruthy()
    expect(screen.getByTestId('profile-field-1')).toBeTruthy()
    expect(screen.getByText(/Verified/)).toBeTruthy()
  })

  it('renders HTML field values through the AST, never raw markup', () => {
    renderWithProviders(
      <ProfileHeader
        account={account({
          fields: [{name: 'site', value: '<a href="https://x.example">x</a>', verifiedAt: null}],
        })}
        isSelf
        relationship={null}
      />,
    )
    expect(screen.getByText('x')).toBeTruthy()
    expect(screen.queryByText('<a href="https://x.example">x</a>')).toBeNull()
  })

  it('omits the fields block when the account has none', () => {
    renderWithProviders(<ProfileHeader account={account()} isSelf relationship={null} />)
    expect(screen.queryByTestId('profile-fields')).toBeNull()
  })

  it('renders custom-emoji names through DisplayName (F11)', () => {
    renderWithProviders(
      <ProfileHeader
        account={account({
          name: 'Ann :blobcat:',
          displayName: 'Ann :blobcat:',
          emojis: {blobcat: 'https://cdn.example/blobcat.png'},
        })}
        isSelf
        relationship={null}
      />,
    )
    expect(screen.getByTestId('profile-name')).toBeTruthy()
    expect(screen.queryByText('Ann :blobcat:')).toBeNull()
  })
})

describe('AccountReactionsBlock (C14)', () => {
  const post = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'n1',
      content: {plain: 'a visible note'},
      ...overrides,
    }) as any

  it('renders reaction rows with their posts', async () => {
    const backend = {
      accountReactions: jest.fn(async () => ({
        items: [
          {id: 'r1', createdAt: '2024-01-01', reaction: '❤', post: post()},
          {id: 'r2', createdAt: '2024-01-02', reaction: '👍', post: null},
        ],
        cursor: null,
        end: true,
      })),
    } as any
    renderWithProviders(<AccountReactionsBlock backend={backend} accountId="u1" />)
    await waitFor(() => expect(screen.getByTestId('account-reaction-r1')).toBeTruthy())
    expect(screen.getByTestId('account-reaction-r2')).toBeTruthy()
    expect(screen.getByText('A note you cannot see.')).toBeTruthy()
    expect(backend.accountReactions).toHaveBeenCalledWith('u1', {limit: 20})
  })

  it('renders the honest unavailable state on the Mastodon family', async () => {
    const backend = {
      accountReactions: jest.fn(async () => {
        throw new ApiError('Reaction listings are not available on this server.', 404, 'errors.unsupported.reactions')
      }),
    } as any
    renderWithProviders(<AccountReactionsBlock backend={backend} accountId="u1" />)
    await waitFor(() => expect(screen.getByTestId('account-reactions-unavailable')).toBeTruthy())
  })

  it('renders an error state on unexpected failures', async () => {
    const backend = {
      accountReactions: jest.fn(async () => {
        throw new Error('boom')
      }),
    } as any
    renderWithProviders(<AccountReactionsBlock backend={backend} accountId="u1" />)
    await waitFor(() => expect(screen.getByTestId('account-reactions-error')).toBeTruthy())
  })
})
