# 2026-10-21 — W2 remainder (feed polish + honest deferrals) — agent

Branch: `main` (owner direction: main only, one commit per row-group)
Goal: close the W2 remainder from the handoff (F21, F22, F20-rest, MK8, F12-unfurl, F11-half).

## Did

- **F21 feed polish** (`src/screens/HomeFeed.tsx`, `src/state/queries/usePostFeedQuery.ts` + tests).
  - Cross-page dedupe: `feedItems` drops repeat ids across pages, keeping the newest occurrence.
  - Next-page retry: footer shows `feed-more-retry` (calls `fetchNextPage`) on `isFetchNextPageError`; spinner only while fetching.
  - Skeletons: initial load renders `FeedSkeleton` (avatar + bars, no animation dep) instead of a bare spinner.
  - Pill: tap scrolls the list to top (`FlatList` ref + `scrollToOffset`) then acknowledges.
  - Real bug found while testing: TanStack v5 marks the whole query `status: error` on a next-page failure (reducer sets `status: "error"`, data preserved). The old `if (feed.isError)` branch therefore wiped the loaded list on any next-page failure. Full-error screen now renders only with no data; verified by reducer read (`query.js:504-520`) + probe test.
- **Deferrals** (all in `docs/DECISIONS.md` 2026-10-21, none faked):
  - F22 → W4 (needs a `me` query that does not exist + backend block/mute lists; soft-mute stays the only filter).
  - MK8 remote-host emoji fallback stays unwired (store exists/tested in fedi; unknown remotes render literally).
  - F12 per-post client unfurl deliberately declined (cost); server `post.card` LinkCards done earlier.
  - F20 clips row → W5 (no dead UI); reply-insert → W3 C1/C6.
  - F11 profile/notification rows → W4 (cards via `DisplayName` done).
- Register (`docs/parity-gaps.md`): F21 done, F12 partial (server cards), F20 note; `docs/tasks/gap-closure.md` W2 marked done.

## Decided

- See DECISIONS rows above; no ADR (all workstream-scoped, no reversals).

## Tests / verification

- `node_modules/.bin/tsc -p tsconfig.check.ios.json` → clean (android/web in the W3 pass below).
- `node_modules/.bin/oxlint --quiet src/screens/HomeFeed.tsx src/screens/HomeFeed.test.tsx src/state/queries/usePostFeedQuery.ts src/state/queries/usePostFeedQuery.test.tsx` → clean.
- `NODE_ENV=test npx jest src/screens/HomeFeed.test.tsx src/state/queries/usePostFeedQuery.test.tsx` → 18/18 (new: dedupe, skeleton, footer retry, pill scroll/dismiss).
- Commits: `9d64aea` (F21), `7886481` (deferrals + register).
- Device/web: not verified in this slice (covered in the W3 pass the same day: Helium web shots at 3 widths).

## Deviations

- `src/screens/HomeFeed.test.tsx` gained a `feed-refresh` testID on the `RefreshControl` (test seam for the pill test, following the `postfeed.test.tsx` direct-prop pattern).

## v1 / reference paths consulted

- `frontend/src/components/TimelineFeed.tsx:119-176,224-257` (filter sets, dedupe, retry memory — via explore agent)
- `frontend/src/misskey/customEmoji.ts:67-73,91-156` (remote-host fallback design — deferred)
- `frontend/src/api/linkpreview.ts:1-14` (client unfurl cost basis)

## Next

1. W3 Composer & post actions (separate log `2026-10-21-w3-composer.md`).
2. W4 owns F22/MK1 (feed moderation) and F11-half.
3. W5 owns the F20 clips row; S4 owns live feed insert for the pill.
