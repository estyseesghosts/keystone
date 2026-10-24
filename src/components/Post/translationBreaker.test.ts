import {
  TRANSLATE_FORBIDDEN_STREAK_LIMIT,
  isTranslateBlocked,
  recordTranslateOutcome,
  resetTranslationBreakerForTest,
} from './translationBreaker'

beforeEach(() => {
  resetTranslationBreakerForTest()
})

describe('translationBreaker', () => {
  it('starts unblocked', () => {
    expect(isTranslateBlocked('s1')).toBe(false)
  })

  it('a single 403 does not block (one refusal can be one opted-out post)', () => {
    recordTranslateOutcome('s1', 403)
    expect(isTranslateBlocked('s1')).toBe(false)
  })

  it('two consecutive 403s block the session', () => {
    expect(TRANSLATE_FORBIDDEN_STREAK_LIMIT).toBe(2)
    recordTranslateOutcome('s1', 403)
    recordTranslateOutcome('s1', 403)
    expect(isTranslateBlocked('s1')).toBe(true)
  })

  it('success (null) resets the streak', () => {
    recordTranslateOutcome('s1', 403)
    recordTranslateOutcome('s1', null)
    recordTranslateOutcome('s1', 403)
    expect(isTranslateBlocked('s1')).toBe(false)
  })

  it('a 429 interleaved between 403s breaks the streak instead of extending it', () => {
    recordTranslateOutcome('s1', 403)
    recordTranslateOutcome('s1', 429)
    recordTranslateOutcome('s1', 403)
    expect(isTranslateBlocked('s1')).toBe(false)
  })

  it('5xx and unknown outcomes do not count toward the block', () => {
    recordTranslateOutcome('s1', 500)
    recordTranslateOutcome('s1', 503)
    recordTranslateOutcome('s1', null)
    expect(isTranslateBlocked('s1')).toBe(false)
  })

  it('sessions are isolated: one blocked session never blocks another', () => {
    recordTranslateOutcome('blocked', 403)
    recordTranslateOutcome('blocked', 403)
    expect(isTranslateBlocked('blocked')).toBe(true)
    expect(isTranslateBlocked('other')).toBe(false)
    recordTranslateOutcome('other', 403)
    expect(isTranslateBlocked('other')).toBe(false)
  })

  it('the block is sticky: later non-403 outcomes reset the streak but do not unblock', () => {
    recordTranslateOutcome('s1', 403)
    recordTranslateOutcome('s1', 403)
    expect(isTranslateBlocked('s1')).toBe(true)
    recordTranslateOutcome('s1', null)
    recordTranslateOutcome('s1', 200)
    expect(isTranslateBlocked('s1')).toBe(true)
  })

  it('unknown session ids read unblocked', () => {
    expect(isTranslateBlocked('never-seen')).toBe(false)
  })
})
