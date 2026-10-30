# 2026-10-29 — polish/4 rail + editor (Deliverable 4) — agent

Branch: `polish/4-rail-editor` (cut from `polish/3-widget-core`; inherited
tree dirt left alone; never `git push`; nothing committed — my
`WidgetsPanel.tsx` edit shares a file with uncommitted slice-2/3 content,
so not cleanly separable)
Goal: widget rail + editor interactions — defaults, edit entry, intentional
empty state, add/remove/reorder, persistence flow (`docs/visual-polish.md`
Deliverable 4; no server data, no deck UI, no visual polish).

Did:

- Read `AGENTS.md`, `state/STATE.md`, polish-3 log (APIs: `addWidget`/
  `removeWidget`/`moveWidget`, `listWidgetDefinitions()`, bare-empty rail
  body, 7 unextracted msgids), `docs/visual-polish.md` Deliverable 4 +
  no-gos, `docs/tasks/visual-polish.md` in order; confirmed branch
  `polish/3-widget-core`, cut `polish/4-rail-editor`.
- Inspected `src/widgets/` (model/registry/store/renderer), `WidgetsPanel`,
  `Dialog` (only dialog primitive; bottom sheets deferred), `Popup`
  (anchored-card only, no list-DnD), `Button` (compact secondary for dense
  rows), shared `Pressable` (hover/focus-ring built in), existing
  `Dialog open + testID` precedent (`ProfileActions`, `components.test.tsx`
  harness), `PencilIcon` in `#/components/icons`.
- New `src/components/shell/WidgetsEditor.tsx`: `Dialog`-based editor
  (`testID="widgets-editor"`), optional `store` prop defaulting to the
  singleton (test seam, prod unchanged). Current instances in placement
  order with per-row move-up/move-down (end-disabled) + remove; available
  types from `listWidgetDefinitions()` with add; registry titles via
  `useI18n` + `msg` descriptors, unknown types fall back to `Widget`.
  Shell-level only: never imports widget components.
- `src/components/shell/WidgetsPanel.tsx`: header gains an Edit entry
  (`widgets-panel-edit`, `PencilIcon`, `Edit widgets` label) beside
  collapse; body is now a `ScrollView` (`widgets-panel-body`, `flex: 1` —
  scrolls inside the sticky-`100vh` rail on web, sibling to the feed column
  so feed scroll is unaffected); intentionally-emptied rail renders
  `widgets-panel-empty` (`No widgets yet.` + `Edit widgets` route button);
  editor open state is local `useState` (separate from config and from
  `widgetsPanel` visibility); RN `Pressable` swapped to the shared
  `#/components/Pressable` (codebase convention: hover/focus built in,
  supplemental only); collapse/restore controls untouched. Additive
  optional `store` prop for tests.
- Tests: new `src/components/shell/WidgetsEditor.test.tsx` (10, isolated
  memory stores — singleton never mutated): fresh → exactly two
  placeholders; edit entry opens editor with instances + available types;
  add third (unique stable ID, appended); move-up reorder keeps IDs and
  settings identical + end-buttons disabled; remove keeps order; close
  changes nothing (config ≠ open state); remove-all → empty state with
  editor route → reload over same storage stays empty; hide/show leaves
  arrangement unchanged; body is a `ScrollView`.
- Checked the box in `docs/tasks/visual-polish.md` step 4. Left
  `state/STATE.md` alone (coordinator owns it).

Decided (→ ADR or DECISIONS entry if load-bearing):

- None load-bearing (no ADR). Rationale recorded: buttons-only reorder, no
  DnD dependency — `src/` has zero `PanResponder`/gesture/reanimated usage
  (`react-native-gesture-handler` + `reanimated` sit unused in
  `package.json`; no sortable-list primitive exists in the tree), so there
  is no "existing cross-platform primitive" to reuse; the plan mandates an
  accessible non-drag method regardless and makes drag optional ("where
  supported"), so move-up/move-down satisfies Deliverable 4 alone.
- `intl:extract` NOT run (coordinator owns catalogs; slices 2–3
  precedent): 8 new msgids (`Edit widgets`, `Collapse widgets panel`,
  `Current widgets`, `No widgets yet. Add one below.`, `Move up`,
  `Move down`, `Remove`, `Add`, `Add widgets`, `No widgets yet.` — static
  `t` + `msg` forms) render via English source until extraction. Slice 6
  owns the sweep (now ~15 msgids pending total).

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → clean, no output.
- `pnpm lint` (oxlint + eslint) → clean, no output.
- Touched suites: `WidgetsEditor.test.tsx` 10/10 pass; neighbors
  `shell-chrome.test.tsx` + `src/widgets` + `src/state` → 43 suites, 623
  tests, all pass.
- Full `pnpm test` → `Test Suites: 13 failed, 287 passed, 300 total` /
  `Tests: 90 failed, 4135 passed, 4225 total`. The 13 suites / 90 tests are
  ALL the pre-existing content/link/richtext/post reds (content-ast,
  content-html, content-link-disclosure, linkpreview, linkpreview-policy,
  LinkCard, PostCard-privacy, body, body-tags, quotes, profileFields,
  richtext, richtext-wsb) — identical set to the slice-3/2026-10-28
  baseline (failures flat at 90; delta is exactly my +10 new tests, all
  green: 4215→4225 total, 4125→4135 passed). Confirmed via grep that none
  of the 13 failing files (nor `LinkCard.tsx`) imports anything touched
  (zero hits for `#/widgets`, `shell/WidgetsPanel`, `shell/WidgetsEditor`,
  `state/widgetsPanel`).
- Device/web runs → `not verified` (rig servers owner-run; no push).
  Rail `ScrollView`-in-sticky-rail and Dialog-on-native editor layout are
  structural only — owner to eyeball on web + device in slice 6.
- `MODEL_SHAPE_HASH`/`SCHEMA_VERSION` untouched (no `packages/fedi`
  changes; no model/store shape changes — `WIDGETS_CONFIG_VERSION` still 1).

Deviations (files touched outside the slice + why):

- None. Touched only: `src/components/shell/WidgetsEditor.tsx` (new),
  `src/components/shell/WidgetsEditor.test.tsx` (new),
  `src/components/shell/WidgetsPanel.tsx` (rail chrome/body — in-slice),
  `docs/tasks/visual-polish.md` (checkbox), this log. No prod changes
  outside the rail/editor; no new dependencies.

Next:

- Slice 5 (`polish/5-nav-polish`): hover/focus/active states, tooltips for
  icon-only controls (rail edit/collapse/restore + editor move/remove are
  candidates — they have accessible labels but no tooltips), group
  separation. Must not change widget config shapes.
- Slice 6 owns `pnpm intl:extract` (~15 pending msgids) + web/device
  verification (rail scroll, editor dialog on native, keyboard traversal).
- Bluesky reference paths consulted: none (in-repo precedents reused:
  `Dialog` + `Button compact` + shared `Pressable`, feedPrefs store seam).
