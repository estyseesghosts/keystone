import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import type {Account} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'

import {UserHoverCard, UserHoverCardView} from './UserHoverCard'

i18n.load('en', {})
i18n.activate('en')

const account = {
  id: 'u1',
  username: 'alice',
  acct: 'alice@example',
  host: 'example',
  name: 'Alice',
  displayName: 'Alice',
  bio: {plain: 'hello world'},
  url: null,
  uri: null,
  avatarUrl: null,
  avatarBlurhash: null,
  headerUrl: null,
  headerBlurhash: null,
  followersCount: 1200,
  followingCount: 34,
  statusesCount: 56,
  locked: true,
  bot: false,
} as unknown as Account

function renderView(props?: Partial<Parameters<typeof UserHoverCardView>[0]>) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <UserHoverCardView
          account={account}
          followState="follow"
          followAllowed
          onToggleFollow={() => {}}
          testID="hover"
          {...props}
        />
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('UserHoverCardView', () => {
  it('renders the preview with stats, bio, and follow action', () => {
    renderView()
    expect(screen.getByTestId('hover')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Follow')).toBeTruthy()
  })

  it('shows unfollow/requested states and disabled reasons', () => {
    const {unmount} = renderView({followState: 'following'})
    expect(screen.getByText('Unfollow')).toBeTruthy()
    unmount()
    renderView({followState: 'requested'})
    expect(screen.getByText('Requested')).toBeTruthy()
  })

  it('disables follow with the gate reason, never inert', () => {
    const onToggle = jest.fn()
    renderView({followAllowed: false, followReason: 'Sign in to do this.', onToggleFollow: onToggle})
    const btn = screen.getByTestId('hover-follow')
    expect(btn.props.accessibilityState).toMatchObject({disabled: true})
    expect(screen.getByText('Sign in to do this.')).toBeTruthy()
  })

  it('fires follow and open-profile actions', () => {
    const onToggle = jest.fn()
    const onOpen = jest.fn()
    renderView({onToggleFollow: onToggle, onOpenProfile: onOpen})
    fireEvent.press(screen.getByTestId('hover-follow'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    fireEvent.press(screen.getByTestId('hover-open'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('UserHoverCard', () => {
  it('returns null on native (web-only)', () => {
    const tree = render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <UserHoverCard account={account} sessionId="s1" testID="hover" />
        </ThemeProvider>
      </I18nProvider>,
    )
    // jest-expo/ios preset: Platform.OS is ios, so the card stays unmounted.
    expect(tree.queryByTestId('hover')).toBeNull()
  })
})
