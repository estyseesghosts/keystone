// Shared react-query retry policy: bounded retries for transient
// failures, never for rejections a refetch cannot fix (401/403/404/
// 410/422/429 — a throttled request must not become three). `false`
// stays false; a count caps attempts exactly like the raw number did.
import {isNonRetryableStatus} from '@keystone/fedi'

export function retryPolicy(
  attempts?: number | false,
): number | false | ((failureCount: number, error: Error) => boolean) {
  if (attempts === false) return false
  const max = attempts ?? 2
  return (failureCount: number, error: Error) => failureCount < max && !isNonRetryableStatus(error)
}
