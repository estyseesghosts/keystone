// Post badges (v1 `NoteCard` parity, F15/F16): pinned, bookmarked,
// edited, server-filtered, soft-muted, and reaction-acceptance markers.
// Pure: the card renders what this returns, nothing else. Absent data
// means no badge — never a guessed label.
import {t} from '@lingui/macro'

// Locale boot (P5): see `menuModel.ts` — bare importers need the
// activated singleton before any `t` evaluates.
import '#/locale/i18n'

import {reactionAcceptanceLabel, type Post} from '@keystone/fedi'

export interface PostBadge {
  key: string
  label: string
}

export interface BadgeOptions {
  /** The viewer soft-muted the note's (rendered) author, yet the note is
   * still on screen — a thread, a profile, a notification. Feeds drop
   * these rows instead, so the badge is the honest signal elsewhere.
   * The caller supplies it (the live card reads the per-session mute
   * store); this module reads no stores and never guesses: omitted or
   * false means no badge. */
  softMuted?: boolean
}

export function badgesFor(post: Post, options: BadgeOptions = {}): PostBadge[] {
  const badges: PostBadge[] = []
  if (post.pinned) badges.push({key: 'pinned', label: t`Pinned`})
  if (post.ext.bookmarked === true) badges.push({key: 'bookmarked', label: t`Bookmarked`})
  if (post.editedAt !== null) badges.push({key: 'edited', label: t`Edited`})
  const [firstFilter] = post.filtered
  if (firstFilter) {
    badges.push({
      key: 'filtered',
      label:
        post.filtered.length > 1
          ? `Filtered: ${firstFilter.title} +${post.filtered.length - 1}`
          : `Filtered: ${firstFilter.title}`,
    })
  }
  // Moderation marker, next to the server-filter one: this note is
  // visible but its author is on the viewer's soft-mute list.
  if (options.softMuted === true) badges.push({key: 'softMuted', label: t`Soft-muted`})
  const acceptance = reactionAcceptanceLabel(post.ext.reactionAcceptance ?? null)
  if (acceptance) badges.push({key: 'reactions', label: acceptance})
  return badges
}
