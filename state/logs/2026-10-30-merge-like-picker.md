# 2026-10-30 — merge like-button + picker groups to main + push — agent

Branch: `main` (only branch left after prune)
Goal: owner-ordered commit + merge + prune + push of both slices.

Did:

- Full suite pre-merge: 305 suites / 4278 tests, 4188 pass, 90 fail —
  failing set is exactly the 13 known pre-existing suites
  (content/linkpreview/richtext/post families). First full run showed
  93 fail / 14 suites: the extra was MY regression
  (`CustomGroupsRow` called `useCustomEmojis` unconditionally, crashing
  provider-less `Settings.test.tsx` trees with "No QueryClient set").
  Fixed with the repo's guard pattern (`QueryClientContext` check in an
  outer component, query read in the inner — same as
  `NotificationsBadgeHost`); targeted Settings suites green, second
  full run flat at 90. Zero attributable failures.
- Split commits on `feat/emoji-picker-groups` (files disjoint):
  `2264634` like-button slice, `ae638e4` picker slice (incl. v1/v2
  reference PNGs + regenerated catalogs), bookkeeping commit (STATE,
  task index + flips, DECISIONS, this log).
- Merged to `main` (fast-forward — main had not moved), pruned
  `fix/like-button-liked-state` + `feat/emoji-picker-groups` with -d,
  pushed `main` to `origin` (github). First push of this repo from an
  agent session; standing "never push" overridden by explicit owner
  order for this operation only.

Tests / verification (paste commands + results):

- `pnpm test` (final, pre-merge) → 305/4278, 90 fail = known set.
  Log: `/tmp/fullsuite3.log`.
- `pnpm typecheck` (ios+android+web) + `pnpm lint` → clean (both slices).
- `git status --porcelain` → clean; `git branch` → `* main`;
  `git log --oneline -4` shows the two slice commits + bookkeeping on main.

Next (unchanged owner items):

- Web visual checks: like-button custom-like pill; picker
  collapse/pin/hide/right-click; earlier Home socket-kill + rec-feed
  hands-off repros.
- 25 device checks + 12 rig live-checks; release track out of scope.
