# 2026-10-16 — Global uniform text scaling (correction)

## Goal

Owner correction: the prose-only scale ("buttons, navigation, and
timestamps stay the same size") was not what was wanted. Text scaling
must be global and uniform — every text across the app scales 0.5x–4x —
while the UI itself (spacing, borders, icons, avatars, media) stays
fixed.

## What changed

- `frontend/src/styles/global.css`: all 68 plain-`px` `font-size`
  declarations converted mechanically to
  `calc(Npx * var(--text-scale, 1))` (verified: zero plain-`px`
  font-sizes remain, zero double-wraps). px-based throughout, so nested
  elements never compound and 1x is byte-identical to before. The old
  scaled-prose allow-list collapsed to a comment + the one rule that
  still differs from inheritance (`.hovercard-bio` at its own 14px
  base). No `px` line-heights exist (all unitless), so line rhythm
  scales proportionally on its own. Icons/avatars/media/spacing rules
  untouched.
- `frontend/src/routes/Settings.tsx`: copy corrected — "Scales all text
  across the app … only text changes size" + matching preview line.
- State layer untouched (`appearance.tsx` clamp/persist/apply already
  correct; 26/26 checks stand).

## Evidence (real output)

- `npx tsc --noEmit` (frontend): clean.
- `npm run build`: green (`dist/assets/index-DuTUAbX0.js`, 242.86 kB;
  `dist/assets/index-0LLYSYKU.css`, 32.88 kB).
- Static checks: `grep -c` → 70 `calc(Npx * var(--text-scale))`
  (68 converted + 2 pre-existing), `calc(calc` → none,
  `font-size: [0-9.]` plain → none; no `fontSize` in tsx; no
  `from "react"`, no new colors.
- Browser behavior (uniform scaling at 50%/100%/200%/400% with no
  clipped or overlapping text in feed, detail, profile, drive,
  antennas, search, settings, menus, dialogs; both themes; mobile
  widths) **not yet verified** (owner) — 4x will stress fixed-height
  rows (account card, nav, chips) and is the pass most likely to find
  overflow to fix.

## Open questions

- None.

## Next step

Owner browser pass at the four slider extremes, then commit (with the
settings slices below it).
