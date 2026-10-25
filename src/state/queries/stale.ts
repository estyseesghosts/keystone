// Cache freshness (slice 3.2): stale/gc budgets per data kind. Feeds go
// stale fast (streaming + poll fill the gap); account/profile data lingers.

/** Milliseconds a cached query stays fresh before refetching. */
export const STALE = {
  /** Timeline / deck-column pages. */
  FEED: 30_000,
  /** Single post. */
  POST: 60_000,
  /** Single account / profile. */
  ACCOUNT: 300_000,
  /** Notifications. */
  NOTIFICATIONS: 15_000,
  /** Search results. */
  SEARCH: 60_000,
} as const;

/** Milliseconds an unused query survives in the cache (and persistence). */
export const GC_TIME = {
  FEED: 30 * 60_000,
  POST: 30 * 60_000,
  ACCOUNT: 60 * 60_000,
  NOTIFICATIONS: 10 * 60_000,
  SEARCH: 10 * 60_000,
} as const;

/** How long a persisted cache entry is trusted across restarts. */
export const QUERY_PERSIST_MAX_AGE = 24 * 60 * 60_000;

/**
 * Domain-model schema version (repair X1.4). `QUERY_BUSTER` derives from
 * this single constant: any widening of the persisted domain shapes
 * (`Post`, `Account`, `Relationship`, `Visibility` — pinned by
 * `MODEL_SHAPE_HASH`) bumps this, which invalidates every persisted blob
 * instead of hydrating stale shapes into new selectors.
 */
export const SCHEMA_VERSION = 1;

/**
 * FNV-1a hash of the canonical adapter-output key lists (see
 * `modelShapeHash` in `persistPolicy.ts` and its test). A model change
 * without a `SCHEMA_VERSION` bump fails the persist-policy test with
 * instructions to bump both together.
 */
export const MODEL_SHAPE_HASH = "b1cb397b";

/** Bump to invalidate every persisted query cache (schema/behavior change). */
export const QUERY_BUSTER = `keystone-queries-v${SCHEMA_VERSION}`;
