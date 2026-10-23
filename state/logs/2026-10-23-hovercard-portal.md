# 2026-10-23 — Hovercard blink root-cause + portal rewrite, P6.4 merge, branch prune — agent

Branch: `p6.4-sidebar-reshuffle` → merged to `main` (`2e4b55b`); branch pruned.
Goal: fix rapidly-blinking hovercards; merge sidebar slice; prune 48-branch pileup.

## Did

- **Blink root cause (verified in RNW source, not guessed):** the card
  rendered through RN Web `Modal`, which wraps content in two
  full-viewport `pointer-events:auto` layers (`ModalAnimation` fixed
  inset-0 z9999 div + `ModalContent` root View —
  `node_modules/react-native-web/src/exports/Modal/`). The overlay sits
  above the anchor and steals its hover the frame the card opens:
  `mouseleave` (relatedTarget = overlay, outside both subtrees) → 400ms
  close → unmount → anchor re-hovered → reopen. Self-sustaining ~800ms
  limit cycle. No leave-guard or scroll-grace could fix it (no scroll
  fires; relatedTarget is genuinely outside).
- **Fix (`416d39e`):** dropped RNW `Modal`. New `HoverLayer` appends an
  owned `div` to `document.body` (fixed inset-0, z-60,
  `pointer-events:none` end to end) and portals the card box into it via
  lazily-required `react-dom` `createPortal` (guarded: native bundles
  never evaluate it). Card box is the only `pointer-events:auto` node,
  native DOM enter/leave, explicit sans `fontFamily` stack. Escape /
  scroll / resize dismiss preserved with 500ms mount-settle grace.
  Anchor side unchanged (`onMouseEnter/Leave`,
  `leaveTargetStaysInside`, 400/400ms timers).
- **Tests:** `jest.mock('react-dom')` → inline portal (test renderer
  can't host a DOM portal); no-DOM inline fallback in `HoverLayer` (this
  repo's Jest env has no `document` — proven by probe; the old
  Modal-based tests only passed because RN's test-renderer Modal mock
  renders children inline, i.e. they never tested the Modal layer).
- **Merge + prune:** `p6.4-sidebar-reshuffle` merged to `main` (`2e4b55b`,
  `--no-ff`). Deleted all 46 branches already merged into `main` plus
  `pf-bio` (see below). Only `main` remains locally. `main` is now
  11 ahead of `origin/main` (10 pre-existing + this merge) — **not pushed**.
- **pf-bio verdict (2 commits, both superseded — branch deleted):**
  1. `82711a3` PF-E4 multi-line bio/field newlines — tests-only; the
     behavior landed via P6.4 content pass (`72f0167`); main already has
     `profileFields.test.tsx` + html tests.
  2. `3052f59` PF-E6 translation capability (`detect.ts` probe logic) —
     main's `detect.ts` is strictly newer (adds polls_hide_totals,
     no_quote, announcements, direct_messages, admin_read/write, …)
     and already contains the translation evidence fields
     (`translationAdvertised`, `akkoma:machine_translation`) via the
     merged translate-gate work. Merging pf-bio would have REGRESSED
     `detect.ts`. PF program is closed per STATE.md.

## Decided

- Never render hover floaters in RNW `Modal` (hover-stealing overlay);
  owned click-through portal is the pattern. No ADR (slice-local fix,
  recorded here).
- `main` left unpushed — owner pushes (rig creds / shared repo).

## Tests / verification

- `pnpm run typecheck` (ios+android+web) clean; `pnpm run lint` clean
  (one self-inflicted error fixed: disabled a nonexistent
  `@typescript-eslint/no-require-imports` rule — removed the comment).
- `pnpm test` → **193 suites / 2437 tests green**.
- Browser: `not verified` here (no local-Akkoma testing per owner);
  owner live-verified the fix on external Misskey/Mastodon servers.
- Serif report: cleared in Chromium; explicit card font stack kept.
- Akkoma banner note: local rig default `/images/banner.png` is a
  112-byte stub (200) — "banner doesn't load" there is a data
  artifact; live servers show real banners.

## Deviations

- Touched only `src/components/Profile/HoverPreview(.test).tsx` +
  docs/state files. Untracked owner drops (`docs/k1k2-…`, `ios/`, …)
  untouched.

## Next

- Owner: push `main` (11 ahead of origin).
- Wave 3.3 user moderation (per STATE.md Next steps).
