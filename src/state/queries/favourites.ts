// Favourites mosaic (P6.6 slice 3, DC-3/DC-4): newest favourited first.
// Reads the shared bookmarks feed (`usePostFeedQuery`, its own
// `post-feed` key — never under clips). No new query module state.

import {useMemo} from 'react';

import {collectMosaic} from '@keystone/fedi';

import type {Backend} from '@keystone/fedi';

import {usePostFeedQuery} from './usePostFeedQuery';
import type {ClipMosaic} from './clips';

/**
 * Mosaic source for the pinned Favourites folder: the newest favourited
 * posts. Suspends (returns null images) until the first bookmarks page
 * lands; callers render the folder tile regardless.
 */
export function useFavouritesMosaic(
  sessionId: string | null,
  options: {backend?: Backend | null} = {},
): ClipMosaic & {isPending: boolean} {
  const feed = usePostFeedQuery(
    sessionId,
    'bookmarks',
    options.backend
      ? {limit: 10, retry: false, backend: options.backend}
      : {limit: 10, retry: false},
  );
  const images = useMemo(() => {
    const posts = (feed.data?.pages ?? []).flatMap(p => p.items);
    return collectMosaic(posts);
  }, [feed.data]);
  return {images, isPending: feed.isPending};
}
