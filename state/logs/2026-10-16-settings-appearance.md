# 2026-10-16 — Real settings page: Appearance (colour mode + text size)

## Goal

The account-menu Settings entry led to a page that read as just the
profile editor (Account info + Edit profile). Wire up a real settings
page; the only settings to configure for now are appearance: colour
mode (light/dark/follow system) and prose text size (0.5x–4x without
rescaling the UI).

## What changed

- `frontend/src/state/appearance.tsx` (new, mirrors the
  `postbox` provider pattern): `AppearanceProvider` + `useAppearance`
  (`colorMode`, `setColorMode`, `textScale`, `setTextScale`).
  Device-local `localStorage` keys (`keystone_color_mode`,
  `keystone_text_scale`) shared across backends/accounts. Stored values
  are validated on load and applied to `<html>` at module init (before
  first paint): explicit mode sets `data-theme`, `system` removes it so
  the `prefers-color-scheme` query governs; scale sets `--text-scale`.
  Pure helpers exported for checks: `parseColorMode` (unknown →
  system), `clampTextScale` (0.5–4 band, non-finite → 1),
  `parseTextScale` (missing/invalid → 1).
- `frontend/src/App.tsx`: `AppearanceProvider` outermost (above auth).
- `frontend/src/routes/Settings.tsx`: new Appearance block FIRST on the
  page, rendered for everyone (signed out included — it is device-local;
  Account + Edit profile stay behind the signed-in gate). Colour mode is
  a native-radio `fieldset` (Follow system / Light / Dark with hints);
  text size is a native `range` (0.5–4, step 0.1) with a live `%`
  `output`, min/max labels, a Reset-to-100% button (disabled at 1x),
  and a live preview line. No new dependencies.
- `frontend/src/styles/global.css`: explicit `:root[data-theme]`
  palettes (attribute specificity beats the media query's bare `:root`,
  so explicit always wins; keep both sets in sync — noted in a
  comment), `color-scheme: light` on the base root, `--text-scale: 1`
  default, px-based scaled-prose rule (`.notebody`, profile/profilecard
  bios, composer textareas, settings preview at 15px-base;
  `.hovercard-bio` at its own 14px-base — nesting-safe, defaults
  byte-identical), monochrome `accent-color` for radios/range, settings
  fieldset/row styles. No accent colors.

## Scope note

Owner request explicitly overrides the AGENTS.md §7 guard ("no theme
toggle, no per-user setting") — the toggle now exists by direct ask.
`docs/frontend-plan.md` deferred line updated accordingly.

## Evidence (real output)

- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`dist/assets/index-BIewzrQW.js`, 242.00 kB;
  `dist/assets/index-WAhJ8nP4.css`, 30.56 kB).
- Pure-helper checks (esbuild bundle + node,
  `/tmp/opencode/appearance-check.mjs`): **26/26 passed** (mode parse
  incl. unknown/case fallbacks, clamp band incl. NaN/Infinity,
  scale parse incl. garbage/empty/bounds).
- Static checks: no `from "react"`, no new colors (only
  `accent-color: var(--text)`), no `innerHTML`; no API calls added
  (appearance is fully client-local).
- Solid checklist (`solidjs.md` §10) walked: context pattern copied
  from `postbox`, signals read via accessors in JSX, no prop
  destructuring, no dep arrays, no `ref` props, setters-only updates.
- No backends on this machine — API suites N/A (no endpoints touched).
  Browser behavior (theme switch incl. system-follow, slider live
  scaling 50–400% with chrome fixed, preview line, persistence across
  reload, signed-out access, mobile layout, keyboard radio/slider
  operation) **not yet verified** (owner).

## Open questions

- None. Possible follow-ups (not started): per-account appearance,
  more settings sections as scopes land.

## Next step

Owner browser-tests on dvd.chat (or local): open Settings from the
account menu signed in and signed out; cycle Follow system → Light →
Dark (page + form controls follow, reload persists); drag text size
50%→400% (note/bio/composer text scales, nav/buttons/timestamps
fixed); Reset returns 100%. Then commit this slice.
