// Feed memory (W5 N14): last-visited feed tab + per-feed scroll offsets.
// Pure module state (no react imports) because the shell chrome lives
// outside every navigator and reads it through callbacks. Scroll offsets
// are contentOffset memory scoped per session + descriptor key — feeds
// restore them on back-navigation mount; the memory never crosses
// accounts (`feedScrollKey` carries the session id).

const FEED_TAB_NAMES: readonly string[] = ['Home', 'Network', 'Explore', 'Notifications', 'User']

export type FeedTabKey = 'Home' | 'Network' | 'Explore' | 'Notifications' | 'User'

function isFeedTab(name: string | undefined): name is FeedTabKey {
  return FEED_TAB_NAMES.includes(name as string)
}

let lastFeedTab: FeedTabKey = 'Home'

/** Record a feed visit from the shell `onStateChange` leaf. */
export function recordFeedVisit(leaf: {name: string | undefined}): void {
  if (isFeedTab(leaf.name)) lastFeedTab = leaf.name
}

/** Last visited feed tab (defaults to Home before any visit). Test hook. */
export function lastFeedTabName(): FeedTabKey {
  return lastFeedTab
}

/** Reset the last-feed memory (tests). */
export function resetLastFeed(): void {
  lastFeedTab = 'Home'
}

const feedScrollOffsets = new Map<string, number>()

/** Scroll-offset key: per session + feed descriptor (never cross-account). */
export function feedScrollKey(sessionId: string | null, descriptor: string): string {
  return `${sessionId ?? 'anon'}::${descriptor}`
}

/** Remember a feed list offset (contentOffset memory per route key). */
export function saveFeedScroll(key: string, offset: number): void {
  if (Number.isFinite(offset)) feedScrollOffsets.set(key, offset)
}

/** Read a remembered feed list offset (undefined = never scrolled). */
export function readFeedScroll(key: string): number | undefined {
  return feedScrollOffsets.get(key)
}

/** Drop all remembered offsets (tests, sign-out). */
export function clearFeedScrolls(): void {
  feedScrollOffsets.clear()
}
