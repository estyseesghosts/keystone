# 2026-10-24 — Profile stat cards (follow-up) — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner follow-up with two screenshots — replace the one-line
`N posts · N following · N followers` caption with three stat cards
(big number over label, image 1) instead of the plain line (image 2).

## Did

- `src/locale/i18n.ts`: new `formatCompactCount(locale, n)` beside
  the existing `formatCount` (`Intl` compact, 1 fraction digit, raw
  numerals on failure). 5525 → `5.5K` in English (the mock's `5K`
  truncates 10% away; the decimal is honest and locale-aware).
- `ProfileHeader.tsx`: `StatsLine` → `StatsCards`. Three equal cards
  (`bgSoft`, `radius.lg`, `space.md` padding, `Heading` number over
  faint `Caption`, centered) in a `profile-stats` row. Following /
  followers cards keep the list handlers, link testIDs
  (`profile-following-link`, `profile-followers-link`), and exact
  digits in accessibility labels; posts card is static, as before.
  Same privacy gates: hidden counts render the posts card plus the
  existing honest caption, never placeholder cards.
- Placement: stat cards ride with the bio — under it in the split
  left cell and the centered-bio cell, between bio and fields in the
  mobile stack; after the fields (or alone) when there is no bio.
  Mobile order changes bio/fields/stats → bio/stats/fields, mirroring
  the desktop grouping in image 1. `FollowStateCaption` still last.
- Tests (`profileLayout.test.tsx`): three cards with compact values,
  link handlers fire, hidden-ff shows posts + caption with no
  following/followers nodes. Test bug of mine: `counted()` took no
  args so the `ffVisibility` override silently dropped — now takes
  overrides.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **199 suites / 2557 tests green**.
- Device/web visual: `not verified` (owner compares against image 1).

## Next

- Owner visual check; push `main`.
