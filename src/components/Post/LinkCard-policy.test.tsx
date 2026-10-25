// X2.4 component policy: a post linking a non-public URL triggers no
// network from either site (no mount warm, no unfurl fetch, no Preview
// trigger), while public URLs keep the tap-to-unfurl trigger.
import {fireEvent, render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'
import type {ReactNode} from 'react'

import {clearPreviewCache, type LinkPreview} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {makePost} from '#/components/__tests__/fixtures'
import {PostCard} from '#/components/Post/index'
import {UnfurledLinkCard} from '#/components/Post/LinkCard'

// expo-video has no Jest native module: stub the player/hook boundary
// (PostCard pulls it in via PostMediaGrid/Lightbox).
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

i18n.load('en', {})
i18n.activate('en')

function renderCard(ui: ReactNode) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

const PREVIEW: LinkPreview = {
  title: 'Unfurled title',
  description: 'Unfurled description',
  siteName: 'Example',
  image: 'https://example.com/cover.png',
  icon: null,
}

describe('UnfurledLinkCard outbound policy (X2.4)', () => {
  beforeEach(() => {
    clearPreviewCache()
  })

  it.each(['http://192.168.1.1/x', 'https://10.0.0.5/p', 'http://example.com/article'])(
    'renders the basic card with no Preview trigger for %s',
    url => {
      const fetchPreview = jest.fn(async (_url: string) => PREVIEW)
      renderCard(<UnfurledLinkCard url={url} fetchPreview={fetchPreview} testID="uf" />)
      expect(screen.getByTestId('uf')).toBeTruthy()
      expect(screen.queryByTestId('uf-preview')).toBeNull()
      expect(fetchPreview).not.toHaveBeenCalled()
    },
  )

  it('keeps the tap-to-unfurl trigger for a public https URL', () => {
    const fetchPreview = jest.fn(async (_url: string) => PREVIEW)
    renderCard(
      <UnfurledLinkCard url="https://example.com/ok" fetchPreview={fetchPreview} testID="uf" />,
    )
    expect(screen.getByTestId('uf-preview')).toBeTruthy()
    fireEvent.press(screen.getByTestId('uf-preview'))
    expect(fetchPreview).toHaveBeenCalledTimes(1)
  })
})

describe('PostCard network silence on mount (X2.4)', () => {
  const SESSION = 'sess-x24'
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('a rendered federated row makes no request before the menu opens', () => {
    const fetchMock = jest.fn(async (): Promise<Response> => {
      throw new Error('must not fetch: resolve lazily on menu open')
    })
    globalThis.fetch = fetchMock as never
    renderCard(
      <PostCard
        post={makePost({
          id: 'x24-1',
          uri: 'https://remote.example/notes/x24-1',
          url: 'https://remote.example/notes/x24-1',
          content: {mfm: 'no links here', plain: 'no links here'},
        })}
        sessionId={SESSION}
        linkPreviewAuto={false}
      />,
    )
    expect(screen.getByTestId('post-x24-1')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a post linking a LAN URL shows the unfurl row with no trigger and no fetch', () => {
    const fetchMock = jest.fn(async (): Promise<Response> => {
      throw new Error('must not fetch a LAN URL')
    })
    globalThis.fetch = fetchMock as never
    renderCard(
      <PostCard
        post={makePost({
          id: 'x24-2',
          uri: 'https://remote.example/notes/x24-2',
          url: 'https://remote.example/notes/x24-2',
          content: {mfm: 'see http://192.168.1.1/x ok', plain: 'see http://192.168.1.1/x ok'},
        })}
        sessionId={SESSION}
      />,
    )
    expect(screen.getByTestId('post-unfurl-x24-2')).toBeTruthy()
    expect(screen.queryByTestId('post-unfurl-x24-2-preview')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
