import {StyleSheet} from 'react-native'
import {render, screen} from '@testing-library/react-native'
import type {ReactElement} from 'react'

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'

import type {Backend} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {Button} from '#/components/Button'
import {PopupRow} from '#/components/Popup'
import {PostCard} from '#/components/Post/index'
import {UserHoverCardView} from '#/components/Profile/UserHoverCard'
import {makeAccount, makePost} from '#/components/__tests__/fixtures'
import {NewsTab} from '#/screens/explore/NewsTab'

// Touch-target floor (P10, 44dp): buttons and popup/menu rows meet the
// minimum even with short labels. Post action rows keep their compact
// visual and reach 44dp via hitSlop (asserted in-file by prop).

// expo-video has no Jest native module: stub the player/hook boundary
// (PostCard pulls it in via PostMediaGrid even with no media).
jest.mock('expo-video', () => {
  const React = require('react')
  const {View} = require('react-native')
  return {
    useVideoPlayer: () => ({
      play: jest.fn(),
      pause: jest.fn(),
      addListener: () => ({remove: jest.fn()}),
    }),
    VideoView: ({testID}: {testID?: string}) => <View testID={testID} />,
  }
})

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn()}),
}))

i18n.load('en', {})
i18n.activate('en')

function renderThemed(ui: ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('touch targets (P10)', () => {
  it('Button base style carries a 44dp minHeight', () => {
    const view = render(<Button label="OK" onPress={() => {}} testID="t-btn" />)
    const host = view.getByTestId('t-btn')
    const flat = StyleSheet.flatten(host.props.style) as {minHeight?: number}
    expect(flat.minHeight).toBe(44)
  })

  it('PopupRow carries a 44dp minHeight', () => {
    const view = render(<PopupRow label="Row" onPress={() => {}} testID="t-row" />)
    const host = view.getByTestId('t-row')
    const flat = StyleSheet.flatten(host.props.style) as {minHeight?: number}
    expect(flat.minHeight).toBe(44)
  })
})

describe('touch targets (P4.1 feed surfaces)', () => {
  it('hovercard follow button carries a 44dp minHeight', () => {
    renderThemed(
      <UserHoverCardView
        account={makeAccount({id: 'hover-1'})}
        sessionId="sess-hover"
        followState="follow"
        followAllowed
        onToggleFollow={() => {}}
        testID="hover"
      />,
    )
    const host = screen.getByTestId('hover-follow')
    const flat = StyleSheet.flatten(host.props.style) as {minHeight?: number}
    expect(flat.minHeight).toBe(44)
  })

  it('PostCard caption taps expose hitSlop reaching 44dp', () => {
    renderThemed(<PostCard post={makePost({id: 'cw-1', cw: 'spoiler'})} sessionId="sess-cw" />)
    const toggle = screen.getByTestId('cw-toggle-cw-1')
    // Caption text (~16px) + 16pt each side clears the 44dp floor.
    expect(toggle.props.hitSlop).toBe(16)
  })

  it('News Discussions pill exposes hitSlop reaching 44dp', async () => {
    const backend = {
      explore: {
        news: async () => ({
          items: [
            {
              url: 'https://news.example/item-1',
              title: 'Item one',
              description: null,
              providerName: null,
              image: null,
            },
          ],
          cursor: null,
          end: true,
        }),
      },
    } as unknown as Backend
    renderThemed(<NewsTab backend={backend} />)
    const pill = await screen.findByTestId('explore-news-discussions')
    expect(pill.props.hitSlop).toBe(12)
  })
})
