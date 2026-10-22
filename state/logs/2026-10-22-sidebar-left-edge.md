# 2026-10-22 — Sidebar left-edge gap (dead-space screenshot) — agent

Branch: `p6.4-sidebar-reshuffle`
Trigger: `docs/sidebar-dead-space.png` — dead space between the rail and
the window's left edge.

## What happened

- First misread the screenshot as uneven *group* spacing and shipped a
  rail-only group-gap tweak (`52110ba`). Owner corrected: the issue is the
  left gutter, not group rhythm. **Reverted** via `git reset --hard HEAD~1`
  (unpublished branch; revert commit `52110ba` dropped, history clean).
- Actual cause: `shellRow.justifyContent: 'center'` centered the whole
  `[sidebar | maincol]` block, so every window wider than rail (68) +
  feed max (600) grew symmetric dead gutters — including between the rail
  and the left edge.
- Fix (`c0ea945`): `shellRow` → `justifyContent: 'flex-start'`. The
  sidebar now hugs x=0; slack accumulates on the right (past the feed
  max / RightNav). No test pinned the old centering.

## Tests / verification

- `pnpm run typecheck` (ios+android+web) → clean
- `pnpm run lint` → clean
- `shell-chrome` + `nav` suites → 49 green
- Device/web runs → `not verified` (owner visual pass pending — please
  confirm the rail now sits at the left edge at ~800px and full widths)
