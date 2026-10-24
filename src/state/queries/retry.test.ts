// Shared query retry policy: bounded retries for transient failures,
// never for rejections a refetch cannot fix.
import {ApiError} from '@keystone/fedi'

import {retryPolicy} from './retry'

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
})
