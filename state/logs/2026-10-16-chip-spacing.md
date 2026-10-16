# 2026-10-16 — chip line-rhythm follow-up (`docs/spacing.png`)

The first fix (`line-height: 1.25` on `.mchip`) was not sufficient: the
chipped line still stood taller than its neighbors.

Root cause: `overflow: hidden` (required for the ellipsis) moves an
inline-block's baseline to its bottom margin edge, so the whole pill
perched on top of the text baseline and stretched the line box upward.
Fix: `.mchip` now uses `vertical-align: middle` (pill centered inside the
line box) with `line-height: 1.2` so border + text fit inside one 1.45
line box. CSS-only change; `tsc` clean, build green. Visual confirmation
is owner-side (no browser here).
