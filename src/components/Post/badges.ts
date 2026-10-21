// Post badges (v1 `NoteCard` parity, F15/F16): pinned, bookmarked,
// edited, server-filtered, and reaction-acceptance markers. Pure: the
// card renders what this returns, nothing else. Absent data means no
// badge — never a guessed label.
import {t} from '@lingui/macro'

// Locale boot (P5): see `menuModel.ts` — bare importers need the
// activated singleton before any `t` evaluates.
import '#/locale/i18n'

import {reactionAcceptanceLabel, type Post} from '@keystone/fedi'

export interface PostBadge {
  key: string
  label: string
}

export function badgesFor(post: Post): PostBadge[] {
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
  const acceptance = reactionAcceptanceLabel(post.ext.reactionAcceptance ?? null)
  if (acceptance) badges.push({key: 'reactions', label: acceptance})
  return badges
}
