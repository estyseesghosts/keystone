# 2026-10-16 — Responsive rail sidebar (no toggle)

## Goal

Match the competitor's sidebar behavior while keeping Keystone's look:
no collapse/expand button — the sidebar is a full labeled nav on wide
screens and an icon rail when space runs out (`docs/competitor-sidebar-expanded.png`,
`docs/competitor-sidebar-compact.png`).

## What changed

- `frontend/src/components/Layout.tsx`: manual collapse deleted
  (signal, `localStorage` key, toggle button, `CollapseIcon` import,
  rail `classList`). Keystone styling kept as-is: 15px labels, 16px
  icons, inverted-pill active, plain Post row.
- `frontend/src/styles/global.css`: the old `.collapsed` overrides
  became a desktop-only `@media (min-width: 721px) and (max-width:
  1000px)` rail band (full labels above 1000px, icon rail 1000px and
  below, bottom bar at ≤720px untouched — the band can't leak into
  mobile). Rail keeps the exact collapsed/expanded height parity
  (`min-height: 2.51em`), centered icons, short brandmark.
- `frontend/src/components/AccountCard.tsx`: rail-band menu opens as a
  viewport-fixed flyout right of the avatar (measured on open; query
  string duplicated from the CSS band with a keep-in-sync comment),
  since the 68px rail would otherwise squeeze the 220px menu.
  Resize/scroll now also dismiss the menu (a fixed flyout must not go
  stale; hover cards already close on scroll).

## Evidence (real output)

- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`dist/assets/index-AUxH0Gbv.js`, 257.06 kB;
  `dist/assets/index-BqGKStRb.css`, 36.07 kB).
- Static checks: no `collapsed` class/`COLLAPSE_KEY`/`avatarOnly`/
  `collapse-toggle` references left (only comments + the unused
  `CollapseIcon` export, kept); rail query is desktop-banded so mobile
  labels can't inherit `display: none`.
- Browser behavior (rail appears/disappears across 1000px with no
  height jump, flyout menu usable in rail, menu dismiss on
  resize/scroll, both themes) **not yet verified** (owner).

## Open questions

- Breakpoint 1000px is a judgment call (600px feed + 220–420px rail +
  margins); adjust after seeing real windows.
- Footer stays avatar-only per the previous turn (competitor shows
  name/handle there) — standing unless overridden.

## Next step

Owner resizes across 1000px and 720px (toggle gone; rail↔full with no
button-height jump; rail menu flyout; mobile bar unchanged), both
themes. Then commit with the stack.
