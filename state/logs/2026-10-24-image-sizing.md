# 2026-10-24 — X-style post image sizing (docs/image-sizing.md) — agent

Branch: `main` (direct; owner doc-driven, no plan slice).
Goal: post media renders full-width at its natural aspect ratio,
clamped to the 2:1-landscape … 3:4-portrait display range — in range
shows in full, only outside shapes crop. Everywhere posts render.

## Did

- `PostMediaGrid.tsx` (the single production path: `PostCard` feed /
  detail / thread / profile + `PostQuote` — `MediaGrid` is test-only
  dead code, untouched):
  - New `displayAspect` (pure) + `MIN/MAX_DISPLAY_AR` (3/4, 2/1).
  - `tileAspect` singles clamp meta-or-16:10 into range; strip branch
    untouched (multi layout out of doc scope).
  - `Still` clamps measured-or-meta for singles (intrinsic onLoad
    already existed; Misskey flat `properties` give instant AR,
    Mastodon nested `meta` falls back to measured — no adapter change).
  - Removed the 320px `maxHeight` cap on singles: it cropped in-range
    portraits (box clamped, `cover` cropped). The ratio clamp now bounds
    height instead. Videos/gifvs ride the same clamp via `tileAspect`;
    video keeps `contain` (never crop playback), gifv loop keeps `cover`.
- Composer upload thumbs + Lightbox viewer deliberately untouched
  (editing UI / full viewer, not timeline display).

## Decided

- No ADR. Multi-strip layout stays until a doc covers it.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **197 suites / 2494 tests green** (+1 suite, +10:
  range/clamp/garbage unit tests + single/strip/sensitive/missing
  render tests).
- Web visual: `not verified` (no desktop browser attached).

## Deviations

- Touched only `PostMediaGrid.tsx` + its new test. Untracked owner
  drops untouched.

## Next

- Owner: visual confirm on desktop web (panorama crops to 2:1, tall
  portrait to 3:4, normal photos full); push `main`.
