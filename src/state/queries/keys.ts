// Query keys (slice 3.2): every key includes the sessionId FIRST.
// That is what makes multi-account deck columns free and what keeps one
// account's cached timeline from ever serving another account (plan §3
// known lesson — pinned by the key-scoping regression test).

/** A TanStack query key. The first element is always the session id. */
export type AppQueryKey = readonly unknown[];

/**
 * Build a query key namespaced by session. Throws on an empty session id:
 * an unscoped key must never reach the cache.
 */
export function createQueryKey(sessionId: string, ...parts: unknown[]): AppQueryKey {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("createQueryKey requires a non-empty sessionId");
  }
  return [sessionId, ...parts];
}

/** Key for a post-feed infinite query: session first, then the feed. */
export function feedQueryKey(sessionId: string, descriptor: string): AppQueryKey {
  return createQueryKey(sessionId, "post-feed", descriptor);
}

/** Key for a single post. */
export function postQueryKey(sessionId: string, postId: string): AppQueryKey {
  return createQueryKey(sessionId, "post", postId);
}

/** Key for a single account. */
export function accountQueryKey(sessionId: string, accountId: string): AppQueryKey {
  return createQueryKey(sessionId, "account", accountId);
}

/** Key for a notifications page. */
export function notificationsQueryKey(
  sessionId: string,
  filter: string = "all",
): AppQueryKey {
  return createQueryKey(sessionId, "notifications", filter);
}
