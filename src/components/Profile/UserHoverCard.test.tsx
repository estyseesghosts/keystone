import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import type {Account} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'

import {UserHoverCard, UserHoverCardView} from './UserHoverCard'
import {HOVER_CARD_HEIGHT, HOVER_CARD_WIDTH, placementFor} from './HoverPreview'

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

describe('hovercard visuals (v1 parity)', () => {
  it('renders the banner image, falling back to a blank banner', () => {
    const {unmount} = renderView({
      account: {...account, headerUrl: 'https://example/banner.png'} as Account,
    })
    expect(screen.getByTestId('hover-banner')).toBeTruthy()
    unmount()
    renderView()
    expect(screen.getByTestId('hover-banner')).toBeTruthy()
  })

  it('renders bio mentions as chips', () => {
    renderView({
      account: {
        ...account,
        bio: {mfm: 'hi @bob', plain: 'hi @bob'},
      } as Account,
    })
    expect(screen.getByTestId('richtext-mention-chip')).toBeTruthy()
    expect(screen.getByText('@bob')).toBeTruthy()
  })
})

describe('placementFor (above/below + left/right)', () => {
  const viewport = {width: 1280, height: 800}
  it('sits below with room', () => {
    expect(
      placementFor({top: 100, bottom: 140, left: 100, right: 200}, viewport),
    ).toEqual({vertical: 'below', align: 'left'})
  })
  it('flips above when the bottom has no room', () => {
    expect(
      placementFor({top: 700, bottom: 740, left: 100, right: 200}, viewport),
    ).toEqual({vertical: 'above', align: 'left'})
  })
  it('prefers below on a tie, and the roomier side otherwise', () => {
    expect(
      placementFor(
        {top: 400, bottom: 400, left: 100, right: 200},
        viewport,
        {width: HOVER_CARD_WIDTH, height: 400},
      ),
    ).toEqual({vertical: 'below', align: 'left'})
    expect(
      placementFor(
        {top: 500, bottom: 540, left: 100, right: 200},
        viewport,
        {width: HOVER_CARD_WIDTH, height: 400},
      ),
    ).toEqual({vertical: 'above', align: 'left'})
  })
  it('right-aligns near the right edge', () => {
    expect(
      placementFor({top: 100, bottom: 140, left: 1100, right: 1200}, viewport),
    ).toEqual({vertical: 'below', align: 'right'})
  })
  it('exposes the card size constants', () => {
    expect(HOVER_CARD_WIDTH).toBe(320)
    expect(HOVER_CARD_HEIGHT).toBe(380)
  })
})
