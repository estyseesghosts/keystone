# 2026-10-16 — Adaptive layout for text size (padding pass + sidebar)

## Goal

Text scales globally but layout didn't adapt (`docs/keystone_padding.png`
at ~2x: cramped buttons, disproportionate rhythm; `docs/truncated_scrollable.png`:
nav labels truncated to "Ho…/Not…" in the fixed 220px sidebar, tall nav
with no scroll path). Owner directives: layout must adapt to text size;
collapsed and expanded sidebar buttons must keep identical vertical size
(no jump/shrink on toggle); use screen space effectively; never bleed
over boundaries.

## What changed (`frontend/src/styles/global.css` unless noted)

- Spacing is now em-based against each element's own (scaled) text size:
  every text-component padding/gap/margin converted at exact ratios, so
  1x renders pixel-identical while rhythm breathes with text. Fixed
  geometry deliberately stays px: widths, avatars, banner, media,
  mosaic, borders, radii, positioned offsets, overlay scrims, reply
  indents, skeleton shimmer blocks.
- Geometry-linked offsets converted to mixed calc so alignment tracks
  padding: thread-connector `left` (`1.07em + 19px`), last-reply stub
  height, reply-toggle indent, composer-audience indent, quote-media
  flush compensation (split per font base: audio 15px vs mediafile
  13px). Avatar-overlap offsets stay px (avatars fixed).
- Ellipsis-container widths → em (`.name`, `.mchip`, `.tagbubble`,
  popups/menus) so truncation happens at the same character count at
  every scale instead of sooner.
- Sidebar: `width: max-content` with 220px floor (1x unchanged) and
  `min(420px, 40vw)` cap; `overflow-y: auto` so tall navs scroll
  internally; `.navlabel` ellipsis + `min-width: 0` as the beyond-cap
  fallback; `.accountmenu` capped at `min(280px, 100%)` so it never
  bleeds past the sidebar edge. Collapsed rail stays fixed 68px.
- Collapsed/expanded parity: `.sitenav.collapsed .navlink` gets
  `min-height: 2.51em` (= 0.53 + 0.53 padding + 1.45 text line — exact
  expanded total at every scale; first attempt used fixed 16px padding
  in the formula and still shrank, caught on re-check). Comment records
  the formula and what breaks it.
- Mobile: bottom bar `overflow-x: auto` + non-shrinking buttons so
  large-text labels scroll instead of squish; `maincol` bottom
  clearance → em so content never hides under the taller bar.
- Inline tsx spacing aligned (search form, sign-in buttons, drive rows,
  skeleton section padding); skeleton block geometry left fixed.
- All 9 missed plain-`px` font-sizes in the emoji-picker/reactions
  region wrapped into the global scale (zero remain file-wide).

## Evidence (real output)

- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`dist/assets/index-DyC7J_AD.js`, 255.96 kB;
  `dist/assets/index-CqUQGBcj.css`, 36.27 kB).
- Static checks: full-file grep triaged — every remaining px spacing
  value is fixed geometry (listed above); `calc(calc` → none; no
  `from "react"`, no new colors, no inert controls.
- Arithmetic re-check caught two live errors before landing:
  `.noteactions` gap 0.62em→0.53em; collapsed `min-height` formula
  fixed 16px→2.51em.
- Browser behavior (no truncation through ~3x, graceful ellipsis at
  4x, no collapsed/expanded jump on toggle, internal nav scroll,
  connector/avatar alignment at 2x, mobile bar scroll, both themes)
  **not yet verified** (owner — screenshots are the QA rig here).

## Open questions

- At 4x the 420px cap still truncates the longest labels; wider cap
  vs current tradeoff stands — owner call after seeing it.
- Icon/avatar sizes stay fixed while text scales (deliberate); flag if
  the 16px nav icons look lost next to 4x labels.

## Next step

Owner screenshots at 1x (pixel-parity check vs `docs/keystone_profile.png`
era), 2x (the two reported shots), and 4x (cap + overflow hunt),
desktop + mobile widths, both themes. Then commit this slice with the
settings stack below it.
