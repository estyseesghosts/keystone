// Stable attachment alt text (moved from the deleted legacy
// `src/components/MediaGrid.tsx`, repair X7.3 step 5). Shared by the feed
// grid and the Lightbox: the description wins, otherwise a generated
// label with the position and file name — never the bare `item.kind`.
import type {Media} from '@keystone/fedi'

function altFor(item: Media, index: number): string {
  const label = item.description?.trim()
  if (label) return label
  const kindWord =
    item.kind === 'video' || item.kind === 'gifv'
      ? 'Video'
      : item.kind === 'audio'
        ? 'Audio'
        : item.kind === 'file'
          ? 'File'
          : 'Image'
  return `${kindWord} attachment ${index + 1}${item.name ? `: ${item.name}` : ''}`
}

/** Stable alt-text helper shared by `<PostMediaGrid>` and `<Lightbox>`. Pure. */
export function mediaAlt(item: Media, index: number): string {
  return altFor(item, index)
}
