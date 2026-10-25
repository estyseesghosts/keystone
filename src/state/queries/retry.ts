// Shared react-query retry policy: bounded retries for transient
// failures, never for rejections a refetch cannot fix (401/403/404/
// 410/422/429 — a throttled request must not become three). `false`
// stays false; a count caps attempts exactly like the raw number did.
import {ApiError, httpStatusOf, isNonRetryableStatus} from '@keystone/fedi'

/** True when the failure is a caller abort (repair X3.1): the typed
 * `aborted` kind/code from either family transport, or a raw DOM
 * `AbortError` for callers that surface one. Pure — shared by the retry
 * policy and every read query that must not swallow a cancel. */
export function isAbortedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const rec = err as {kind?: unknown; code?: unknown; name?: unknown}
  return rec.kind === 'aborted' || rec.code === 'errors.network.aborted' || rec.name === 'AbortError'
}

/** The typed abort error (repair X3.1): `kind: 'aborted'`, never retried,
 * never shown as an error. Read queries with no forwardable backend
 * signal (endpoints without an opts bag) throw this when already aborted
 * before starting — the in-flight case is reverted by react-query itself. */
export function abortedError(): ApiError {
  return new ApiError('Request was cancelled.', 0, 'errors.network.aborted', 'aborted', {
    status: 0,
  })
}

/** Throw `abortedError()` when the query signal already fired (repair
 * X3.1). No-op otherwise. Lets signal-less backend reads still honour a
 * pre-abort without inventing an error surface. */
export function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw abortedError()
}

export function retryPolicy(
  attempts?: number | false,
): number | false | ((failureCount: number, error: Error) => boolean) {
  if (attempts === false) return false
  const max = attempts ?? 2
  return (failureCount: number, error: Error) =>
    failureCount < max && !isNonRetryableStatus(error) && !isAbortedError(error)
}

/**
 * Best-effort `Retry-After` delay (ms) of a query failure. Reads the parsed
 * `retryAfterMs` the transports stash in `ApiError.params` (Mastodon 429s
 * carry the raw header plus the parsed delay; see `toApiError`), and only
 * for real 429s — a non-throttle failure never stalls paging, and a 429
 * without a parseable delay yields null (error guard still blocks
 * auto-paging, there is just no timed cooldown). Pure.
 */
export function retryAfterMsOf(err: unknown): number | null {
  if (httpStatusOf(err) !== 429) return null
  if (typeof err !== 'object' || err === null) return null
  const params = (err as {params?: unknown}).params
  if (typeof params !== 'object' || params === null) return null
  const ms = (params as {retryAfterMs?: unknown}).retryAfterMs
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  return ms
}
