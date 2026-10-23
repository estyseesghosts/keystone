# 2026-10-22 — Centered variable feed + fixed widgets rail — agent

Branch: `p6.4-sidebar-reshuffle`
Trigger: owner — feed was fixed width while the widgets area grew;
want the feed variable-width and centered, widgets fixed-width.

## Did

- `src/Navigation.tsx`: `maincol` is now a full flex row child; the
  capped feed (`feedcol`, 600 / 720 wide max) centers inside it, so
  leftover space becomes symmetric L/R padding on large screens.
  `RightNav` is an explicit fixed 332 total. Widgets gate unchanged
  (`sidebar + 600 + 332`). Mobile keeps its 600 cap. The rail still
  hugs the left edge; the old feed-edge border moved with the inner
  column.

## Tests / verification

- `pnpm run typecheck` + `lint` clean; shell suites green; full suite
  green at commit time.
- Device/web runs → `not verified` (owner visual pass).
