# 2026-10-29 — polish/7 feed-column fill — agent

Branch: `polish/7-feed-fill` (cut from `polish/6-regression`)
Goal: stretch the desktop feed column to fill the dead L/R gutters in the owner's screenshot.

Did:

- `src/Navigation.tsx` — desktop `feed-column` no longer takes a `maxWidth`
  (removed the 600/720 `feedMaxWidth` cap; `flex: 1` + `width: 100%` fills
  everything between the sidebar and the widgets panel). Mobile keeps the
  600 cap (`maincolMobile`). Comments updated; duplicate-`stripVisible`
  self-inflicted during the edit, fixed before the gate.
- `src/__tests__/shell-chrome.test.tsx` — the six desktop `feedMaxWidth()`
  pins now assert `undefined` (no cap); titles updated (600-cap / wide-cap
  wording → fill wording). Mobile behavior untouched.

Decided:

- Unbounded desktop feed is what the owner asked for; the sidebar +
  widgets panel bound it in practice. `butterflyPx.mainColMaxWide` (720)
  is now unused — left in place, one-line cleanup if it stays unused.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → clean, no output.
- `pnpm lint` → clean, no output.
- `NODE_ENV=test npx jest src/__tests__/shell-chrome.test.tsx` → 45/45 pass.
- `pnpm test` → 302 suites (289 pass, 13 fail) / 4243 tests (4153 pass,
  90 fail) — failing set is exactly the 13 pre-existing content/
  linkpreview/richtext/post suites, unchanged from the program baseline.
  Zero new failures.
- Web/device runs → `not verified` (owner checks the screenshot layout).

Deviations (files touched outside the slice + why):

- None. `Navigation.tsx` + its test only.

Next:

- Owner reloads the wide window and confirms the gutters are gone.
- Merge decision for the `polish/*` chain stays with the owner.
