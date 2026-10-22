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

/** Key for the viewer's own account (`Backend.me()`). */
export function meQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, "me");
}

/** Key for the server-side muted-account id set (feed filter source). */
export function serverMutesQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, "server-mutes");
}

/** Key for the server-side blocked-account id set (feed filter source). */
export function serverBlocksQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, "server-blocks");
}

/** Key for the server-side renote-muted-account id set (feed filter source). */
export function serverRenoteMutesQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, "server-renote-mutes");
}

/** Key for the server-side word-filter phrases (feed filter source). */
export function serverFiltersQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, "server-filters");
}

/** Key for the DM inbox (P6.2, clickstone §2.1). Session first, like
 * every other key, so two accounts never share an inbox cache entry. */
export function conversationsQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, 'conversations');
}

/** Key for one DM thread (session + conversation id). */
export function conversationQueryKey(sessionId: string, conversationId: string): AppQueryKey {
  return createQueryKey(sessionId, 'conversation', conversationId);
}

/** Key for the Misskey chat room list (P6.2, clickstone §2.2). Session
 * first, like every other key, so two accounts never share a cache entry. */
export function chatRoomsQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, 'chat-rooms');
}

/** Key for one Misskey chat room (session + room id). */
export function chatRoomQueryKey(sessionId: string, roomId: string): AppQueryKey {
  return createQueryKey(sessionId, 'chat-room', roomId);
}

/** Key for one room's message pages (session + room id). */
export function chatRoomMessagesQueryKey(sessionId: string, roomId: string): AppQueryKey {
  return createQueryKey(sessionId, 'chat-room-messages', roomId);
}

/** Key for one 1-on-1 thread's message pages (session + user id). */
export function chatUserMessagesQueryKey(sessionId: string, userId: string): AppQueryKey {
  return createQueryKey(sessionId, 'chat-user-messages', userId);
}

/** Key for the server's published rules (report chooser, clickstone §1.5).
 * Public per server, but scoped by session like every other key so two
 * accounts never share a cache entry. */
export function reportRulesQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, "report-rules");
}
