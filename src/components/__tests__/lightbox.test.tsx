// Repair X7.1 — Lightbox rewrite tests. Every numbered behavior ships a
// test that fails before the fix (no offset/scroll sync, all frames
// mounted, no paging keys, no zoom/dismiss, no sensitive cover, literal
// Close, full-url first paint) and passes after. Device gestures are
// `not verified (device)` (owner checklist X12.1).

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {act, fireEvent, render, screen} from '@testing-library/react-native'
import {useState} from 'react'
import {Platform} from 'react-native'
import type {ScrollViewProps} from 'react-native'
import type {Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {
  Lightbox,
  clampIndex,
  clampPan,
  clampZoom,
  frameIndexForOffset,
  frameLayout,
  frameOffset,
  isDismissSwipe,
  isTextEntryTarget,
  panBounds,
  pinchScale,
  touchDistance,
  touchPoints,
  windowFor,
} from '#/components/Lightbox'

i18n.load('en', {})
i18n.activate('en')

const mockPlayersByUrl = new Map<
  string,
  {url: string; loop: boolean; muted: boolean; play: jest.Mock; pause: jest.Mock}
>()

jest.mock('expo-video', () => {
  return {
    // Production-faithful: the real `useVideoPlayer` returns a STABLE
    // player per source across re-renders, so the mock caches by URL.
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
      const {View} = jest.requireActual('react-native') as typeof import('react-native')
      return <View testID={props.testID} />
    },
  }
})

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as typeof import('react-native')
  const React = require('react') as typeof import('react')
  const MockScrollView = React.forwardRef<
    {scrollTo: (opts: {x?: number; y?: number; animated?: boolean}) => void},
    ScrollViewProps
  >((props, ref) => {
    const {children, ...rest} = props
    React.useImperativeHandle(ref, () => ({
      scrollTo: (opts: {x?: number; y?: number; animated?: boolean}) => {
        const stash = globalThis as unknown as {__lbScrollTo?: Array<unknown>}
        ;(stash.__lbScrollTo ??= []).push(opts)
      },
    }))
    const {View} = actual
    return <View {...rest}>{children}</View>
  })
  MockScrollView.displayName = 'MockScrollView'
  // Plain (non-reactive) dims read: the rotation test forces a re-render
  // with a fresh media array reference after `setDims`, so the viewer picks
  // up the new width. (A `useSyncExternalStore` mock cannot live inside the
  // `jest.mock` factory — babel's hoisting check rejects the subscribe
  // closure — and a `use*`-named outer helper cannot be referenced from the
  // factory either.)
  const mockDims = () => {
    const stash = globalThis as unknown as {
      __lbDims?: {width: number; height: number; scale: number; fontScale: number}
    }
    return stash.__lbDims ?? {width: 400, height: 800, scale: 2, fontScale: 1}
  }
  // Lazy proxy, NOT `{...actual}`: eagerly spreading the module evaluates
  // every deprecated TurboModule getter (DevMenu et al.) and throws under
  // jest. Property access stays lazy so only touched members resolve.
  return new Proxy(actual, {
    get(t, p, r) {
      if (p === 'ScrollView') return MockScrollView
      if (p === 'useWindowDimensions') return mockDims
      return Reflect.get(t, p, r)
    },
  })
})

const {useVideoPlayer} = jest.requireMock('expo-video') as {useVideoPlayer: jest.Mock}

type Stash = {
  __lbScrollTo?: Array<{x?: number; y?: number; animated?: boolean}>
  __lbDims?: {width: number; height: number; scale: number; fontScale: number}
  document?: unknown
}

function stash(): Stash {
  return globalThis as unknown as Stash
}

function scrollCalls(): Array<{x?: number; y?: number; animated?: boolean}> {
  return stash().__lbScrollTo ?? []
}

function setDims(width: number, height = 800) {
  stash().__lbDims = {width, height, scale: 2, fontScale: 1}
}

/** Inner expo-image element for a frame: expo-image forwards the testID and
 * accessibilityLabel to its outer wrapper Views (which carry no
 * `source`/`style`), so prop assertions must pick the match that owns them. */
function imageImg(frameId: string): any {
  const all = screen.UNSAFE_queryAllByProps({testID: `lb-frame-${frameId}-img`} as never) as unknown as Array<any>
  const found = all.find(el => el.props?.source !== undefined || el.props?.style !== undefined)
  if (!found) throw new Error(`no sourced image element for frame ${frameId} (${all.length} matches)`)
  return found
}

const realOS = Platform.OS

function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true})
}

type KeyListener = (e: {
  key: string
  shiftKey?: boolean
  preventDefault: () => void
  stopPropagation: () => void
  target: {tagName: string; isContentEditable?: boolean}
}) => void
const keyListeners = new Set<KeyListener>()

function installDocument() {
  const focus = jest.fn()
  stash().document = {
    activeElement: {focus},
    addEventListener: (_t: string, fn: KeyListener) => {
      keyListeners.add(fn)
    },
    removeEventListener: (_t: string, fn: KeyListener) => {
      keyListeners.delete(fn)
    },
  }
  return focus
}

function pressKey(keyName: string, tagName = 'DIV') {
  act(() => {
    for (const fn of [...keyListeners]) {
      fn({key: keyName, preventDefault: jest.fn(), stopPropagation: jest.fn(), target: {tagName}})
    }
  })
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function imageMedia(id: string, over: Partial<Media> = {}): Media {
  return {
    id,
    kind: 'image',
    mimeType: 'image/png',
    url: `https://cdn.example/${id}.png`,
    previewUrl: `https://cdn.example/${id}-thumb.png`,
    name: `${id}.png`,
    description: `Alt ${id}`,
    blurhash: null,
    isSensitive: false,
    size: 10,
    md5: null,
    meta: null,
    createdAt: null,
    folderId: null,
    userId: null,
    ...over,
  } as Media
}

function videoMedia(id: string): Media {
  return {
    id,
    kind: 'video',
    mimeType: 'video/mp4',
    url: `https://cdn.example/${id}.mp4`,
    previewUrl: null,
    name: `${id}.mp4`,
    description: `Alt ${id}`,
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

function Harness({
  media,
  initialIndex = 0,
  onClose = () => {},
}: {
  media: Media[]
  initialIndex?: number
  onClose?: () => void
}) {
  const [index, setIndex] = useState(initialIndex)
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <Lightbox
      media={media}
      index={index}
      onIndexChange={setIndex}
      onClose={() => {
        onClose()
        setOpen(false)
      }}
      testID="lb"
    />
  )
}

beforeEach(() => {
  setDims(400)
  stash().__lbScrollTo = []
  ;(useVideoPlayer as jest.Mock).mockClear()
  mockPlayersByUrl.clear()
  keyListeners.clear()
  setOS('ios')
  delete stash().document
})

afterEach(() => {
  setOS(realOS)
  delete stash().document
})

describe('pure pager math', () => {
  it('frameOffset scales the clamped index by width', () => {
    expect(frameOffset(2, 400)).toBe(800)
    expect(frameOffset(0, 400)).toBe(0)
    expect(frameOffset(-3, 400)).toBe(0)
  })

  it('frameIndexForOffset rounds to the nearest frame and clamps', () => {
    expect(frameIndexForOffset(810, 400, 4)).toBe(2)
    expect(frameIndexForOffset(599, 400, 4)).toBe(1)
    expect(frameIndexForOffset(5000, 400, 4)).toBe(3)
    expect(frameIndexForOffset(-50, 400, 4)).toBe(0)
    expect(frameIndexForOffset(100, 0, 4)).toBe(0)
  })

  it('clampIndex floors and bounds', () => {
    expect(clampIndex(1.9, 4)).toBe(1)
    expect(clampIndex(9, 4)).toBe(3)
    expect(clampIndex(-1, 4)).toBe(0)
    expect(clampIndex(Number.NaN, 4)).toBe(0)
    expect(clampIndex(0, 0)).toBe(0)
  })

  it('windowFor keeps active ±1 (windowSize 3)', () => {
    expect(windowFor(2, 5)).toEqual({lo: 1, hi: 3})
    expect(windowFor(0, 5)).toEqual({lo: 0, hi: 1})
    expect(windowFor(4, 5)).toEqual({lo: 3, hi: 4})
    expect(windowFor(0, 1)).toEqual({lo: 0, hi: 0})
    expect(windowFor(0, 0)).toEqual({lo: 0, hi: 0})
  })

  it('frameLayout matches the getItemLayout shape', () => {
    expect(frameLayout(400, 2)).toEqual({length: 400, offset: 800, index: 2})
  })

  it('zoom and pan clamp', () => {
    expect(clampZoom(0.5)).toBe(1)
    expect(clampZoom(9)).toBe(3)
    expect(clampZoom(2)).toBe(2)
    expect(panBounds(2, 400, 800)).toEqual({x: 200, y: 400})
    expect(panBounds(1, 400, 800)).toEqual({x: 0, y: 0})
    expect(clampPan(500, 200)).toBe(200)
    expect(clampPan(-500, 200)).toBe(-200)
    expect(clampPan(50, 200)).toBe(50)
  })

  it('isDismissSwipe needs dominant downward travel', () => {
    expect(isDismissSwipe(10, 150)).toBe(true)
    expect(isDismissSwipe(0, 120)).toBe(true)
    expect(isDismissSwipe(10, 119)).toBe(false)
    expect(isDismissSwipe(200, 150)).toBe(false)
    expect(isDismissSwipe(0, -150)).toBe(false)
  })

  it('isTextEntryTarget spots inputs and editables', () => {
    expect(isTextEntryTarget({tagName: 'INPUT'})).toBe(true)
    expect(isTextEntryTarget({tagName: 'TEXTAREA'})).toBe(true)
    expect(isTextEntryTarget({tagName: 'DIV', isContentEditable: true})).toBe(true)
    expect(isTextEntryTarget({tagName: 'DIV'})).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })

  it('pinch math spreads relative to gesture start', () => {
    expect(touchDistance({x: 100, y: 100}, {x: 200, y: 100})).toBe(100)
    expect(pinchScale(100, 200, 1)).toBe(2)
    expect(pinchScale(100, 50, 2)).toBe(1)
    expect(pinchScale(100, 1000, 1)).toBe(3)
    expect(pinchScale(0, 200, 1)).toBe(1)
    expect(touchPoints({})).toEqual([])
    expect(touchPoints(null)).toEqual([])
    expect(
      touchPoints({touches: [{pageX: 10, pageY: 20}, {pageX: 'x', pageY: 20}]}),
    ).toEqual([{x: 10, y: 20}])
  })
})

describe('open at the tapped index (M1), re-sync on change (M2)', () => {
  it('mounts with the initial offset for index=2', () => {
    const media = [imageMedia('m0'), imageMedia('m1'), imageMedia('m2'), imageMedia('m3')]
    renderWithProviders(<Harness media={media} initialIndex={2} />)
    expect(screen.getByTestId('lb-pager').props.contentOffset).toEqual({x: 800, y: 0})
    expect(screen.getByText('3 / 4')).toBeTruthy()
    // The caption names frame 3 while the other frames stay mounted or not
    // per the window — the visible offset is what the pager shows.
    expect(screen.getByTestId('lightbox-caption')).toBeTruthy()
  })

  it('scrolls on index change and on width change', () => {
    const media = [imageMedia('m0'), imageMedia('m1'), imageMedia('m2')]
    const {rerender} = renderWithProviders(<Harness media={media} initialIndex={0} />)
    expect(scrollCalls()).toHaveLength(0)
    fireEvent(screen.getByTestId('lb-pager'), 'onMomentumScrollEnd', {
      nativeEvent: {contentOffset: {x: 800}},
    })
    expect(screen.getByText('3 / 3')).toBeTruthy()
    expect(scrollCalls()).toEqual([{x: 800, y: 0, animated: false}])
    // Rotation / window resize re-syncs the same frame at the new width: a
    // fresh media array reference forces the viewer to re-render (and re-read
    // the mock dims) without remounting, so the [safe, width] effect fires.
    setDims(200)
    rerender(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <Harness media={[...media]} initialIndex={0} />
        </ThemeProvider>
      </I18nProvider>,
    )
    // The harness keeps its own index state (now 2); only the width changed.
    expect(scrollCalls()).toEqual([
      {x: 800, y: 0, animated: false},
      {x: 400, y: 0, animated: false},
    ])
  })

  it('renders nothing without media', () => {
    const {toJSON} = renderWithProviders(<Lightbox media={[]} index={0} onClose={() => {}} />)
    expect(toJSON()).toBeNull()
  })
})

describe('windowed frames (M4)', () => {
  it('mounts only active ±1 frames', () => {
    const media = [
      imageMedia('m0', {description: 'Frame zero'}),
      imageMedia('m1', {description: 'Frame one'}),
      imageMedia('m2', {description: 'Frame two'}),
      imageMedia('m3', {description: 'Frame three'}),
      imageMedia('m4', {description: 'Frame four'}),
    ]
    renderWithProviders(<Harness media={media} initialIndex={2} />)
    expect(screen.queryByLabelText('Frame zero')).toBeNull()
    expect(screen.getByLabelText('Frame one')).toBeTruthy()
    expect(screen.getByLabelText('Frame two')).toBeTruthy()
    expect(screen.getByLabelText('Frame three')).toBeTruthy()
    expect(screen.queryByLabelText('Frame four')).toBeNull()
  })

  it('creates players only for windowed video frames', () => {
    const media = [videoMedia('v0'), videoMedia('v1'), videoMedia('v2'), videoMedia('v3')]
    renderWithProviders(<Harness media={media} initialIndex={1} />)
    const urls = (useVideoPlayer as jest.Mock).mock.calls.map(call => call[0] as string)
    expect(urls).toEqual([
      'https://cdn.example/v0.mp4',
      'https://cdn.example/v1.mp4',
      'https://cdn.example/v2.mp4',
    ])
    expect(mockPlayersByUrl.get('https://cdn.example/v1.mp4')?.play).toHaveBeenCalled()
    expect(mockPlayersByUrl.get('https://cdn.example/v0.mp4')?.play).not.toHaveBeenCalled()
    // Paging to frame 3 mounts it and drops frame 1.
    fireEvent(screen.getByTestId('lb-pager'), 'onMomentumScrollEnd', {
      nativeEvent: {contentOffset: {x: 800}},
    })
    const later = (useVideoPlayer as jest.Mock).mock.calls.map(call => call[0] as string)
    expect(later).toContain('https://cdn.example/v3.mp4')
    expect(mockPlayersByUrl.get('https://cdn.example/v1.mp4')?.pause).toHaveBeenCalled()
    expect(mockPlayersByUrl.get('https://cdn.example/v2.mp4')?.play).toHaveBeenCalled()
  })
})

describe('sensitive re-check (M14)', () => {
  it('covers an unrevealed sensitive frame until its own Show runs', () => {
    const media = [imageMedia('m0'), imageMedia('m1', {isSensitive: true})]
    renderWithProviders(<Harness media={media} initialIndex={0} />)
    fireEvent(screen.getByTestId('lb-pager'), 'onMomentumScrollEnd', {
      nativeEvent: {contentOffset: {x: 400}},
    })
    expect(screen.getByText('Sensitive media hidden — tap to show')).toBeTruthy()
    expect(screen.queryByLabelText('Alt m1')).toBeNull()
    fireEvent.press(screen.getByTestId('lb-frame-m1-cover-show'))
    expect(screen.getByLabelText('Alt m1')).toBeTruthy()
  })

  it('shows the tapped sensitive frame (the opener already revealed it)', () => {
    const media = [imageMedia('m0'), imageMedia('m1', {isSensitive: true})]
    renderWithProviders(<Harness media={media} initialIndex={1} />)
    expect(screen.queryByText('Sensitive media hidden — tap to show')).toBeNull()
    expect(screen.getByLabelText('Alt m1')).toBeTruthy()
  })
})

describe('zoom, pan, dismiss (M3)', () => {
  it('double-tap toggles 1x/2x on the image frame', () => {
    const media = [imageMedia('m0'), imageMedia('m1')]
    renderWithProviders(<Harness media={media} initialIndex={0} />)
    const frame = screen.getByTestId('lb-frame-m0')
    const image = () => imageImg('m0')
    expect(image().props.style.transform).toEqual([{scale: 1}, {translateX: 0}, {translateY: 0}])
    fireEvent(frame, 'onTouchEnd', {nativeEvent: {timestamp: 1000}})
    fireEvent(frame, 'onTouchEnd', {nativeEvent: {timestamp: 1200}})
    expect(image().props.style.transform).toEqual([{scale: 2}, {translateX: 0}, {translateY: 0}])
    fireEvent(frame, 'onTouchEnd', {nativeEvent: {timestamp: 2000}})
    fireEvent(frame, 'onTouchEnd', {nativeEvent: {timestamp: 2100}})
    expect(image().props.style.transform).toEqual([{scale: 1}, {translateX: 0}, {translateY: 0}])
  })

  it('a two-finger spread pinch-zooms the image frame', () => {
    const media = [imageMedia('m0'), imageMedia('m1')]
    renderWithProviders(<Harness media={media} initialIndex={0} />)
    const pager = screen.getByTestId('lb-pager')
    const two = (a: number, b: number) => ({touches: [{pageX: a, pageY: 300}, {pageX: b, pageY: 300}]})
    fireEvent(pager, 'onTouchStart', {nativeEvent: {pageX: 100, pageY: 300, timestamp: 1, ...two(100, 200)}})
    fireEvent(pager, 'onTouchMove', {nativeEvent: {pageX: 150, pageY: 300, timestamp: 2, ...two(100, 300)}})
    expect(imageImg('m0').props.style.transform).toEqual([
      {scale: 2},
      {translateX: 0},
      {translateY: 0},
    ])
  })

  it('swipe-down dismisses; horizontal paging does not', () => {
    const onClose = jest.fn()
    const media = [imageMedia('m0'), imageMedia('m1')]
    renderWithProviders(<Harness media={media} initialIndex={0} onClose={onClose} />)
    const pager = screen.getByTestId('lb-pager')
    fireEvent(pager, 'onTouchStart', {nativeEvent: {pageX: 200, pageY: 300, timestamp: 1}})
    fireEvent(pager, 'onTouchEnd', {nativeEvent: {pageX: 205, pageY: 450, timestamp: 2}})
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a horizontal swipe never dismisses', () => {
    const onClose = jest.fn()
    const media = [imageMedia('m0'), imageMedia('m1')]
    renderWithProviders(<Harness media={media} initialIndex={0} onClose={onClose} />)
    const pager = screen.getByTestId('lb-pager')
    fireEvent(pager, 'onTouchStart', {nativeEvent: {pageX: 200, pageY: 300, timestamp: 1}})
    fireEvent(pager, 'onTouchEnd', {nativeEvent: {pageX: 20, pageY: 310, timestamp: 2}})
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('web paging and focus (M2)', () => {
  it('arrows, Home/End page; Escape closes; typing is never hijacked', () => {
    setOS('web')
    installDocument()
    const onClose = jest.fn()
    const media = [imageMedia('m0'), imageMedia('m1'), imageMedia('m2')]
    renderWithProviders(<Harness media={media} initialIndex={0} onClose={onClose} />)
    expect(screen.getByText('1 / 3')).toBeTruthy()
    pressKey('ArrowRight')
    expect(screen.getByText('2 / 3')).toBeTruthy()
    pressKey('End')
    expect(screen.getByText('3 / 3')).toBeTruthy()
    pressKey('ArrowRight')
    expect(screen.getByText('3 / 3')).toBeTruthy()
    pressKey('Home')
    expect(screen.getByText('1 / 3')).toBeTruthy()
    pressKey('ArrowLeft')
    expect(screen.getByText('1 / 3')).toBeTruthy()
    pressKey('ArrowRight', 'INPUT')
    expect(screen.getByText('1 / 3')).toBeTruthy()
    pressKey('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Prev/Next buttons page on web only', () => {
    setOS('web')
    installDocument()
    const media = [imageMedia('m0'), imageMedia('m1')]
    renderWithProviders(<Harness media={media} initialIndex={0} />)
    expect(screen.getByTestId('lb-prev').props.accessibilityState).toMatchObject({disabled: true})
    fireEvent.press(screen.getByTestId('lb-prev'))
    expect(screen.getByText('1 / 2')).toBeTruthy()
    fireEvent.press(screen.getByTestId('lb-next'))
    expect(screen.getByText('2 / 2')).toBeTruthy()
    fireEvent.press(screen.getByTestId('lb-prev'))
    expect(screen.getByText('1 / 2')).toBeTruthy()
  })

  it('hides Prev/Next on native', () => {
    const media = [imageMedia('m0'), imageMedia('m1')]
    renderWithProviders(<Harness media={media} initialIndex={0} />)
    expect(screen.queryByTestId('lb-prev')).toBeNull()
    expect(screen.queryByTestId('lb-next')).toBeNull()
  })

  it('returns focus to the opener on close', () => {
    setOS('web')
    const focus = installDocument()
    const media = [imageMedia('m0')]
    const {unmount} = renderWithProviders(<Lightbox media={media} index={0} onClose={() => {}} testID="lb" />)
    unmount()
    expect(focus).toHaveBeenCalledTimes(1)
  })
})

describe('viewer chrome a11y (M15/a11y)', () => {
  it('is a labelled modal dialog with a live-region counter', () => {
    const media = [imageMedia('m0'), imageMedia('m1'), imageMedia('m2')]
    renderWithProviders(<Harness media={media} initialIndex={1} />)
    const dialog = screen.getByTestId('lb-dialog')
    expect(dialog.props.accessibilityViewIsModal).toBe(true)
    expect(dialog.props.role).toBe('dialog')
    expect(dialog.props['aria-modal']).toBe(true)
    const counter = screen.getByTestId('lb-counter')
    expect(counter.props.accessibilityLiveRegion).toBe('polite')
    const label = String(counter.props.accessibilityLabel ?? '')
    expect(label).toContain('2')
    expect(label).toContain('3')
    expect(screen.getByLabelText('Close')).toBeTruthy()
  })

  it('falls back to the generated alt text, never the bare kind', () => {
    const media = [imageMedia('m0', {description: null, name: 'beach.jpg'})]
    renderWithProviders(<Harness media={media} initialIndex={0} />)
    expect(screen.getByLabelText('Image attachment 1: beach.jpg')).toBeTruthy()
  })
})

describe('preview-first images (M4 bandwidth)', () => {
  it('paints the preview, then upgrades to full on settle', () => {
    const media = [imageMedia('m0')]
    renderWithProviders(<Harness media={media} initialIndex={0} />)
    const first = imageImg('m0')
    expect(first.props.source).toEqual({uri: 'https://cdn.example/m0-thumb.png'})
    fireEvent(first, 'onLoad')
    expect(imageImg('m0').props.source).toEqual({uri: 'https://cdn.example/m0.png'})
  })

  it('renders the full source when no preview exists', () => {
    const media = [imageMedia('m0', {previewUrl: null})]
    renderWithProviders(<Harness media={media} initialIndex={0} />)
    expect(imageImg('m0').props.source).toEqual({uri: 'https://cdn.example/m0.png'})
  })
})
