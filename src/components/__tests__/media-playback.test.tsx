// R2.3: off-screen video never plays. The feed grid runs at most its
// first visible gifv tile; the Lightbox runs only the focused frame —
// never N simultaneous audio tracks on open.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {useState} from 'react'
import {Dimensions} from 'react-native'
import type {Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {Lightbox} from '#/components/Lightbox'
import {PostMediaGrid} from '#/components/Post/PostMediaGrid'

const mockPlayersByUrl = new Map<
  string,
  {url: string; loop: boolean; muted: boolean; play: jest.Mock; pause: jest.Mock}
>()

jest.mock('expo-video', () => {
  return {
    // Production-faithful: the real `useVideoPlayer` returns a STABLE
    // player per source across re-renders, so the mock caches by URL —
    // a fresh object per render would fake remounts and stale-player
    // assertions.
    useVideoPlayer: jest.fn((url: string, init?: (p: Record<string, unknown>) => void) => {
      let player = mockPlayersByUrl.get(url)
      if (!player) {
        player = {url, loop: false, muted: false, play: jest.fn(), pause: jest.fn()}
        mockPlayersByUrl.set(url, player)
      }
      init?.(player)
      return player
    }),
    VideoView: (props: {testID?: string}) => {
      const {View} = require('react-native')
      return <View testID={props.testID} />
    },
  }
})

const {useVideoPlayer} = require('expo-video') as {useVideoPlayer: jest.Mock}

i18n.load('en', {})
i18n.activate('en')

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function videoMedia(id: string, kind: 'gifv' | 'video' = 'gifv'): Media {
  return {
    id,
    kind,
    mimeType: 'video/mp4',
    url: `https://cdn.example/${id}.mp4`,
    previewUrl: null,
    name: `${id}.mp4`,
    description: null,
    blurhash: null,
    isSensitive: false,
    size: 10,
    md5: null,
    meta: null,
    createdAt: null,
    folderId: null,
    userId: null,
  } as Media
}

function players() {
  return (useVideoPlayer as jest.Mock).mock.results.map(r => r.value as {play: jest.Mock; pause: jest.Mock})
}

beforeEach(() => {
  ;(useVideoPlayer as jest.Mock).mockClear()
  mockPlayersByUrl.clear()
})

describe('PostMediaGrid gifv gating', () => {
  it('plays the first strip tile and pauses the rest', () => {
    renderWithProviders(<PostMediaGrid media={[videoMedia('v1'), videoMedia('v2')]} />)
    const [first, second] = players()
    expect(first.play).toHaveBeenCalled()
    expect(second.play).not.toHaveBeenCalled()
    expect(second.pause).toHaveBeenCalled()
  })

  it('a lone gifv still autoplays', () => {
    renderWithProviders(<PostMediaGrid media={[videoMedia('v1')]} />)
    expect(players()).toHaveLength(1)
    expect(players()[0].play).toHaveBeenCalled()
  })
})

describe('Lightbox focused-frame playback', () => {
  function Harness({media}: {media: Media[]}) {
    const [index, setIndex] = useState(0)
    return <Lightbox media={media} index={index} onIndexChange={setIndex} onClose={() => {}} testID="lb" />
  }

  it('runs only the focused frame, switching on pager scroll', () => {
    const media = [videoMedia('v1', 'video'), videoMedia('v2', 'video')]
    renderWithProviders(<Harness media={media} />)
    let [first, second] = players()
    expect(first.play).toHaveBeenCalled()
    expect(second.play).not.toHaveBeenCalled()
    expect(second.pause).toHaveBeenCalled()

    const {width} = Dimensions.get('window')
    fireEvent(screen.getByTestId('lb-pager'), 'onMomentumScrollEnd', {
      nativeEvent: {contentOffset: {x: width}},
    })
    ;[first, second] = players()
    expect(first.pause).toHaveBeenCalled()
    expect(second.play).toHaveBeenCalled()
  })
})
