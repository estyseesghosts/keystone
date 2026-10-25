// Repair X7.2 step 2: the feed list drives player `active` from its
// viewability callback — only viewable rows may play, and the single
// global slot still bounds the live set.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {FlatList} from 'react-native'

import {createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostFeed} from '#/components/PostFeed/index'
import {__resetReducedMotionForTests} from '#/lib/motion'
import {
  __resetActivePlayerForTests,
  __resetAppActiveForTests,
  getActivePlayerIds,
} from '#/state/activePlayer'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {makeMedia, makePost} from './fixtures'

type MockPlayer = {
  url: string
  play: jest.Mock
  pause: jest.Mock
}
const mockPlayersByUrl = new Map<string, MockPlayer>()

jest.mock('expo-video', () => {
  return {
    useVideoPlayer: jest.fn((url: string, init?: (p: Record<string, unknown>) => void) => {
      let player = mockPlayersByUrl.get(url)
      if (!player) {
        player = {url, play: jest.fn(), pause: jest.fn()}
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

i18n.load('en', {})
i18n.activate('en')

const SESSION = 'sess-viewability-1'

function memoryStore() {
  return createSessionStore({
    storage: createMemoryStore(),
    vault: {
      getToken: async () => null,
      setToken: async () => {},
      removeToken: async () => {},
    },
    homeOrigin: 'https://example.social',
  })
}

function renderFeed(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider homeOrigin="https://example.social" store={memoryStore()}>
          {ui}
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

function gifvPost(id: string, mediaId: string) {
  return makePost({
    id,
    media: [
      makeMedia({
        id: mediaId,
        kind: 'gifv',
        mimeType: 'video/mp4',
        url: `https://cdn.example/${mediaId}.mp4`,
        name: `${mediaId}.mp4`,
      }),
    ],
  })
}

function playerFor(url: string): MockPlayer {
  const found = mockPlayersByUrl.get(url)
  if (!found) throw new Error(`no mock player for ${url}`)
  return found
}

beforeEach(() => {
  mockPlayersByUrl.clear()
  __resetActivePlayerForTests()
  __resetAppActiveForTests()
  __resetReducedMotionForTests()
})

describe('feed viewability wiring (repair X7.2 step 2)', () => {
  it('passes viewability from the list down to the gifv tiles', () => {
    const p1 = gifvPost('vp1', 'vg1')
    const p2 = gifvPost('vp2', 'vg2')
    renderFeed(<PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[p1, p2]} />)
    const list = screen.UNSAFE_getByType(FlatList)
    // The list owns viewability: static config, stable callback.
    expect(list.props.viewabilityConfig).toEqual({itemVisiblePercentThreshold: 50})
    expect(typeof list.props.onViewableItemsChanged).toBe('function')

    // Before any viewability callback, no row is active: nothing plays.
    const g1 = playerFor('https://cdn.example/vg1.mp4')
    const g2 = playerFor('https://cdn.example/vg2.mp4')
    expect(g1.play).not.toHaveBeenCalled()
    expect(g2.play).not.toHaveBeenCalled()

    // Only the reported row plays.
    fireEvent(list, 'onViewableItemsChanged', {viewableItems: [{item: p1}], changed: []})
    expect(g1.play).toHaveBeenCalled()
    expect(g2.play).not.toHaveBeenCalled()

    // Scrolling on preempts through the single global slot.
    fireEvent(list, 'onViewableItemsChanged', {viewableItems: [{item: p2}], changed: []})
    expect(g2.play).toHaveBeenCalled()
    expect(g1.pause).toHaveBeenCalled()
    expect(getActivePlayerIds()).toEqual(['gifv:vg2'])
  })
})
