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

/**
 * True for the ranked recommendations feed (`recommendations`, with or
 * without the `|rec-params` suffix the query key carries). Pure.
 *
 * Ranked feeds are exempt from every background refetch (gap-fill,
 * foreground refetch): Sharkey's `notes/recommendations` re-scores on
 * every request, so a background refetch is not a refresh but a reroll —
 * rows remount and the pixel offset lands on different posts. Only an
 * explicit user action (fresh mount, pull-to-refresh, tab re-press)
 * rerolls. Timelines keep their background refetch: re-reading the same
 * cursor window is stable there.
 */
export function isRecommendationsFeedKey(key: unknown): boolean {
  if (!Array.isArray(key) || key.length < 3) return false
  if (key[1] !== 'post-feed') return false
  const descriptor = key[2]
  return descriptor === 'recommendations' || (typeof descriptor === 'string' && descriptor.startsWith('recommendations|'))
}

/** Key for a single post. */
export function postQueryKey(sessionId: string, postId: string): AppQueryKey {
  return createQueryKey(sessionId, "post", postId);
}

/** Key for the own-clips listing (`mine`) or one clip (`clip:${id}`). */
export function clipsQueryKey(sessionId: string, scope: string): AppQueryKey {
  return createQueryKey(sessionId, "clips", scope);
}

/** Key for one clip's mosaic images (DC-5: cached 10 min). */
export function clipMosaicQueryKey(sessionId: string, clipId: string): AppQueryKey {
  return createQueryKey(sessionId, "clip-mosaic", clipId);
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

/** Key for the server-authoritative unread count (P6.5). */
export function notificationsCountQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, 'notifications-count');
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

/** Key for the recommendations endpoint probe (fork `notes/recommendations`
 * presence, one verdict per session). Session first like every other key. */
export function recommendationsProbeQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, 'recommendations', 'probe');
}

/** Key for the recommender's interest overlay (`i/recommendation-interests`). */
export function recommendationInterestsQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, 'recommendations', 'interests');
}

/** Key for a drive usage row. */
export function driveUsageQueryKey(sessionId: string): AppQueryKey {
  return createQueryKey(sessionId, 'drive-usage');
}

/** Key for one folder level (`root` = drive root). */
export function driveFoldersQueryKey(sessionId: string, scope: string): AppQueryKey {
  return createQueryKey(sessionId, 'drive-folders', scope);
}

/** Key for one folder's detail (breadcrumbs). */
export function driveFolderQueryKey(sessionId: string, folderId: string): AppQueryKey {
  return createQueryKey(sessionId, 'drive-folder', folderId);
}

/** Key for one folder's file listing (`sort` pins the ordering). */
export function driveFilesQueryKey(sessionId: string, scope: string, sort: string): AppQueryKey {
  return createQueryKey(sessionId, 'drive-files', scope, sort);
}
