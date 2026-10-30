# 2026-10-29 — polish/3 widget core (Deliverable 3) — agent

Branch: `polish/3-widget-core` (cut from `polish/2-shell`; inherited tree
dirt left alone; never `git push`; nothing committed)
Goal: reusable widget architecture — separate types, instances,
placements/layouts, and renderer, persisted, with placeholder defaults
(`docs/visual-polish.md` Deliverable 3; no editor, no server data).

Did:

- Read `AGENTS.md`, `state/STATE.md`, polish-2 + polish-1 logs,
  `docs/visual-polish.md` (Deliverable 3 + no-gos), `docs/tasks/visual-polish.md`
  in order; confirmed branch `polish/2-shell`, cut `polish/3-widget-core`.
- Inspected the storage seam (`src/storage/index.ts`, `schema.ts`, `mmkv.ts`),
  the settings-store precedent (`src/state/feedPrefs.ts`: own key via
  `appStorage()`, `createXStore(storage)` factory, cached snapshot for
  `useSyncExternalStore`), the slice-2 rail (`src/state/widgetsPanel.ts`,
  `src/components/shell/WidgetsPanel.tsx`), the `__mocks__/react-native-mmkv.js`
  auto-mock (singleton store is test-safe), ALF `Heading`/`Body(color)` +
  `muted`/`faint`/`bgSoft`/`border` palette tokens, and the module-scope
  `msg` + `i18n._()` precedent (`src/screens/AdminInsight.tsx:57`).
- New `src/widgets/model.ts` (pure TS, no react/storage/rail): `WidgetInstance`
  `{id, type, settings}`, `WidgetPlacement` `{instanceId}`, `WidgetLayout`
  `{id, placements}` (array order = display order), `WidgetConfig`
  `{version, instances, layouts}` + `WIDGETS_CONFIG_VERSION = 1`,
  `RAIL_LAYOUT_ID = 'rail'`, `PLACEHOLDER_WIDGET_TYPE = 'placeholder'`,
  fixed default IDs `widget-placeholder-1/2`, `newWidgetId()` (`w`-prefixed,
  drafts-ID shape), and pure ops: `defaultWidgetsConfig`,
  `parseWidgetsConfig` (never throws; missing/corrupt/wrong-version →
  defaults; malformed *entries* dropped individually; unknown *types* kept;
  valid-but-empty returned as-is — never reseeds), `instancesForLayout`
  (ordered, skips dangling, missing layout → `[]`), `addWidgetInstance`
  (collision no-op), `removeWidgetPlacement` (layout-scoped; instance pruned
  only when unreferenced by every layout), `moveWidgetPlacement`
  (IDs/settings untouched, out-of-range no-op).
- New `src/widgets/registry.ts`: static `WidgetDefinition`
  `{type, title, description, Component}` (module-scope `msg` descriptors,
  `i18n._()` at call time), one `placeholder` entry, `get`/`list`/`isKnown`
  accessors. Imports widget components only — never `#/components/shell/*`.
- New `src/widgets/placeholder.tsx`: `PlaceholderWidget` (header `Widget` +
  muted `Nothing here yet.`, bordered `bgSoft` card, `testID="widget-<id>"`)
  + shared `WidgetFrame` card chrome. No fake data. No shell imports.
- New `src/widgets/WidgetRenderer.tsx`: host-agnostic resolver
  (instance → registry → component) + `UnknownWidgetFallback` (same frame,
  `This widget is unavailable.`). No rail sizing/ordering/persistence logic.
- New `src/widgets/store.ts`: `createWidgetsStore(storage = appStorage)`
  persisting JSON under new key `keystone.widgets` (no `STORAGE_VERSION` or
  `schema.ts` churn); lazy first-run seed (defaults served from memory, key
  stays absent until the first mutation, so "never configured" ≠ "user
  emptied"); `addWidget` (throws on unknown type, persists nothing),
  `removeWidget` (rail-scoped), `moveWidget` (rail index); `widgetsStore`
  singleton + `useWidgetsConfig` hook. Visibility state untouched
  (`src/state/widgetsPanel.ts` still in-memory, separate).
- `src/components/shell/WidgetsPanel.tsx`: body mounts
  `instancesForLayout(config, 'rail')` via `WidgetRenderer` inside
  `testID="widgets-panel-body"`. Rail imports renderer/store/model only —
  no widget component. Intentionally-emptied rail renders an empty body
  (empty-state UI with editor route is slice 4, not this slice).
- Tests: `src/widgets/model.test.ts` (21), `src/widgets/store.test.ts`
  (11: defaults/hydration/corrupt/version-fallback, add/remove/move,
  intentionally-empty survives reload, subscriber counts),
  `src/widgets/WidgetRenderer.test.tsx` (8: registry listing, standalone
  placeholder render with no rail mounted, no-fake-data pin, multi-instance
  identities, unknown-type fallback); rewrote the stale host-chrome-only
  case in `src/__tests__/shell-chrome.test.tsx` into a placement-order pin
  (two defaults in order via `within(body)` regex query + empty-body copy).
- Checked the box in `docs/tasks/visual-polish.md` step 3. Left
  `state/STATE.md` alone (coordinator owns it).

Decided (→ ADR or DECISIONS entry if load-bearing):

- None load-bearing (no ADR). Rationale recorded: own storage key
  (`keystone.widgets`, feedPrefs precedent) instead of extending the
  versioned device/account schema — avoids a `STORAGE_VERSION` migration
  for additive widget config; lazy in-memory seed instead of a `configured`
  flag — missing key vs valid-empty blob already distinguishes
  never-configured from user-emptied with no extra field; layout-scoped
  removal (not instance-scoped) per plan Deliverable 4 wording, so a future
  shared instance survives rail removal; unknown persisted types kept with
  a renderer fallback (never a config wipe).
- `intl:extract` NOT run (coordinator owns catalogs; slice-2 precedent):
  4 new msgids (`Widget`, `An empty placeholder. Real widgets will plug in
  here later.`, `Nothing here yet.`, `This widget is unavailable.`) render
  via English source until extraction. Slice 6 owns the sweep.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → clean, no output.
- `pnpm lint` (oxlint + eslint) → clean, no output.
- Touched suites: `model.test.ts` 21/21, `store.test.ts` 11/11,
  `WidgetRenderer.test.tsx` 8/8, `shell-chrome.test.tsx` 45/45,
  `widgetsPanel.test.ts` 8/8 — combined: 5 suites, 93 tests, all pass.
- Full `pnpm test` → `Test Suites: 13 failed, 286 passed, 299 total` /
  `Tests: 90 failed, 4125 passed, 4215 total`. The 13 suites / 90 tests are
  ALL the pre-existing content/link/richtext/post reds (content-ast,
  content-html, content-link-disclosure, linkpreview, linkpreview-policy,
  LinkCard, PostCard-privacy, body, body-tags, quotes, profileFields,
  richtext, richtext-wsb) — identical set to the slice-2/2026-10-28
  baseline (failures flat at 90; delta is exactly my +40 new tests, all
  green: 4175→4215 total, 4085→4125 passed). Confirmed via grep that none
  of the 13 failing files imports anything touched (zero hits for
  `#/widgets`, `shell/WidgetsPanel`, `widgetsPanel` outside
  `WidgetsPanel.tsx` itself). Zero slice-attributable failures.
- Device/web runs → `not verified` (rig servers owner-run; no push).
- `MODEL_SHAPE_HASH`/`SCHEMA_VERSION` untouched (no `packages/fedi`
  changes; `keystone.widgets` is a new additive key).

Deviations (files touched outside the slice + why):

- None. Touched only: `src/widgets/` (new: `model.ts`, `registry.ts`,
  `placeholder.tsx`, `WidgetRenderer.tsx`, `store.ts`, 3 test files),
  `src/components/shell/WidgetsPanel.tsx` (placement body),
  `src/__tests__/shell-chrome.test.tsx` (1 test rewritten),
  `docs/tasks/visual-polish.md` (checkbox), this log. All in-slice.

Next:

- Slice 4 (`polish/4-rail-editor`): editor dialog (open from rail "Edit
  widgets" entry point), add/remove/reorder via `widgetsStore`
  (`addWidget`/`removeWidget`/`moveWidget` already persist + notify),
  intentional-empty state with editor route, collapse-preserves-config pin.
- Slice 6 owns `pnpm intl:extract` for the 4 new msgids (+ 3 unextracted
  from slice 2).
- Bluesky reference paths consulted: none (in-repo precedents reused:
  feedPrefs store seam, drafts ID shape, AdminInsight module-scope `msg`).
