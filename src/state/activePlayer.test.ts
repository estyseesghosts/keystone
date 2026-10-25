// Repair X7.2 step 1 + 5: the global one-playing-at-a-time store.
// Pure store tests (no rendering): claims preempt, the ceiling bounds the
// live set, release/suspend clear, subscribers fire, AppState mapping is exact.

import {act, renderHook} from '@testing-library/react-native'

import {
  __resetActivePlayerForTests,
  getActivePlayerIds,
  getMaxActivePlayers,
  isAppActiveState,
  isPlayerActive,
  releasePlayer,
  requestPlayerPlay,
  setMaxActivePlayers,
  subscribeActivePlayer,
  suspendAllPlayers,
  useIsPlayerActive,
  DEFAULT_MAX_ACTIVE_PLAYERS,
} from './activePlayer'

beforeEach(() => {
  __resetActivePlayerForTests()
})

describe('activePlayer store (one playing at a time)', () => {
  it('starts empty with a ceiling of one', () => {
    expect(getActivePlayerIds()).toEqual([])
    expect(getMaxActivePlayers()).toBe(DEFAULT_MAX_ACTIVE_PLAYERS)
    expect(DEFAULT_MAX_ACTIVE_PLAYERS).toBe(1)
  })

  it('a second claim preempts the first (default ceiling 1)', () => {
    requestPlayerPlay('gifv:a')
    expect(isPlayerActive('gifv:a')).toBe(true)
    requestPlayerPlay('gifv:b')
    expect(isPlayerActive('gifv:b')).toBe(true)
    expect(isPlayerActive('gifv:a')).toBe(false)
    expect(getActivePlayerIds()).toEqual(['gifv:b'])
  })

  it('re-claiming the same id keeps a single entry', () => {
    requestPlayerPlay('gifv:a')
    requestPlayerPlay('gifv:a')
    expect(getActivePlayerIds()).toEqual(['gifv:a'])
  })

  it('ignores empty ids', () => {
    requestPlayerPlay('')
    expect(getActivePlayerIds()).toEqual([])
  })

  it('release drops only the released id', () => {
    requestPlayerPlay('gifv:a')
    releasePlayer('gifv:b')
    expect(isPlayerActive('gifv:a')).toBe(true)
    releasePlayer('gifv:a')
    expect(getActivePlayerIds()).toEqual([])
  })

  it('suspendAll clears every claim', () => {
    setMaxActivePlayers(3)
    requestPlayerPlay('a')
    requestPlayerPlay('b')
    suspendAllPlayers()
    expect(getActivePlayerIds()).toEqual([])
    // Suspending an empty store is a silent no-op (still notifies nobody).
    const listener = jest.fn()
    const off = subscribeActivePlayer(listener)
    suspendAllPlayers()
    expect(listener).not.toHaveBeenCalled()
    off()
  })

  it('the configured ceiling bounds the live set (oldest preempted first)', () => {
    setMaxActivePlayers(2)
    requestPlayerPlay('a')
    requestPlayerPlay('b')
    requestPlayerPlay('c')
    expect(getActivePlayerIds()).toEqual(['c', 'b'])
    expect(isPlayerActive('a')).toBe(false)
  })

  it('lowering the ceiling trims the oldest claims immediately', () => {
    setMaxActivePlayers(3)
    requestPlayerPlay('a')
    requestPlayerPlay('b')
    requestPlayerPlay('c')
    setMaxActivePlayers(1)
    expect(getActivePlayerIds()).toEqual(['c'])
  })

  it('clamps a garbage ceiling back to the default', () => {
    setMaxActivePlayers(0)
    expect(getMaxActivePlayers()).toBe(DEFAULT_MAX_ACTIVE_PLAYERS)
    setMaxActivePlayers(Number.NaN)
    expect(getMaxActivePlayers()).toBe(DEFAULT_MAX_ACTIVE_PLAYERS)
  })

  it('notifies subscribers on every change', () => {
    const listener = jest.fn()
    const off = subscribeActivePlayer(listener)
    requestPlayerPlay('a')
    releasePlayer('a')
    off()
    requestPlayerPlay('b')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('the hook tracks the slot reactively', () => {
    const {result} = renderHook(() => useIsPlayerActive('a'))
    expect(result.current).toBe(false)
    act(() => {
      requestPlayerPlay('a')
    })
    expect(result.current).toBe(true)
    act(() => {
      requestPlayerPlay('b')
    })
    expect(result.current).toBe(false)
  })
})

describe('isAppActiveState', () => {
  it('treats only `active` as foreground', () => {
    expect(isAppActiveState('active')).toBe(true)
    expect(isAppActiveState('background')).toBe(false)
    expect(isAppActiveState('inactive')).toBe(false)
    expect(isAppActiveState('extension')).toBe(false)
    expect(isAppActiveState(null)).toBe(false)
    expect(isAppActiveState(undefined)).toBe(false)
  })
})
