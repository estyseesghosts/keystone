# 2026-10-29 — polish/5 navigation + interaction polish (Deliverable 5) — agent

Branch: `polish/5-nav-polish` (cut from `polish/4-rail-editor`; inherited
tree dirt left alone; never `git push`; nothing committed — several files
I edited share content with uncommitted P6.5-chain/slice-2–4 work, so not
cleanly separable)
Goal: navigation + interaction polish — consistent hover/active/focus
states, tooltips on icon-only chrome, group separation, no new
destinations or route changes (`docs/visual-polish.md` Deliverable 5).

Did:

- Read `AGENTS.md`, `state/STATE.md`, polish-4 log (tooltip candidates:
  rail edit/collapse/restore, editor move/remove), `docs/visual-polish.md`
  Deliverable 5 + no-gos, `docs/tasks/visual-polish.md` in order;
  confirmed branch `polish/4-rail-editor`, cut `polish/5-nav-polish`.
- Audit: shell chrome (`Sidebar`, `TabBar`, `MobileStrip`,
  `AccountMenu` trigger, `Pagehead`, `WidgetsPanel`) used raw RN
  `Pressable` — no hover feedback, no visible keyboard focus. Post
  `ActionBar`, `Menu`, `PopupRow`, `Tabs`, `Button`, `WidgetsEditor`
  already use the shared `#/components/Pressable` (hover dim + pressed
  + web focus ring). No tooltip primitive exists anywhere in
  `src/components/` (`Popup` is an anchored menu card, not hover text);
  verified `react-native-web@0.21.4` does NOT forward a `title` prop on
  `View`/`Pressable` (`forwardedProps` has no `title` entry), so tooltips
  need a real DOM node. Profile `HoverPreview` + `MatrixHover` infra
  reviewed and deliberately NOT reused for tooltips (400ms hovercards
  for icon buttons would be heavyweight and cover-adjacent).
- New `src/components/Tooltip.tsx`: web-only wrapper rendering
  `<span title={label} style={{display: 'contents'}}>`. Browser-native
  tooltip: never covers the control, never steals clicks. `display:
  contents` keeps the span out of flex layout (verified: rail/full
  sidebar, strip, pagehead, rail header all keep layout; existing
  testIDs/trees unchanged). Native renders children alone — touch +
  keyboard complete via the pre-existing accessibility labels, which
  remain the source of truth (tooltip mirrors them). Span is the only
  `<span>` in prod `src/` (checked).
- `Sidebar.tsx`: raw→shared `Pressable` everywhere (hover/focus/pressed
  free); rail icon-only rows (feeds, collections, Pages stub, Post,
  quick actions, sign-in) + expand/collapse toggles wrapped in `Tooltip`
  (full-mode labeled rows untouched — no redundant tips); footer quick
  actions now carry active/selected state like nav rows (notifications
  via `isTabFocused`, messages via stack-leaf match, settings→
  `Settings`, uploads→`Drive`; fg inverts with the pill); group
  separation `sideGroup` 28→`space['2xl']` (padding-only, no dividers —
  reshuffle decision stands) + `quickRail` gap `space.xs`.
- `TabBar.tsx`, `MobileStrip.tsx`, `AccountMenu.tsx` (trigger only),
  `Pagehead.tsx`: raw→shared `Pressable`; tooltips on icon-only
  controls (strip back, pagehead back, account avatar trigger).
  Labeled tabs/buttons unchanged. `hitSlop={12}` passes through the
  shared Pressable (spread wins over its default 8).
- `WidgetsPanel.tsx`: tooltips on edit/collapse/restore (already shared
  `Pressable`). Slice-2 restore-placement review outcome: trailing-edge
  slot stays (mounts only where the panel would auto-show — no reserved
  column, no IA change); the tooltip is the polish it needed.
- Editor move/remove/add buttons: text-labeled, self-identifying — no
  tooltips (recorded; slice-4 candidates resolved as rail-only).
- Tests: new `src/components/shell/nav-polish.test.tsx` (11): Tooltip
  web span / native passthrough; rail edit/collapse/restore titles +
  a11y-label parity; native no-wrapper; editor no-tooltip pin; rail
  expand/sign-in/feed titles; full-sidebar collapse-only tooltip;
  signed-in rail notifications-selected + messages-unselected; full
  messages-selected; `MatrixHovercard` regression (handle + copy render,
  no Tooltip inside). Test note: `UNSAFE_queryAllByProps` does exact
  prop matching only (no asymmetric matchers) AND matches composite
  `title` props (closed editor `Dialog`) — helpers query host `span`
  type instead.
- Checked the box in `docs/tasks/visual-polish.md`. Left
  `state/STATE.md` alone (coordinator owns it).

Decided (→ ADR or DECISIONS entry if load-bearing):

- None load-bearing (no ADR). Rationale recorded: browser-native
  `title` tooltip over a `HoverLayer`-based custom tip — zero new deps,
  zero JS behavior, acceptance ("do not cover the control", "no
  hover-only action") holds by construction; custom card would add
  timers/portal surface for no gain. No `intl:extract` impact: every
  tooltip label reuses a pre-existing msgid — zero new msgids
  (extraction burden stays ~15 pending for slice 6).

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → clean, no output.
- `pnpm lint` (oxlint + eslint) → clean, no output.
- Touched suites: `nav-polish.test.tsx` 11/11 pass; neighbors
  (`shell-chrome`, `TabBar`, `WidgetsEditor`, `src/widgets`,
  `HoverPreview`, `UserHoverCard`, `AccountSwitcher`, `Button`) →
  10 suites, 141 tests, all pass.
- Full `pnpm test` → `Test Suites: 13 failed, 288 passed, 301 total` /
  `Tests: 90 failed, 4146 passed, 4236 total`. The 13 suites / 90 tests
  are ALL the pre-existing content/link/richtext/post reds
  (content-ast, content-html, content-link-disclosure,
  linkpreview-policy, linkpreview, LinkCard, PostCard-privacy,
  body-tags, body, quotes, profileFields, richtext, richtext-wsb) —
  identical set to the slice-4/2026-10-28 baseline (failures flat at
  90; delta is exactly my +11 new tests, all green: 4225→4236 total,
  4135→4146 passed). Confirmed via grep that none of the 13 failing
  files (nor LinkCard) imports anything touched (zero hits for
  `Tooltip`, `shell/Sidebar`, `shell/TabBar`, `shell/AccountMenu`,
  `shell/WidgetsPanel`, `Pagehead`, `shell/MobileStrip`).
- Device/web runs → `not verified` (rig servers owner-run; no push).
  Owner to eyeball in slice 6: tooltip dwell on rail icons (web),
  inverted-pill active on rail quick actions (both themes), focus-ring
  visibility on keyboard Tab through sidebar/chrome (web), group gap
  28→32.
- `MODEL_SHAPE_HASH`/`SCHEMA_VERSION` untouched (no `packages/fedi`
  changes by me; `packages/fedi` tree dirt is inherited P6.5-chain
  work, not mine).

Deviations (files touched outside the slice + why):

- None. Touched only: `src/components/Tooltip.tsx` (new),
  `src/components/shell/nav-polish.test.tsx` (new),
  `src/components/shell/Sidebar.tsx`, `TabBar.tsx`, `MobileStrip.tsx`,
  `AccountMenu.tsx`, `WidgetsPanel.tsx`, `src/components/Pagehead.tsx`
  (all shell/nav/widget-chrome — in-slice), `docs/tasks/visual-polish.md`
  (checkbox), this log. No new dependencies. Note: `TabBar.tsx`,
  `Sidebar.tsx` (and possibly others) carried pre-existing uncommitted
  P6.5-chain modifications (e.g. TabBar `BellTab`); my edits layer on
  top — nothing committed, separability is the owner's call at merge.

Next:

- Slice 6 (`polish/6-regression`): `pnpm intl:extract` (~15 pending
  msgids, none mine) + web/device verification (tooltips, focus rings,
  rail quick-action active pill, group gap) + combined pass.
- Audit backlog DEFERRED (out of slice surface, tracked here):
  1. `Post/ActionBar.tsx:269` raw `RNPressable` (⋯ menu area) +
     `Note.tsx:637` + `ProfileEditor.tsx` raw Pressables → shared
     Pressable + tooltip review.
  2. `ToastHost.tsx` raw Pressable dismiss → shared Pressable.
  3. Post-action icon buttons (reply/repost/like/react) have counts,
     not tooltips — review whether counts suffice (likely yes; record).
  4. `Menu` custom-trigger path + `PopupRow` are shared-Pressable
     based ✓ but have no hover-title story — fine (labeled rows).
  5. Hovercard delays/content untouched — any hovercard visual polish
     is a separate product decision, not D5.
- Bluesky reference paths consulted: none (in-repo `Pressable` +
  `HoverPreview` raw-DOM precedent reused; RNW `forwardedProps` source
  inspected to rule out the `title`-passthrough shortcut).
