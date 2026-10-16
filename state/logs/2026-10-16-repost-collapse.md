# 2026-10-16 — Repost collapsing in feeds

Owner request: when a post and its repost(s) share a feed, hide the
original and show only the first repost, with the banner aggregating
renoters ("xx and yy reposted", "xx, yy, zz and 3 others reposted"…).

## What changed (`frontend/` only)

- `src/components/TimelineFeed.tsx`: a `collapse` memo groups loaded
  items by effective target (a pure wrapper's `renoteId`, which survives
  even a deleted/unpacked original; otherwise the item's own id). The
  first pure repost in feed order displaces the original as the group's
  representative; renoters accumulate deduped by user id. Quotes never
  group (own commentary, own ids). The raw `notes` array is untouched
  (paging cursors, stream dedupe, reconciliation all use it); the memo
  only gates row visibility and supplies banner names, so `<For>` row
  identity is stable and no card remounts on collapse changes.
- `src/components/NoteCard.tsx`: new optional `renoters` prop + a
  `RepostBanner` naming up to three linked renoters ("xx reposted",
  "xx and yy reposted", "xx, yy and zz reposted",
  "xx, yy, zz and N others reposted"); falls back to the wrapper author
  for single reposts and non-feed contexts (note detail, profile, search,
  notifications unchanged).
- `docs/frontend-plan.md`: Slice 3 bullet records the behavior.

## Deliberately out of scope

Profile / search / note-detail reply lists render `NoteCard` directly
with no collapse (different contexts, no shared-target clutter problem);
antenna feeds ride on `TimelineFeed` so they collapse automatically.

## Evidence

- `tsc --noEmit` clean, `npm run build` green.
- `collapseReposts` unit checks against the real function: **16/16**
  (`/tmp/opencode/quote_test/collapse_entry.ts` — original+wrapper,
  order-independence, multi-wrapper naming order, dup-user dedupe, quotes
  untouched, deleted-target grouping, input immutability).
- Visual confirmation **not yet verified** (no browser here) — owner rig.
