import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {View} from 'react-native'

import type {Account} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {ProfileHeader, ProfileTabs} from '#/components/Profile'
import type {ProfileFeedTab} from '#/state/queries'

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

describe('ProfileTabs (v1 underline tablist)', () => {
  it('renders Featured/Posts/All/Replies/Media in v1 order', () => {
    renderWithProviders(
      <ProfileTabs tab="posts" onChange={() => {}} hasFeatured />,
    )
    expect(screen.getAllByRole('tab').map(t => t.props.testID)).toEqual([
      'profile-tab-featured',
      'profile-tab-posts',
      'profile-tab-all',
      'profile-tab-replies',
      'profile-tab-media',
    ])
  })

  it('hides Featured without a source, keeping All between Posts and Replies', () => {
    renderWithProviders(
      <ProfileTabs tab="posts" onChange={() => {}} hasFeatured={false} />,
    )
    expect(screen.queryByTestId('profile-tab-featured')).toBeNull()
    expect(screen.getAllByRole('tab').map(t => t.props.testID)).toEqual([
      'profile-tab-posts',
      'profile-tab-all',
      'profile-tab-replies',
      'profile-tab-media',
    ])
  })

  it('fires onChange for All and Media', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <ProfileTabs tab="posts" onChange={onChange} hasFeatured />,
    )
    fireEvent.press(screen.getByTestId('profile-tab-all'))
    expect(onChange).toHaveBeenCalledWith('all' satisfies ProfileFeedTab)
    fireEvent.press(screen.getByTestId('profile-tab-media'))
    expect(onChange).toHaveBeenCalledWith('media' satisfies ProfileFeedTab)
  })
})

describe('ProfileHeader (v1 banner + avatar row + bio + stats)', () => {
  it('renders name, handle, bio, and counts', () => {
    renderWithProviders(
      <ProfileHeader
        account={account()}
        isSelf
        relationship={null}
        actions={<View testID="stub-actions" />}
      />,
    )
    expect(screen.getByTestId('profile-name')).toBeTruthy()
    expect(screen.getByTestId('profile-handle')).toBeTruthy()
    expect(screen.getByTestId('profile-bio')).toBeTruthy()
    expect(screen.getByTestId('profile-stats')).toBeTruthy()
    expect(screen.getByTestId('stub-actions')).toBeTruthy()
  })

  it('falls back to an initial avatar and hides counts for private ff', () => {
    renderWithProviders(
      <ProfileHeader
        account={account({ffVisibility: 'private', avatarUrl: null})}
        isSelf={false}
        relationship={null}
      />,
    )
    expect(screen.getByTestId('profile-avatar')).toBeTruthy()
    expect(screen.getByText(/hidden/)).toBeTruthy()
  })

  it('marks locked and automated accounts', () => {
    renderWithProviders(
      <ProfileHeader
        account={account({locked: true, bot: true})}
        isSelf
        relationship={null}
      />,
    )
    expect(screen.getByText('Locked account.')).toBeTruthy()
    expect(screen.getByText('Automated account.')).toBeTruthy()
  })

  it('renders MFM bios through RichText, never raw source', () => {
    renderWithProviders(
      <ProfileHeader
        account={account({bio: {mfm: '**bold** bio', plain: 'bold bio'}})}
        isSelf
        relationship={null}
      />,
    )
    expect(screen.getByText('bold')).toBeTruthy()
    expect(screen.queryByText('**bold** bio')).toBeNull()
  })

  it('collapses name==handle to a single handle line (v1)', () => {
    renderWithProviders(
      <ProfileHeader
        account={account({username: 'jules', host: null, name: 'jules', displayName: 'jules'})}
        isSelf
        relationship={null}
      />,
    )
    expect(screen.getByTestId('profile-name')).toHaveTextContent('@jules')
    expect(screen.queryByTestId('profile-handle')).toBeNull()
  })

  it('resolves bio mentions to display names with a backend', async () => {
    const backend = {
      account: jest.fn(async () => ({
        id: 'u2',
        username: 'ana',
        host: 'example.social',
        name: 'Ana Liddell',
        displayName: 'Ana Liddell',
        avatarUrl: null,
      })),
    }
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <QueryClientProvider client={qc}>
            <ProfileHeader
              account={account({bio: {mfm: 'hi @ana', plain: 'hi @ana'}})}
              sessionId="s1"
              backend={backend as never}
              isSelf={false}
              relationship={null}
            />
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>,
    )
    expect(await screen.findByText('Ana Liddell')).toBeTruthy()
    expect(backend.account).toHaveBeenCalledWith({username: 'ana', host: null})
  })

  it('bio mentions stay tappable text without a backend', () => {
    renderWithProviders(
      <ProfileHeader
        account={account({bio: {mfm: 'hi @ana', plain: 'hi @ana'}})}
        isSelf={false}
        relationship={null}
      />,
    )
    expect(screen.getByTestId('richtext-mention-chip')).toBeTruthy()
    expect(screen.getByText('@ana')).toBeTruthy()
  })
})
