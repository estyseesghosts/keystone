import type {FeedDescriptor, ServerFamily, UserFeedTab} from '@keystone/fedi'

import type {NetworkTab} from '#/routes'
import {feedPrefsStore, type FeedPrefs} from '#/state/feedPrefs'

// Feed helpers shared by every timeline screen (slice 3.11). The descriptor
// grammar and parser live in `@keystone/fedi` (`parseFeedDescriptor`); the
// query key is `feedQueryKey` in `./keys`. This file holds only the
// app-side rules on top: tab visibility, descriptor builders, and the
// new-posts counter.
//
// The old Keystone feed-visibility RULE (ported as data, not the component):
// Local is hidden while Social exists, and Federated is never the
// default tab.

export type ProfileFeedTab = UserFeedTab

/** Social (Misskey hybrid) exists everywhere except the Mastodon family,
 * which answers it as unsupported rather than an empty feed. */
export function supportsSocialTimeline(family: ServerFamily | null | undefined): boolean {
  return family === 'misskey'
}

/**
 * Visible Network tabs for a server family + the reader's feed prefs.
 * Local hides while Social exists (Misskey family) UNLESS the reader
 * turned it on in Settings → Feeds; the Mastodon family has no Social
 * timeline, so Local stays visible there. Federated hides when the
 * reader turned it off (default on).
 *
 * `prefs` defaults to the live device store so call sites that cannot
 * subscribe (the Network tab bar) still honour the setting; tests pass
 * explicit prefs and stay pure.
 */
export function visibleNetworkTabs(
  family: ServerFamily | null | undefined,
  prefs: FeedPrefs = feedPrefsStore.get(),
): NetworkTab[] {
  const tabs: NetworkTab[] = []
  if (supportsSocialTimeline(family)) {
    tabs.push('social')
    if (prefs.showLocal) tabs.push('local')
  } else {
    tabs.push('local')
  }
  if (prefs.showFederated) tabs.push('federated')
  // Federated is never the default tab, and the bar is never
  // empty: a reader who hides everything still keeps the default.
  return tabs.length > 0 ? tabs : [defaultNetworkTab(family)]
}

/** Federated is never the default tab. */
export function defaultNetworkTab(family: ServerFamily | null | undefined): NetworkTab {
  const [first] = visibleNetworkTabs(family)
  return first === 'federated' ? 'local' : first
}

export function descriptorForNetworkTab(tab: NetworkTab): FeedDescriptor {
  // The Federated tab reads the existing Global source (v1 `MyNetwork`:
  // relabeled, internal endpoint names unchanged).
  return tab === 'federated' ? 'timeline|global' : `timeline|${tab}`
}

export function profileTabDescriptor(userId: string, tab: ProfileFeedTab): FeedDescriptor {
  return `user|${userId}|${tab}`
}

/**
 * How many items sit above the last-seen first id. First load (no baseline)
 * reports 0 — the list IS the baseline. A baseline the server no longer
 * returns means everything on screen is unseen.
 */
export function countNewItems(items: Array<{id: string}>, baselineFirstId: string | null): number {
  if (!baselineFirstId) return 0
  const idx = items.findIndex(i => i.id === baselineFirstId)
  return idx < 0 ? items.length : idx
}
