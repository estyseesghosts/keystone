// NewsTab list merge (R2.4).
//
// Two rapid `onEndReached` fires can overlap: the second caller's `seen`
// set would be built from the same stale `links` snapshot as the first.
// Merging inside the functional `setLinks` updater (plus the in-flight
// ref in the tab) dedupes against the freshest list either way. Pure.

import type {NewsLink} from '@keystone/fedi'

/** Append page items, dropping urls already on screen. Pure. */
export function mergeNewsLinks(prev: NewsLink[], items: NewsLink[]): NewsLink[] {
  const seen = new Set(prev.map(l => l.url))
  return [...prev, ...items.filter(l => !seen.has(l.url))]
}
