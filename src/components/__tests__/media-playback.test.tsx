// R2.3 + repair X7.2 (media M5): off-screen video never plays. The feed
// grid runs at most its first visible gifv tile; the Lightbox runs only
// the focused frame — never N simultaneous audio tracks on open. X7.2
// adds the global one-at-a-time store, viewability-driven `active`,
// pause on scroll-off/blur/background/unmount, autoplay policy
// (reduce-motion + data-saver show a play affordance), and a real
// icon + label audio toggle (never unicode glyphs).

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {useState} from 'react'
import {AccessibilityInfo, AppState, Dimensions, StyleSheet} from 'react-native'
import type {Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {Lightbox} from '#/components/Lightbox'
import {PostMediaGrid} from '#/components/Post/PostMediaGrid'
import {__resetReducedMotionForTests} from '#/lib/motion'
import {
  __resetActivePlayerForTests,
  __resetAppActiveForTests,
  getActivePlayerIds,
  setMaxActivePlayers,
} from '#/state/activePlayer'
import {appearanceStore} from '#/state/appearance'

type MockPlayer = {
  url: string
  loop: boolean
  muted: boolean
  play: jest.Mock
  pause: jest.Mock
  addListener: jest.Mock
}
const mockPlayersByUrl = new Map<string, MockPlayer>()

jest.mock('expo-video', () => {
  return {
    // Production-faithful: the real `useVideoPlayer` returns a STABLE
    // player per source across re-renders, so the mock caches by URL —
    // a fresh object per render would fake remounts and stale-player
    // assertions. play/pause fan out to `playingChange` listeners like the
    // real player, so tiles that track playing state behave.
    useVideoPlayer: jest.fn((url: string, init?: (p: Record<string, unknown>) => void) => {
      let player = mockPlayersByUrl.get(url)
      if (!player) {
        const listeners = new Set<(mockEv: {isPlaying: boolean}) => void>()
        player = {
          url,
          loop: false,
          muted: false,
          play: jest.fn(() => {
            for (const cb of [...listeners]) cb({isPlaying: true})
          }),
          pause: jest.fn(() => {
            for (const cb of [...listeners]) cb({isPlaying: false})
          }),
          addListener: jest.fn((_event: string, cb: (mockEv: {isPlaying: boolean}) => void) => {
            listeners.add(cb)
            return {
              remove: jest.fn(() => {
                listeners.delete(cb)
              }),
            }
          }),
        }
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

function audioMedia(id: string): Media {
  return {
    id,
    kind: 'audio',
    mimeType: 'audio/mpeg',
    url: `https://cdn.example/${id}.mp3`,
    previewUrl: null,
    name: `${id}.mp3`,
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
  return (useVideoPlayer as jest.Mock).mock.results.map(r => r.value as MockPlayer)
}

/** Unique players by URL: re-renders re-invoke the cached mock (one entry
 * per render), so raw call counts overcount tiles. */
function uniquePlayers(): MockPlayer[] {
  const seen = new Map<string, MockPlayer>()
  for (const p of players()) {
    if (p && !seen.has(p.url)) seen.set(p.url, p)
  }
  return [...seen.values()]
}

function playerFor(url: string): MockPlayer {
  const found = mockPlayersByUrl.get(url)
  if (!found) throw new Error(`no mock player for ${url}`)
  return found
}

function mockAccessibilityInfo(is: boolean | undefined, handler?: (value: boolean) => void) {
  const ai = AccessibilityInfo as unknown as Record<string, jest.Mock | undefined>
  const savedIs = ai.isReduceMotionEnabled
  const savedAdd = ai.addEventListener
  ai.isReduceMotionEnabled = jest.fn().mockResolvedValue(is ?? false)
  ai.addEventListener = jest.fn().mockImplementation((_event: string, cb: (v: boolean) => void) => {
    void cb
    handler?.(is ?? false)
    return {remove: jest.fn()}
  })
  return () => {
    ai.isReduceMotionEnabled = savedIs
    ai.addEventListener = savedAdd
    __resetReducedMotionForTests()
  }
}

beforeEach(() => {
  ;(useVideoPlayer as jest.Mock).mockClear()
  mockPlayersByUrl.clear()
  __resetActivePlayerForTests()
  __resetAppActiveForTests()
  __resetReducedMotionForTests()
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
    expect(uniquePlayers()).toHaveLength(1)
    expect(uniquePlayers()[0].play).toHaveBeenCalled()
  })
})

describe('viewability-driven active (repair X7.2 step 2)', () => {
  it('an inactive grid never plays', () => {
    renderWithProviders(<PostMediaGrid media={[videoMedia('g-off')]} active={false} />)
    const [only] = players()
    expect(only.play).not.toHaveBeenCalled()
    expect(only.pause).toHaveBeenCalled()
  })

  it('scrolling a row off releases its slot; scrolling back re-claims it', () => {
    const {rerender} = renderWithProviders(<PostMediaGrid media={[videoMedia('g-scroll')]} />)
    expect(playerFor('https://cdn.example/g-scroll.mp4').play).toHaveBeenCalled()
    rerender(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <PostMediaGrid media={[videoMedia('g-scroll')]} active={false} />
        </ThemeProvider>
      </I18nProvider>,
    )
    expect(getActivePlayerIds()).toEqual([])
    rerender(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <PostMediaGrid media={[videoMedia('g-scroll')]} />
        </ThemeProvider>
      </I18nProvider>,
    )
    expect(getActivePlayerIds()).toEqual(['gifv:g-scroll'])
  })

  it('unmount releases the slot and stops the player', () => {
    const rendered = renderWithProviders(<PostMediaGrid media={[videoMedia('g-gone')]} />)
    expect(getActivePlayerIds()).toEqual(['gifv:g-gone'])
    rendered.unmount()
    expect(getActivePlayerIds()).toEqual([])
    expect(playerFor('https://cdn.example/g-gone.mp4').pause).toHaveBeenCalled()
  })

  it('N visible gifv posts decode at most the configured maximum (default 1)', () => {
    renderWithProviders(
      <>
        <PostMediaGrid media={[videoMedia('n1')]} />
        <PostMediaGrid media={[videoMedia('n2')]} />
        <PostMediaGrid media={[videoMedia('n3')]} />
      </>,
    )
    // The slot bounds the live set (mount order wins last-write); every
    // tile pauses on mount before its claim resolves, so call counts alone
    // cannot name the winner — the claimed id plus its play call can.
    const ids = getActivePlayerIds()
    expect(ids).toHaveLength(1)
    const winnerId = ids[0].replace(/^gifv:/, '')
    expect(playerFor(`https://cdn.example/${winnerId}.mp4`).play).toHaveBeenCalled()
  })

  it('raising the ceiling lets two visible posts play at once', () => {
    setMaxActivePlayers(2)
    renderWithProviders(
      <>
        <PostMediaGrid media={[videoMedia('c1')]} />
        <PostMediaGrid media={[videoMedia('c2')]} />
      </>,
    )
    expect(getActivePlayerIds()).toHaveLength(2)
  })

  it('pauses on backgrounded AppState and resumes on foreground', async () => {
    const handlers: Array<(state: string) => void> = []
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((( _type: string, cb: (state: string) => void) => {
        handlers.push(cb)
        return {remove: jest.fn()}
      }) as never)
    try {
      renderWithProviders(<PostMediaGrid media={[videoMedia('g-bg')]} />)
      const only = playerFor('https://cdn.example/g-bg.mp4')
      await waitFor(() => {
        expect(only.play).toHaveBeenCalled()
      })
      const fire = (state: string) => {
        act(() => {
          for (const handler of handlers) handler(state)
        })
      }
      fire('background')
      expect(only.pause).toHaveBeenCalled()
      expect(getActivePlayerIds()).toEqual([])
      fire('active')
      expect(only.play).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('autoplay policy (repair X7.2 step 3)', () => {
  it('reduce-motion suppresses autoplay and shows a play affordance', async () => {
    const restore = mockAccessibilityInfo(true)
    try {
      renderWithProviders(<PostMediaGrid media={[videoMedia('g-rm')]} />)
      await waitFor(() => {
        expect(screen.getByTestId('media-gifv-play-g-rm')).toBeTruthy()
      })
      const only = playerFor('https://cdn.example/g-rm.mp4')
      // The OS setting resolves async (motion.ts defaults to full motion on
      // the first frame, then corrects): the tile may flash one play before
      // the affordance lands, but it must end paused with the affordance up.
      expect(only.pause).toHaveBeenCalled()
      expect(getActivePlayerIds()).toEqual([])
      only.play.mockClear()
      fireEvent.press(screen.getByTestId('media-gifv-play-g-rm'))
      await waitFor(() => {
        expect(only.play).toHaveBeenCalled()
      })
    } finally {
      restore()
    }
  })

  it('data-saver suppresses autoplay and shows a play affordance', async () => {
    const spy = jest.spyOn(appearanceStore, 'getDataSaver').mockReturnValue(true)
    try {
      renderWithProviders(<PostMediaGrid media={[videoMedia('g-ds')]} />)
      await waitFor(() => {
        expect(screen.getByTestId('media-gifv-play-g-ds')).toBeTruthy()
      })
      expect(playerFor('https://cdn.example/g-ds.mp4').play).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('audio player (repair X7.2 step 4)', () => {
  it('shows a real icon + label (never unicode glyphs) on a 44pt target', () => {
    renderWithProviders(<PostMediaGrid media={[audioMedia('a1')]} />)
    const toggle = screen.getByTestId('media-audio-toggle-a1')
    const flat = StyleSheet.flatten(toggle.props.style) as {minWidth?: number; minHeight?: number}
    expect(flat.minWidth).toBe(44)
    expect(flat.minHeight).toBe(44)
    expect(toggle.props.hitSlop).toBe(12)
    expect(screen.getByText('Play')).toBeTruthy()
    expect(screen.getByTestId('media-audio-icon-a1')).toBeTruthy()
    expect(screen.queryByText(/▶|⏸/)).toBeNull()
  })

  it('starting audio preempts a playing gifv (one global player)', () => {
    renderWithProviders(
      <>
        <PostMediaGrid media={[videoMedia('g-pre')]} />
        <PostMediaGrid media={[audioMedia('a-pre')]} />
      </>,
    )
    const gifv = playerFor('https://cdn.example/g-pre.mp4')
    const audio = playerFor('https://cdn.example/a-pre.mp3')
    expect(gifv.play).toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('media-audio-toggle-a-pre'))
    expect(audio.play).toHaveBeenCalled()
    expect(screen.getByText('Pause')).toBeTruthy()
    expect(gifv.pause).toHaveBeenCalled()
    expect(getActivePlayerIds()).toEqual(['audio:a-pre'])
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
