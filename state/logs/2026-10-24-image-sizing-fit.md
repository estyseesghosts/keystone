# 2026-10-24 — Post media: hugging frame, crop-only-outside — agent

Branch: `main` (direct; owner follow-ups, no plan slice).
Goal: (1) max-height clamp must scale down, not crop; (2) per the
doc's last line, crop ONLY outside images; (3) the frame must hug the
displayed media (left-justified), not force max width.

## Did (`PostMediaGrid.tsx`, all post surfaces via PostCard + PostQuote)

- Height cap 480 stays, but it now scales down: single stills render
  `contain` in-range (full-bleed when uncapped, letterboxed side bars
  when capped) — the cap never crops.
- Crop only outside (`isOutOfRange` pure helper): single stills/gifvs
  with natural AR outside 2:1…3:4 render `cover` into the clamped box;
  everything else `contain`. Videos keep `contain` always (never crop
  playback + controls).
- Frame hugs content: single frame width = `480 × aspect` with
  `maxWidth: 100%` — uncapped images hit maxWidth and stay full-width,
  capped ones shrink to the displayed size, left-justified like post
  content (no centering). No measurement, no extra layout pass, no
  mount flash; identical on all platforms.
- Videos/gifvs ride the same frame; strip layout untouched.

## Decided

- No ADR. Bars inside a capped frame show page bg (standard
  letterbox); no bg fill added.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **197 suites / 2499 tests green** (+5: `isOutOfRange`,
  out-of-range cover, growth-skip, null-height skip, malformed node;
  resizeMode asserted on the host Image — `onOpen` passed so the
  Pressable label can't collide).
- Web visual: `not verified` (no desktop browser attached).

## Deviations

- Touched only `PostMediaGrid.tsx` + its test. Untracked owner drops
  untouched.

## Next

- Owner: visual confirm (panorama crops to 2:1, tall art fits capped
  left-justified, normal photos full-bleed); push `main`.
