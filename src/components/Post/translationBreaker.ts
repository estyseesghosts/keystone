// Auto-translate 403 circuit breaker (per session, in-memory).
//
// Production cause: some servers (observed: mstdn.ca) refuse the
// `POST /statuses/:id/translate` endpoint per status with 403 while
// answering others with 200 — per-status refusal, not an auth problem.
// PostCard's auto-translate fires one fetch per mounted post, and every
// refusal is pure waste repeated on every mount/remount, draining the
// shared rate bucket until ordinary timeline paging 429s.
//
// Response: after K consecutive auto-translate 403s the session is
// blocked — further AUTO-translate fetches for that session skip
// silently (the original body shows, exactly today's failure fallback).
// Manual translate (explicit user tap) is NEVER gated and NEVER records.
//
// Threshold K=2: one 403 can be a single opted-out post; two in a row is
// a refusing endpoint.
//
// Streak semantics: ANY non-403 completion — success, 429/5xx, timeout,
// unknown — resets the consecutive-403 counter. 429s and 5xx are
// transient (retryable by definition), so a 429 interleaved between two
// 403s breaks the streak rather than extending it. Once blocked, the
// block is sticky for the session lifetime (the auto path stops
// fetching, so there is no new signal to unblock on); only the test
// reset clears it. No persistence: a reload re-probes honestly.

/** Consecutive auto-translate 403s before a session is blocked. */
export const TRANSLATE_FORBIDDEN_STREAK_LIMIT = 2

type BreakerEntry = {
  consecutive403: number
  blocked: boolean
}

const entries = new Map<string, BreakerEntry>()

function entryFor(sessionId: string): BreakerEntry {
  let entry = entries.get(sessionId)
  if (!entry) {
    entry = {consecutive403: 0, blocked: false}
    entries.set(sessionId, entry)
  }
  return entry
}

/** True once this session's auto-translate streak has tripped the breaker. */
export function isTranslateBlocked(sessionId: string): boolean {
  return entries.get(sessionId)?.blocked === true
}

/**
 * Record one completed auto-translate attempt for a session.
 *
 * - `status === 403` increments the consecutive counter; reaching
 *   {@link TRANSLATE_FORBIDDEN_STREAK_LIMIT} blocks the session.
 * - Any other value (success — pass `null`, not a faked 200 — or a
 *   non-403 failure such as 429/5xx/timeout/unknown) resets the
 *   consecutive counter. A sticky block is NOT lifted by this: the
 *   blocked auto path stops fetching, so there is no live signal to
 *   unblock on.
 *
 * Call only from the AUTO path. The manual path neither checks nor
 * records, so explicit user taps always reach the server.
 */
export function recordTranslateOutcome(sessionId: string, status: number | null): void {
  const entry = entryFor(sessionId)
  if (status === 403) {
    entry.consecutive403 += 1
    if (entry.consecutive403 >= TRANSLATE_FORBIDDEN_STREAK_LIMIT) {
      entry.blocked = true
    }
    return
  }
  entry.consecutive403 = 0
}

/** Test-only reset: clears every session (or one session when given). */
export function resetTranslationBreakerForTest(sessionId?: string): void {
  if (sessionId === undefined) {
    entries.clear()
    return
  }
  entries.delete(sessionId)
}
