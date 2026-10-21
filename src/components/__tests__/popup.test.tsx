import {act, render} from '@testing-library/react-native'
import {Dimensions, ScrollView, StyleSheet} from 'react-native'

import {AnchoredPopup, computePopupLayout} from '#/components/Popup'

// Viewport-safety math for AnchoredPopup: the card must never render
// off-screen on either axis, must flip when the trigger is low, must stay
// usable on small viewports, and the caret must stay inside the card.

const WIN = {width: 390, height: 844}

describe('computePopupLayout', () => {
  it('opens below the trigger when there is room', () => {
    const layout = computePopupLayout({
      x: 20,
      y: 100,
      w: 40,
      h: 40,
      winW: WIN.width,
      winH: WIN.height,
      side: 'below',
      minWidth: 200,
    })
    expect(layout.top).toBe(100 + 40 + 6)
    expect(layout.bottom).toBeUndefined()
    expect(layout.left).toBe(20)
    expect(layout.cardWidth).toBe(340)
    expect(layout.maxH).toBe(844 - 140 - 8 - 6)
    expect(layout.caret).toEqual({dx: 20 + 20 - 20, side: 'top'})
  })

  it('clamps a right-edge trigger fully on-screen horizontally', () => {
    const layout = computePopupLayout({
      x: 330,
      y: 100,
      w: 40,
      h: 40,
      winW: WIN.width,
      winH: WIN.height,
      side: 'below',
      minWidth: 200,
    })
    // Card is 340 wide; the rightmost on-screen left is 390 - 8 - 340 = 42.
    expect(layout.cardWidth).toBe(340)
    expect(layout.left).toBe(42)
    expect(layout.left).toBeGreaterThanOrEqual(8)
    expect(layout.left + layout.cardWidth).toBeLessThanOrEqual(WIN.width - 8)
  })

  it('flips above a bottom trigger', () => {
    const layout = computePopupLayout({
      x: 20,
      y: 780,
      w: 40,
      h: 40,
      winW: WIN.width,
      winH: WIN.height,
      side: 'below',
      minWidth: 200,
    })
    expect(layout.top).toBeUndefined()
    expect(layout.bottom).toBe(844 - 780 + 6)
    // Card hangs off the trigger's top edge: bottom + maxH stays in-viewport.
    expect(layout.maxH).toBe(780 - 8 - 6)
    expect(layout.bottom! + layout.maxH).toBeLessThanOrEqual(WIN.height - 8)
    expect(layout.caret?.side).toBe('bottom')
  })

  it('honours an explicit above side when it fits', () => {
    const layout = computePopupLayout({
      x: 20,
      y: 400,
      w: 40,
      h: 40,
      winW: WIN.width,
      winH: WIN.height,
      side: 'above',
      minWidth: 200,
    })
    expect(layout.top).toBeUndefined()
    expect(layout.caret?.side).toBe('bottom')
  })

  it('caps width/height on a small viewport and centers instead of overflowing', () => {
    const layout = computePopupLayout({
      x: 130,
      y: 80,
      w: 40,
      h: 40,
      winW: 300,
      winH: 200,
      side: 'below',
      minWidth: 200,
    })
    // Neither side fits MIN_SIDE (66px each): centered full-height fallback.
    expect(layout.cardWidth).toBe(300 - 16)
    expect(layout.left).toBe(8)
    expect(layout.left + layout.cardWidth).toBeLessThanOrEqual(300 - 8)
    expect(layout.top).toBe(8)
    expect(layout.maxH).toBe(200 - 16)
    expect(layout.caret).toBeNull()
  })

  it('clamps the caret inside the card for edge triggers', () => {
    const leftTrigger = computePopupLayout({
      x: 0,
      y: 100,
      w: 40,
      h: 40,
      winW: WIN.width,
      winH: WIN.height,
      side: 'below',
      minWidth: 200,
    })
    // Trigger centre (20) minus clamped left (8) = 12 -> clamped to CARET_MIN.
    expect(leftTrigger.caret?.dx).toBe(16)

    const rightTrigger = computePopupLayout({
      x: 330,
      y: 100,
      w: 40,
      h: 40,
      winW: WIN.width,
      winH: WIN.height,
      side: 'below',
      minWidth: 200,
    })
    expect(rightTrigger.caret!.dx).toBeGreaterThanOrEqual(16)
    expect(rightTrigger.caret!.dx).toBeLessThanOrEqual(rightTrigger.cardWidth - 16)
  })

  it('drops the caret when the card is too narrow to hold it', () => {
    const layout = computePopupLayout({
      x: 5,
      y: 10,
      w: 20,
      h: 20,
      winW: 30,
      winH: 400,
      side: 'below',
      minWidth: 200,
    })
    expect(layout.cardWidth).toBe(14)
    expect(layout.left).toBe(8)
    expect(layout.caret).toBeNull()
  })

  it('uses the available space on a wide viewport instead of minimums', () => {
    const layout = computePopupLayout({
      x: 20,
      y: 100,
      w: 40,
      h: 40,
      winW: 1280,
      winH: 800,
      side: 'below',
      minWidth: 200,
    })
    // Width cap is CARD_MAX, not the minWidth floor: roomy content may use
    // the free space. (Anti-regression: pinning the cap to the floor would
    // render a 200px squished card on a wide viewport.)
    expect(layout.cardWidth).toBe(340)
    expect(layout.effMinWidth).toBe(200)
    expect(layout.cardWidth).toBeGreaterThan(layout.effMinWidth)
    // maxH is the chosen side's full real space minus GAP — generous, so
    // short content never scrolls when room exists.
    expect(layout.maxH).toBe(800 - 140 - 8 - 6)
    expect(layout.top! + layout.maxH).toBe(800 - 8)
  })

  it('never leaves the viewport across a 10k+ sweep of triggers and viewports', () => {
    const viewports = [
      {winW: 320, winH: 568},
      {winW: 390, winH: 844},
      {winW: 768, winH: 1024},
      {winW: 1280, winH: 800},
    ]
    let count = 0
    for (const {winW, winH} of viewports) {
      for (let x = -50; x <= winW + 50; x += 20) {
        for (let y = -50; y <= winH + 50; y += 20) {
          for (const side of ['below', 'above'] as const) {
            const layout = computePopupLayout({
              x,
              y,
              w: 40,
              h: 40,
              winW,
              winH,
              side,
              minWidth: 200,
            })
            count += 1
            // Width cap never exceeds the window minus margins; the clamped
            // left keeps even a full-cap card on-screen.
            expect(layout.cardWidth).toBeLessThanOrEqual(Math.min(340, winW - 16) + 1e-9)
            expect(layout.effMinWidth).toBeLessThanOrEqual(layout.cardWidth + 1e-9)
            expect(layout.left).toBeGreaterThanOrEqual(8)
            expect(layout.left + layout.cardWidth).toBeLessThanOrEqual(winW - 8 + 1e-9)
            if (layout.top !== undefined) {
              expect(layout.top).toBeGreaterThanOrEqual(8)
              expect(layout.top + layout.maxH).toBeLessThanOrEqual(winH - 8 + 1e-9)
            } else {
              expect(layout.bottom).toBeGreaterThanOrEqual(0)
              expect(layout.bottom! + layout.maxH).toBeLessThanOrEqual(winH - 8 + 1e-9)
            }
            if (layout.caret) {
              expect(layout.caret.dx).toBeGreaterThanOrEqual(16)
              expect(layout.caret.dx).toBeLessThanOrEqual(layout.cardWidth - 16)
            }
          }
        }
      }
    }
    // Proof the sweep is exhaustive, not a handful of points.
    expect(count).toBeGreaterThan(10000)
  })
})

describe('AnchoredPopup viewport behaviour', () => {
  const realGet = Dimensions.get
  let dimHandler: (() => void) | null = null

  beforeEach(() => {
    dimHandler = null
    jest
      .spyOn(Dimensions, 'get')
      .mockImplementation(
        () => ({width: WIN.width, height: WIN.height, scale: 2, fontScale: 1}) as never,
      )
    jest.spyOn(Dimensions, 'addEventListener').mockImplementation((((
      _type: string,
      handler: () => void,
    ) => {
      dimHandler = handler
      return {remove: jest.fn()}
    }) as never) as typeof Dimensions.addEventListener)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    expect(Dimensions.get).toBe(realGet)
  })

  function fakeAnchor(x: number, y: number, w: number, h: number) {
    return {
      current: {measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(x, y, w, h)},
    } as never
  }

  it('renders the measured card on-screen with maxHeight and a scrollable body', () => {
    const screen = render(
      <AnchoredPopup anchor={fakeAnchor(330, 100, 40, 40)} onClose={() => {}} testID="p">
        <></>
      </AnchoredPopup>,
    )
    const card = screen.getByTestId('p')
    const style = StyleSheet.flatten(card.props.style) as {
      left?: number
      width?: number
      minWidth?: number
      maxWidth?: number
      maxHeight?: number
      top?: number
    }
    // No fixed width pin: the card shrink-wraps content between the floor
    // and the cap. Even a full-cap card stays on-screen via the left clamp.
    expect(style.width).toBeUndefined()
    expect(style.minWidth).toBe(200)
    expect(style.maxWidth).toBe(340)
    expect(style.left! + style.maxWidth!).toBeLessThanOrEqual(WIN.width - 8)
    expect(style.maxHeight).toBe(844 - 140 - 8 - 6)
    expect(style.top).toBe(146)
    // Content scrolls inside the capped card instead of growing past maxHeight.
    expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy()
    // Caret stays inside the card and points at the trigger.
    const caret = screen.getByTestId('p-caret')
    const caretLeft = (StyleSheet.flatten(caret.props.style) as {left?: number}).left ?? 0
    expect(caretLeft).toBeGreaterThan(0)
    expect(caretLeft + 10).toBeLessThan(style.maxWidth!)
  })

  it('lets small content stay small instead of bloating to the cap', () => {
    const screen = render(
      <AnchoredPopup anchor={fakeAnchor(20, 100, 40, 40)} onClose={() => {}} testID="p">
        <></>
      </AnchoredPopup>,
    )
    const style = StyleSheet.flatten(screen.getByTestId('p').props.style) as {
      width?: number
      minWidth?: number
      maxWidth?: number
    }
    // Anti-regression both ways: neither a fixed 340 (bloats tiny content)
    // nor a fixed 200 (squishes roomy content) — content drives the width
    // within [floor, cap].
    expect(style.width).toBeUndefined()
    expect(style.minWidth).toBe(200)
    expect(style.maxWidth).toBe(340)
    expect(style.minWidth!).toBeLessThan(style.maxWidth!)
  })

  it('falls back to a centered on-screen card without measurement', () => {
    const screen = render(
      <AnchoredPopup anchor={{current: null}} onClose={() => {}} testID="p">
        <></>
      </AnchoredPopup>,
    )
    const card = screen.getByTestId('p')
    const style = StyleSheet.flatten(card.props.style) as {
      left?: number
      width?: number
      minWidth?: number
      maxWidth?: number
      maxHeight?: number
      top?: number
    }
    expect(style.width).toBeUndefined()
    expect(style.left! + style.maxWidth!).toBeLessThanOrEqual(WIN.width - 8)
    expect(style.maxHeight).toBeLessThanOrEqual(WIN.height)
    expect(screen.queryByTestId('p-caret')).toBeNull()
  })

  it('re-measures on viewport change so rotation never strands the card', () => {
    const getMock = Dimensions.get as jest.Mock
    const screen = render(
      <AnchoredPopup anchor={fakeAnchor(330, 100, 40, 40)} onClose={() => {}} testID="p">
        <></>
      </AnchoredPopup>,
    )
    expect((StyleSheet.flatten(screen.getByTestId('p').props.style) as {left?: number}).left).toBe(
      42,
    )
    // Rotate to a narrow window: the card re-clamps instead of hanging off.
    getMock.mockImplementation(
      () => ({width: 300, height: 844, scale: 2, fontScale: 1}) as never,
    )
    act(() => {
      dimHandler?.()
    })
    const style = StyleSheet.flatten(screen.getByTestId('p').props.style) as {
      left?: number
      minWidth?: number
      maxWidth?: number
    }
    expect(style.maxWidth).toBe(284)
    expect(style.minWidth).toBe(200)
    expect(style.left! + style.maxWidth!).toBeLessThanOrEqual(300 - 8)
  })
})
