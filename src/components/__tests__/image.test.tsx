// Repair X7.3 — the shared expo-image wrapper: every feed, avatar,
// banner and emoji still routes through `AppImage`, so the cache policy,
// recycling, reduce-motion transition and blurhash placeholder are
// asserted here once instead of per caller. expo-image forwards the
// testID to wrapper views (Lightbox precedent), so prop assertions pick
// the sourced match.
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {useState} from 'react'
import {AccessibilityInfo, Text} from 'react-native'

import {APP_IMAGE_TRANSITION_MS, AppImage} from '#/components/Image'
import {__resetReducedMotionForTests} from '#/lib/motion'

/** expo-image element for a wrapper instance: the outer composite keeps
 * the original props (source/placeholder/cachePolicy as passed). */
function appImg(testID: string): any {
  const all = screen.UNSAFE_queryAllByProps({testID} as never) as unknown as Array<any>
  const found = all.find(el => el.props?.source !== undefined || el.props?.style !== undefined)
  if (!found) throw new Error(`no image element for ${testID} (${all.length} matches)`)
  return found
}

beforeEach(() => {
  __resetReducedMotionForTests()
})

describe('AppImage wrapper', () => {
  it('passes the uri through as the source', () => {
    render(<AppImage uri="https://cdn.example/i.png" testID="im" />)
    expect(appImg('im').props.source).toEqual({uri: 'https://cdn.example/i.png'})
  })

  it('pins the memory-disk cache policy and the recycling key', () => {
    render(<AppImage uri="https://cdn.example/i.png" recyclingKey="m1" testID="im" />)
    expect(appImg('im').props.cachePolicy).toBe('memory-disk')
    expect(appImg('im').props.recyclingKey).toBe('m1')
  })

  it('renders the blurhash placeholder without fetching (sensitive cover)', () => {
    render(<AppImage uri={null} blurhash="LEHV6nWB2yk8pyo0adR*.7kCMdnj" testID="im" />)
    const img = appImg('im')
    expect(img.props.source).toBeNull()
    expect(img.props.placeholder).toEqual({blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'})
  })

  it('leaves the placeholder unset without a blurhash', () => {
    render(<AppImage uri="https://cdn.example/i.png" testID="im" />)
    expect(appImg('im').props.placeholder).toBeUndefined()
  })

  it('covers by default and honours an explicit fit', () => {
    render(<AppImage uri="https://cdn.example/i.png" testID="cover" />)
    expect(appImg('cover').props.contentFit).toBe('cover')
    render(<AppImage uri="https://cdn.example/i.png" contentFit="contain" testID="contain" />)
    expect(appImg('contain').props.contentFit).toBe('contain')
  })

  it('cross-fades on settle under full motion', () => {
    render(<AppImage uri="https://cdn.example/i.png" testID="im" />)
    expect(appImg('im').props.transition).toBe(APP_IMAGE_TRANSITION_MS)
  })

  it('skips the transition under reduce-motion', async () => {
    const ai = AccessibilityInfo as unknown as Record<string, jest.Mock | undefined>
    const savedIs = ai.isReduceMotionEnabled
    const savedAdd = ai.addEventListener
    ai.isReduceMotionEnabled = jest.fn().mockResolvedValue(true)
    ai.addEventListener = jest.fn().mockReturnValue({remove: jest.fn()})
    try {
      render(<AppImage uri="https://cdn.example/i.png" testID="im" />)
      await waitFor(() => {
        expect(appImg('im').props.transition).toBe(0)
      })
    } finally {
      ai.isReduceMotionEnabled = savedIs
      ai.addEventListener = savedAdd
    }
  })

  it('forwards error and load handlers to the caller', () => {
    function Harness() {
      const [failed, setFailed] = useState(false)
      if (failed) return <Text testID="fallback">failed</Text>
      return <AppImage uri="https://cdn.example/i.png" onError={() => setFailed(true)} testID="im" />
    }
    render(<Harness />)
    fireEvent(appImg('im'), 'onError')
    expect(screen.getByTestId('fallback')).toBeTruthy()
  })
})
