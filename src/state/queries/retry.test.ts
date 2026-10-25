// Shared query retry policy: bounded retries for transient failures,
// never for rejections a refetch cannot fix.
import {ApiError} from '@keystone/fedi'

import {abortedError, isAbortedError, retryAfterMsOf, retryPolicy} from './retry'

function apiError(status: number): ApiError {
  return new ApiError(`HTTP ${status}`, status, 'errors.network.apiError')
}

function run(policy: ReturnType<typeof retryPolicy>, error: Error, times: number): boolean[] {
  if (typeof policy !== 'function') return []
  return Array.from({length: times}, (_, i) => policy(i, error))
}

describe('retryPolicy', () => {
  it('retries transient failures up to the cap', () => {
    expect(run(retryPolicy(), new Error('boom'), 4)).toEqual([true, true, false, false])
    expect(run(retryPolicy(1), new Error('boom'), 3)).toEqual([true, false, false])
  })

  it('never retries auth/missing/invalid/throttled statuses', () => {
    for (const status of [401, 403, 404, 410, 422, 429]) {
      expect(run(retryPolicy(), apiError(status), 2)).toEqual([false, false])
    }
  })

  it('still retries timeouts, network failures, and 5xx', () => {
    expect(run(retryPolicy(), apiError(0), 2)).toEqual([true, true])
    expect(run(retryPolicy(), apiError(503), 2)).toEqual([true, true])
  })

  it('false stays false', () => {
    expect(retryPolicy(false)).toBe(false)
  })

  it('never retries a caller abort (repair X3.1)', () => {
    expect(run(retryPolicy(), abortedError(), 2)).toEqual([false, false])
    // The Mastodon transport shape: kind + code, no ApiError wrapper.
    expect(run(retryPolicy(), {kind: 'aborted', code: 'errors.network.aborted'} as unknown as Error, 2)).toEqual([
      false,
      false,
    ])
    // A raw DOM AbortError is also terminal (never resurrected by retry).
    expect(run(retryPolicy(), Object.assign(new Error('aborted'), {name: 'AbortError'}), 2)).toEqual([
      false,
      false,
    ])
  })
})

describe('isAbortedError', () => {
  it('recognises the typed abort from either family', () => {
    expect(isAbortedError(abortedError())).toBe(true)
    expect(isAbortedError({kind: 'aborted', code: 'errors.network.aborted'})).toBe(true)
    expect(isAbortedError(Object.assign(new Error('aborted'), {name: 'AbortError'}))).toBe(true)
  })

  it('rejects timeouts, network failures, and HTTP errors', () => {
    expect(isAbortedError(new Error('boom'))).toBe(false)
    expect(isAbortedError(apiError(0))).toBe(false)
    expect(isAbortedError(apiError(503))).toBe(false)
    expect(isAbortedError(null)).toBe(false)
  })

  it('abortedError carries kind aborted with a zero status', () => {
    const err = abortedError()
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('aborted')
    expect(err.code).toBe('errors.network.aborted')
    expect(err.status).toBe(0)
  })
})

describe('retryAfterMsOf', () => {
  function throttled(retryAfterMs?: number): ApiError {
    return new ApiError('throttled', 429, 'errors.network.apiError', 'http', {
      ...(retryAfterMs !== undefined ? {retryAfter: String(retryAfterMs / 1000), retryAfterMs} : {}),
    })
  }

  it('reads the parsed 429 delay from ApiError params', () => {
    expect(retryAfterMsOf(throttled(30_000))).toBe(30_000)
  })

  it('yields null for a 429 without a parseable delay', () => {
    expect(retryAfterMsOf(throttled())).toBeNull()
    expect(retryAfterMsOf(new ApiError('x', 429, 'errors.network.apiError'))).toBeNull()
  })

  it('rejects non-positive, non-finite, and non-number delays', () => {
    expect(retryAfterMsOf(throttled(0))).toBeNull()
    expect(retryAfterMsOf(throttled(-5))).toBeNull()
    expect(retryAfterMsOf(throttled(Number.NaN))).toBeNull()
    expect(retryAfterMsOf(throttled(Number.POSITIVE_INFINITY))).toBeNull()
  })

  it('yields null for non-429 failures even when params carry a delay', () => {
    const serverError = new ApiError('boom', 503, 'errors.network.apiError', 'http', {
      retryAfterMs: 30_000,
    })
    expect(retryAfterMsOf(serverError)).toBeNull()
    expect(retryAfterMsOf(new Error('boom'))).toBeNull()
    expect(retryAfterMsOf(null)).toBeNull()
    expect(retryAfterMsOf('429')).toBeNull()
  })
})
