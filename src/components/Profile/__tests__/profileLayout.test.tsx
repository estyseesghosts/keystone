// Profile detail layout in the header (plan: profile page layout):
// background image, bio/field cards, and the mobile-stack vs
// desktop-split/center rules. Width is switchable: 390 (mobile) vs 1280
// (desktop rail/full — both are `!== 'mobile'`).
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {render, screen, act, within} from '@testing-library/react-native'
import {View} from 'react-native'

import type {Account} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {ProfileHeader} from '#/components/Profile/ProfileHeader'
import {PROFILE_AVATAR_SIZE} from '#/components/Profile/ProfileAvatar'

const widthHolder: {width: number} = {width: 390}
jest.mock('#/alf/useViewportWidth', () => ({
  useViewportWidth: () => widthHolder.width,
}))

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
    bio: {plain: ''},
    url: null,
    uri: null,
    avatarUrl: null,
    avatarBlurhash: null,
    headerUrl: null,
    headerBlurhash: null,
    backgroundUrl: null,
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

function header(a: Account) {
  return <ProfileHeader account={a} isSelf relationship={null} />
}

const siteField = {name: 'site', value: 'example.com', verifiedAt: null}
const pronounsField = {name: 'pronouns', value: 'he/him', verifiedAt: null}

describe('ProfileHeader background', () => {
  // The background image is decorative (`accessibilityElementsHidden`):
  // queries need `includeHiddenElements` to see it.
  const bgOpts = {includeHiddenElements: true}

  it('renders no background image when backgroundUrl is null', () => {
    renderWithProviders(header(account()))
    expect(screen.queryByTestId('profile-background', bgOpts)).toBeNull()
  })

  it('renders the background image with its URI; the banner keeps headerUrl', () => {
    renderWithProviders(
      header(
        account({
          headerUrl: 'https://example.test/banner.png',
          backgroundUrl: 'https://example.test/bg.png',
        }),
      ),
    )
    expect(screen.getByTestId('profile-background', bgOpts).props.source).toEqual({
      uri: 'https://example.test/bg.png',
    })
    expect(screen.getByTestId('profile-banner').props.source).toEqual({
      uri: 'https://example.test/banner.png',
    })
  })

  it('hides a background image that fails to load', () => {
    renderWithProviders(header(account({backgroundUrl: 'https://example.test/bg.png'})))
    expect(screen.getByTestId('profile-background', bgOpts)).toBeTruthy()
    act(() => {
      screen.getByTestId('profile-background', bgOpts).props.onError()
    })
    expect(screen.queryByTestId('profile-background', bgOpts)).toBeNull()
  })
})

describe('ProfileHeader cards', () => {
  it('wraps the bio in profile-bio-card; absent bio renders no card', () => {
    const {unmount} = renderWithProviders(header(account({bio: {plain: 'hello there'}})))
    expect(screen.getByTestId('profile-bio-card')).toBeTruthy()
    expect(screen.getByTestId('profile-bio')).toBeTruthy()
    unmount()
    renderWithProviders(header(account({bio: {plain: ''}})))
    expect(screen.queryByTestId('profile-bio-card')).toBeNull()
    expect(screen.queryByTestId('profile-bio')).toBeNull()
  })

  it('renders each field as its own card inside profile-fields', () => {
    renderWithProviders(header(account({bio: {plain: ''}, fields: [siteField, pronounsField]})))
    expect(screen.getByTestId('profile-fields')).toBeTruthy()
    expect(screen.getByTestId('profile-field-0')).toBeTruthy()
    expect(screen.getByTestId('profile-field-1')).toBeTruthy()
  })
})

describe('ProfileHeader identity row', () => {
  it('pins the avatar size (~10% over the previous 88)', () => {
    expect(PROFILE_AVATAR_SIZE).toBe(96)
  })

  it('left-justifies the identity text and keeps actions in the same row', () => {
    widthHolder.width = 390
    renderWithProviders(
      <ProfileHeader
        account={account({bio: {plain: ''}})}
        isSelf
        relationship={null}
        actions={<View testID="stub-actions" />}
      />,
    )
    expect(screen.getByTestId('profile-identity').props.style).toMatchObject({
      flex: 1,
      alignItems: 'flex-start',
    })
    const actionsSlot = screen.getByTestId('profile-identity-actions')
    expect(actionsSlot.props.style).toMatchObject({flexShrink: 0})
    expect(screen.getByTestId('stub-actions')).toBeTruthy()
    // Same visual row: the name, handle, and actions share one row.
    const row = screen.getByTestId('profile-identity-row')
    expect(within(row).getByTestId('profile-identity')).toBeTruthy()
    expect(within(row).getByTestId('profile-name')).toBeTruthy()
    expect(within(row).getByTestId('profile-handle')).toBeTruthy()
    expect(within(row).getByTestId('stub-actions')).toBeTruthy()
  })

  it('renders no actions slot when the caller supplies none', () => {
    widthHolder.width = 390
    renderWithProviders(header(account({bio: {plain: ''}})))
    expect(screen.queryByTestId('profile-identity-actions')).toBeNull()
    expect(screen.getByTestId('profile-name')).toBeTruthy()
  })
})

describe('ProfileHeader detail columns', () => {
  const bioAndFields = () => account({bio: {plain: 'hello there'}, fields: [siteField]})

  it('mobile: stacks bio then fields full width', () => {
    widthHolder.width = 390
    renderWithProviders(header(bioAndFields()))
    expect(screen.getByTestId('profile-detail-stack')).toBeTruthy()
    expect(screen.queryByTestId('profile-detail-split')).toBeNull()
    expect(screen.getByTestId('profile-bio-card')).toBeTruthy()
    expect(screen.getByTestId('profile-fields')).toBeTruthy()
  })

  it('desktop: splits bio and fields into halves', () => {
    widthHolder.width = 1280
    renderWithProviders(header(bioAndFields()))
    expect(screen.getByTestId('profile-detail-split')).toBeTruthy()
    expect(screen.queryByTestId('profile-detail-stack')).toBeNull()
    expect(screen.getByTestId('profile-bio-card')).toBeTruthy()
    expect(screen.getByTestId('profile-fields')).toBeTruthy()
  })

  it('desktop with bio only: centers a half-width bio card', () => {
    widthHolder.width = 1280
    renderWithProviders(header(account({bio: {plain: 'hello there'}})))
    expect(screen.getByTestId('profile-detail-center-bio')).toBeTruthy()
    expect(screen.getByTestId('profile-bio-card')).toBeTruthy()
    expect(screen.queryByTestId('profile-fields')).toBeNull()
  })

  it('desktop with fields only: centers the field list', () => {
    widthHolder.width = 1280
    renderWithProviders(header(account({bio: {plain: ''}, fields: [siteField]})))
    expect(screen.getByTestId('profile-detail-center-fields')).toBeTruthy()
    expect(screen.queryByTestId('profile-bio-card')).toBeNull()
    expect(screen.getByTestId('profile-fields')).toBeTruthy()
  })

  it('renders no card views when bio and fields are both absent', () => {
    widthHolder.width = 1280
    renderWithProviders(header(account({bio: {plain: ''}})))
    expect(screen.queryByTestId('profile-detail-split')).toBeNull()
    expect(screen.queryByTestId('profile-detail-stack')).toBeNull()
    expect(screen.queryByTestId('profile-detail-center-bio')).toBeNull()
    expect(screen.queryByTestId('profile-detail-center-fields')).toBeNull()
    expect(screen.queryByTestId('profile-bio-card')).toBeNull()
    expect(screen.queryByTestId('profile-fields')).toBeNull()
  })
})
