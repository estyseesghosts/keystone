# 2026-10-22 — Shared skeletons rollout — agent

Branch: `p6.4-sidebar-reshuffle`
Trigger: owner — skeleton loaders look awkward + redundant spinner;
make them consistent across content types/feeds.

## Did

- New `src/components/Skeleton.tsx`: `SkeletonList` with four variants
  (`post`: avatar + name/text lines + action dots; `account`: avatar +
  name/handle; `row`: title + two sublines; `card`: 112 thumb + title
  lines), hairline separators between rows, static Views only
  (reduced-motion safe). `Skeleton.test.tsx` pins variants/counts.
- `HomeFeed` initial load uses the shared post list (5 rows); the
  redundant spinner underneath is gone (`HomeFeed.test` asserts its
  absence). Inline spinners (load-more, refresh, busy buttons) stay.
- Rolled out to every full-screen initial load under the same testIDs
  (tests unchanged): Explore users/tags(`row`)/accounts(`account`)/
  news(`card`); Channels/Lists/Clips/Antennas(`row`); Conversations/
  Followers/Following/FollowRequests/Notifications/User(`account`);
  Conversation/ChatRooms/NoteHistory/Drive(`row`); Channel/Antenna/
  List/Clip detail + thread view(`post`); Announcements(`row`).
  Untouched: inline loaders, `PostFeed` legacy component (tests only),
  Tag (rides FeedView), ChatRoom (no full-screen loader).

## Tests / verification

- `pnpm run typecheck` (ios+android+web) → clean
- `pnpm run lint` → clean
- targeted suites green; full suite → 191/2399 (rerun green after
  an earlier single flaky failure)

## Next

- Owner visual pass on real content shapes
