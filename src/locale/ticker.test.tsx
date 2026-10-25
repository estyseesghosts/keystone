// Repair X9.5: the shared minute ticker — one interval for the whole
// app, rows advance on rollover, background pauses, foreground snaps
// forward. Deterministic: the fake clock is pinned mid-minute so the
// whole-minute snapshot is exact (no boundary flake).

import {act, cleanup, render, screen} from '@testing-library/react-native'
import {AppState, Text} from 'react-native'

import {formatRelativeTime} from './format'
import {__resetMinuteTickerForTests, useNow} from './ticker'

function Probe({createdAt}: {createdAt: string}) {
  const nowMs = useNow()
  return <Text testID="probe">{formatRelativeTime(createdAt, nowMs, 'en')}</Text>
}

type AppStateHandler = (state: string) => void

function mockAppState(box: {handler: AppStateHandler | null}): void {
  const addSpy = jest.spyOn(AppState, 'addEventListener') as unknown as jest.Mock
  addSpy.mockImplementation((...args: Array<unknown>) => {
    box.handler = args[1] as AppStateHandler
    return {remove: () => {}}
  })
}

const MIN = 60_000

describe('minute ticker (shared)', () => {
  beforeEach(() => {
    __resetMinuteTickerForTests()
    jest.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    jest.useRealTimers()
    jest.restoreAllMocks()
    __resetMinuteTickerForTests()
  })

  /** Fake now pinned 30s into the current minute (deterministic snapshot). */
  function midMinuteNow(): number {
    return Math.floor(Date.now() / MIN) * MIN + 30_000
  }

  it('advances a rendered relative label when the minute rolls over', () => {
    const box: {handler: AppStateHandler | null} = {handler: null}
    mockAppState(box)
    const now = midMinuteNow()
    jest.setSystemTime(now)
    render(<Probe createdAt={new Date(now - 5.5 * MIN).toISOString()} />)
    expect(screen.getByTestId('probe')).toHaveTextContent('5m ago')
    act(() => {
      jest.advanceTimersByTime(61_000)
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('6m ago')
  })

  it('pauses while backgrounded and snaps forward on return', () => {
    const box: {handler: AppStateHandler | null} = {handler: null}
    mockAppState(box)
    const now = midMinuteNow()
    jest.setSystemTime(now)
    render(<Probe createdAt={new Date(now - 5.5 * MIN).toISOString()} />)
    expect(screen.getByTestId('probe')).toHaveTextContent('5m ago')
    if (!box.handler) throw new Error('ticker did not subscribe to AppState')
    act(() => {
      box.handler?.('background')
    })
    act(() => {
      jest.advanceTimersByTime(120_000)
    })
    // Two silent minutes: no tick, no re-render.
    expect(screen.getByTestId('probe')).toHaveTextContent('5m ago')
    act(() => {
      box.handler?.('active')
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('7m ago')
  })

  it('shares one interval across rows and releases it on unmount', () => {
    const box: {handler: AppStateHandler | null} = {handler: null}
    mockAppState(box)
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval')
    const now = midMinuteNow()
    jest.setSystemTime(now)
    const createdAt = new Date(now - 5.5 * MIN).toISOString()
    // One root, two subscribed rows: a single act scope (two `render`
    // calls in one test unbalance React's act bookkeeping).
    const tree = render(
      <>
        <Probe createdAt={createdAt} />
        <Probe createdAt={createdAt} />
      </>,
    )
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    const clearSpy = jest.spyOn(globalThis, 'clearInterval')
    // One row left: the interval stays.
    tree.rerender(<Probe createdAt={createdAt} />)
    expect(clearSpy).not.toHaveBeenCalled()
    tree.unmount()
    expect(clearSpy).toHaveBeenCalledTimes(1)
  })
})
