# 2026-10-29 — polish/2 responsive desktop shell (Deliverable 2) — agent

Branch: `polish/2-shell` (cut from `polish/1-thread-order`; inherited tree
dirt left alone; never `git push`; nothing committed)
Goal: three-region desktop shell with fluid feed + independent side panels
(`docs/visual-polish.md` Deliverable 2).

Did:

- Read `AGENTS.md`, `state/STATE.md`, polish-1 log, `docs/visual-polish.md`
  (Deliverable 2 + no-gos), `docs/tasks/visual-polish.md` in order;
  confirmed branch `polish/1-thread-order`, cut `polish/2-shell`.
- Inspected `src/Navigation.tsx`, `src/components/shell/Sidebar.tsx`,
  `src/alf/breakpoints.ts`, `src/alf/tokens.ts`,
  `src/alf/useViewportWidth.ts`, `src/state/sideNav.ts`, existing
  shell/layout tests, X8.2 RightNav-removal history (`dc5ed5f`: stub was
  332px, web-only, width-gated — the size precedent reused below).
- `src/alf/tokens.ts`: added `butterflyPx.widgetsPanelWidth: 332`
  (300 content + 16/side, X8.2 precedent). No breakpoint added or changed.
- New `src/state/widgetsPanel.ts`: independent `auto | hidden` mode store
  mirroring `sideNav.ts` (module state, `useSyncExternalStore`, reset
  seam; in-memory, no disk — visibility stays separate from the widget
  configuration slices 3–4 will persist). Pure
  `autoWidgetsPanelVisible(width)` (three-region fit =
  `sidebarMin + mainColMax + widgetsPanelWidth` = 1152; mobile/rail/
  intermediate all fall below) + `shouldShowWidgetsPanel(width, mode)`.
- New `src/components/shell/WidgetsPanel.tsx`: `WidgetsPanel` host
  (region label + collapse, intentionally empty body — never fake data)
  and `WidgetsPanelRestore` trailing-edge restore control. No widget
  code imported (none exists); widget types must not import this file.
- `src/Navigation.tsx`: wires `useViewportWidth` +
  `shouldShowWidgetsPanel`; panel unmounts when hidden (zero layout
  width, no reserved column); restore mounts only where the panel would
  auto-show (narrow/mobile stay panel-free, mobile nav model preserved);
  feed max is fluid (`mainColMax` 600 beside the panel,
  `mainColMaxWide` 720 when hidden; `flex: 1` shrinks below either cap);
  added `testID="feed-column"`.
- Tests: new `src/state/widgetsPanel.test.ts` (8: threshold band,
  width rule, hidden pin, store round-trip, left/right independence);
  rewrote the stale `right-nav`-absence describe in
  `src/__tests__/shell-chrome.test.tsx` into 8 panel tests (mount at
  1280 + feed 600, rail-collapse keeps panel, hidden at 1050/800/390
  with no restore + feed 720, collapse→restore round-trip with feed
  720→600, toggle independence, host-chrome-only).
- Checked the box in `docs/tasks/visual-polish.md` step 2. Left
  `state/STATE.md` alone (coordinator owns it).

Decided (→ ADR or DECISIONS entry if load-bearing):

- None load-bearing (no ADR). Recorded rationale: fixed 1152 fit-sum
  instead of reusing the 1100 `layoutTwoCol` cut — 1100 would shrink the
  feed below its 600 max in the 1100–1151 band with the full sidebar,
  and a sidebar-width-dependent rule would let a sidebar toggle flip
  panel visibility (independence violation). The sum derives from
  existing tokens, so it is not a new breakpoint.
- `Widgets` header label + collapse/restore icons reuse `CollapseIcon`/
  `ExpandIcon` (sidebar chrome language). Three new user strings go
  through `t` macros per `keystone/no-literal-ui-string`; catalog
  extraction (`intl:extract`, 8 locale files) left for the owner/slice 6
  — missing entries fall back to English source, no test gates on it.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → clean, no output.
- `pnpm lint` (oxlint + eslint) → clean, no output.
- Touched suites: `widgetsPanel.test.ts` 8/8, `sideNav.test.ts`,
  `breakpoints.test.ts` green (combined: 3 suites, 22 tests pass);
  `shell-chrome.test.tsx` 45/45 pass.
- Full `pnpm test` → `Tests: 90 failed, 4085 passed, 4175 total`
  (13 unique failing suites). The 13 suites / 90 tests are ALL the
  pre-existing content/link/richtext/post reds (content-ast,
  content-html, content-link-disclosure, linkpreview,
  linkpreview-policy, LinkCard, PostCard-privacy, body, body-tags,
  quotes, profileFields, richtext, richtext-wsb) — identical set to the
  slice-1/2026-10-28 baseline (failures flat at 90; delta is exactly my
  +13 new tests, all green: 4162→4175 total, 4072→4085 passed).
  Confirmed via grep that none of the 13 failing files imports anything
  touched (`state/widgetsPanel`, `shell/WidgetsPanel`, `#/Navigation`
  → zero hits). Zero slice-attributable failures.
- `pnpm build-web` → success (`dist` exported, 3.4MB index bundle;
  `dist/` is gitignored). No browser available in this environment, so
  wide/intermediate/phone visual inspection is `not verified`.
- Device runs → `not verified` (rig servers owner-run; no push).
- `MODEL_SHAPE_HASH`/`SCHEMA_VERSION` untouched (no fedi changes).

Deviations (files touched outside the slice + why):

- None. Touched only: `src/alf/tokens.ts` (1 token),
  `src/Navigation.tsx`, `src/state/widgetsPanel.ts` (new),
  `src/components/shell/WidgetsPanel.tsx` (new),
  `src/state/widgetsPanel.test.ts` (new),
  `src/__tests__/shell-chrome.test.tsx`, `docs/tasks/visual-polish.md`
  (checkbox), this log. All in-slice (shell + layout tests).

Next:

- Slice 3 (`polish/3-widget-core`) mounts placements inside
  `WidgetsPanel`'s empty body; needs `intl:extract` for the 3 new
  strings if the owner wants catalogs before then; restore affordance
  placement is ripe for slice-5 polish review.
- Owner visual check `not verified`: wide (≥1152, panel mounts),
  intermediate (panel hidden, feed wide), phone (mobile model).
- Bluesky reference paths consulted: none (reused in-repo X8.2
  precedent instead).
