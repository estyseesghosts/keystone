# Visual polish + widgets

Plan ref: `docs/visual-polish.md` (authoritative for scope, acceptance, no-gos)
Status: in progress
Branch chain: `p6.5-unread-counter` → `polish/1-thread-order` → `polish/2-shell`
→ `polish/3-widget-core` → `polish/4-rail-editor` → `polish/5-nav-polish`
→ `polish/6-regression`

## Goal

Desktop shell polish, chronological reply chains, and a rail-independent
reusable widget system with editor — without changing visual identity or
connecting widgets to server APIs.

## Read first

- `docs/visual-polish.md` (all six deliverables + no-gos)
- `AGENTS.md` §2 (state protocol), §4 (ADRs), §5 (work rules), §6–§7

## Steps

- [x] 1. Thread ordering (Deliverable 1) — `polish/1-thread-order` (done 2026-10-29: no inversion reproduced — Slice B `chronological()` already correct at all four read sites; added 7 regression tests pinning A→B→C order, Mastodon-order parity, 3-level sibling reveal, ancestor order, feed newest-first; zero prod changes; see `state/logs/2026-10-29-polish-1-thread-order.md`)
- [x] 2. Responsive shell (Deliverable 2) — `polish/2-shell` (done 2026-10-29: independent `auto|hidden` widgets-panel mode + host-only `WidgetsPanel` (empty body, collapse/restore); auto-show at three-region fit 1152 = 220+600+332, hidden below (mobile/rail/intermediate), unmounted when hidden; feed fluid 600 beside panel / 720 when hidden; +13 tests — 8 state unit + 8 shell-chrome replacing 3 stale absence pins; typecheck+lint clean, full-suite failures flat at pre-existing 90; web build exports, visual inspection not verified; see `state/logs/2026-10-29-polish-2-shell.md`)
- [x] 3. Widget core: registry/renderer/persistence (Deliverable 3) — `polish/3-widget-core` (done 2026-10-29: rail-independent `src/widgets/` — pure serializable model/instances/placements/layouts, static type registry with one placeholder type, host-agnostic `WidgetRenderer` + unknown-type fallback, `keystone.widgets` persisted store with lazy first-run seed and intentionally-empty support; placements mounted in `WidgetsPanel` body; +40 tests — 21 model + 11 store + 8 renderer, 1 shell-chrome test rewritten to pin placement order; typecheck+lint clean, full-suite failures flat at pre-existing 90; `intl:extract` left for owner/slice 6; see `state/logs/2026-10-29-polish-3-widget-core.md`)
- [x] 4. Rail + editor interactions (Deliverable 4) — `polish/4-rail-editor` (done 2026-10-29: `Dialog`-based `WidgetsEditor` opened from rail "Edit widgets" entry (header pencil) + empty-state route; current instances in placement order with accessible move-up/move-down (end-disabled) + remove, available types from registry with add; rail body is a `ScrollView`, intentional empty state when emptied; editor open state local to rail, visibility untouched, config via existing store; buttons-only reorder — no DnD primitive in `src/`, no new dep; +10 tests driving the plan acceptance flow; typecheck+lint clean, full-suite failures flat at pre-existing 90; `intl:extract` left for slice 6; see `state/logs/2026-10-29-polish-4-rail-editor.md`)
- [x] 5. Navigation/interaction polish (Deliverable 5) — `polish/5-nav-polish` (done 2026-10-29: new web-only `Tooltip` (`title`-on-`display:contents`-span; native renders children alone); rail icon-only chrome tooltip-named (sidebar rows/expand/collapse/post/quick-actions/sign-in, widgets edit/collapse/restore, strip + pagehead back, account trigger); shell chrome moved to shared `Pressable` (hover dim + pressed + web focus ring: Sidebar/TabBar/MobileStrip/AccountMenu-trigger/Pagehead); footer quick actions carry active/selected state like nav rows; group separation via `space['2xl']` (padding-only, no dividers — reshuffle decision stands) + rail quick-action gap; editor move/remove keep text labels (no tooltip needed); hovercards untouched + regression test; +11 tests; typecheck+lint clean, full-suite failures flat at pre-existing 90; zero new msgids; see `state/logs/2026-10-29-polish-5-nav-polish.md`)
- [x] 6. Regression pass (Deliverable 6) — `polish/6-regression` (done 2026-10-29: combined coverage confirmed — D1 7 thread-order proofs, D2 8+8 layout/panel tests, D3 40 widget unit tests, D4 10 editor flow tests, D5 11 nav-polish tests, all green; +7 gap-fill pins for slice-5-touched-but-untested surface (Pagehead/MobileStrip/AccountMenu-trigger tooltips + press wiring, post-tree Tooltip-absence with quote card + boost header); quote/repost suites preserved (zero polish imports in Post/Note paths); `intl:extract` + `intl:compile` run per convention (~15 polish msgids + P6.5-chain msgids in, 1 obsolete P6.5 msgid cleaned); `docs/replies.md` §3.2 supersession note added; `pnpm build-web` exports, visual inspection not verified; typecheck+lint clean, full-suite failures flat at pre-existing 90; see `state/logs/2026-10-29-polish-6-regression.md`)

## Acceptance

- [x] Each slice: `pnpm typecheck && pnpm lint` clean; slice tests green;
  full `pnpm test` shows no NEW failures (13 suites / 90 tests pre-existing
  red on the clean tree — verified 2026-10-28, see P6.5 log; re-verified
  identical set on `polish/6-regression`, see its log)
- [ ] `docs/visual-polish.md` acceptance boxes verified per deliverable
- [x] No-gos honored (no server APIs in widgets, no fake data, no deck UI,
  no new deps without record, no identity redesign)

## Out of scope

Deck UI itself, widget server data, feature parity, general refactor
(see plan no-gos).

## Logs

- `state/logs/2026-10-29-polish-*.md` (one per slice)
- Prior: `state/logs/2026-10-28-p6.5-unread-counter.md`
