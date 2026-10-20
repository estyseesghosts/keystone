// Feed query keys (slice 3.3, rule: every query key includes sessionId).
//
// `usePostFeedQuery(sessionId, descriptor)` (slice 3.2) will key off
// this builder. Multi-account correctness: switching accounts never
// shows the previous account's data — keys differ by sessionId, and a
// test pins that.

/** TanStack query key for one feed of one session. */
export function postFeedQueryKey(sessionId: string, descriptor: string): readonly [string, string, string] {
  return ['post-feed', sessionId, descriptor]
}

/** True for non-empty descriptors (the only validation at this layer;
 * descriptor parsing/validation ships with slice 3.2). */
export function isFeedDescriptor(descriptor: string): boolean {
  return descriptor.trim().length > 0
}
