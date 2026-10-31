# 2026-10-31 — Pages section layout (follow-up) — agent

Branch: `feat/page-editor-cards`
Goal: pages content reads centered instead of stretched, and the page
writer has no widgets rail at all (owner: not collapsed — gone). The
pages index and page reader keep the rail.

## Did

- `src/Navigation.tsx`:
  - `pagesSection` (`Pages`, `Page`, `PageEdit`): the feed column is
    capped at `butterflyPx.mainColMaxWide` (720) and centered by the
    existing `alignItems: center` on the desktop main column; the
    column's end divider is dropped while capped so no line floats in
    the gutter (the rail keeps its own `borderStartWidth`).
  - `pagesWriter` (`PageEdit`): `widgetsVisible` is forced false and the
    restore affordance is suppressed too — the rail is unmounted
    entirely, not collapsed. Pages index + page reader keep the rail
    (owner revision: only the writer loses it).
- `src/__tests__/shell-chrome.test.tsx`: stub mocks for the three pages
  routes + a "pages section layout" describe — index and reader keep
  `widgets-panel` with the capped column; the writer has neither panel
  nor restore button and the capped column; other routes unchanged.

## Tests / verification

- `pnpm typecheck` (ios+android+web) → clean
- `pnpm lint` → clean
- Targeted: `src/__tests__/shell-chrome.test.tsx` → 49/49.
- Full `pnpm test` → 332 suites / 4525 tests: 4435 pass, **90 fail —
  the pre-existing content/linkpreview/richtext/post set (13 suites)**.
  Flat (4 new tests).
- Device/web visual check: `not verified` (owner item).

Note: the shell suite needs `--forceExit` (repo `pnpm test` script) or
jest hangs on open handles.

## Deviations

- `docs/DECISIONS.md` (PEC-5), `docs/tasks/feat-page-editor-cards.md`,
  `state/*` — bookkeeping.

## Next

- Owner visual check: Pages index/reader with the rail, writer without
  it and centered, normal feeds unchanged.
- Merge `feat/page-editor-cards` to `main` after approval.
