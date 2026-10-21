// Post badges (v1 `NoteCard` parity, F15/F16): pinned, bookmarked,
// edited, server-filtered, and reaction-acceptance markers. Pure: the
// card renders what this returns, nothing else. Absent data means no
// badge — never a guessed label.
import {reactionAcceptanceLabel, type Post} from '@keystone/fedi'

export interface PostBadge {
  key: string
  label: string
}

export function badgesFor(post: Post): PostBadge[] {
  const badges: PostBadge[] = []
  if (post.pinned) badges.push({key: 'pinned', label: 'Pinned'})
  if (post.ext.bookmarked === true) badges.push({key: 'bookmarked', label: 'Bookmarked'})
  if (post.editedAt !== null) badges.push({key: 'edited', label: 'Edited'})
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
