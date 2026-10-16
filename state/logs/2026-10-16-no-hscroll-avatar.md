# 2026-10-16 — No viewport scroll + avatar-only sidebar footer

## Goal

Owner reports: (1) the whole viewport is still horizontally scrollable —
it never should be; (2) collapse the sidebar's profile detail card into
just the user's avatar, identical in compact and expanded modes.

## What changed

- Viewport backstop (`global.css`): `html, body { overflow-x: clip }`
  (`clip`, not `hidden`, so sticky navs keep working). Page-level
  x-scroll is never legitimate — feeds wrap, popups are capped, bars
  scroll internally.
- Real overflow paths closed: `flex-wrap` added to `.noteactions`,
  `.profile-tabs`, `.renote-banner`, `.scale-row`, `.profile-row`;
  shrink paths added (`.notif > div`, `.pollopt > *` + break-word,
  `.drivefile > div`, `.vispick-text` break-word). These are the rows
  that could force the feed wider than the viewport at large text.
- Sidebar footer is now avatar-only everywhere (`AccountCard.tsx`):
  the name/handle card is gone from the expanded sidebar; the same
  32px chromeless avatar button renders in the expanded sidebar,
  collapsed rail, and mobile strip, so collapse changes nothing
  visually. `avatarOnly` prop removed; both `Layout` call sites
  updated; dead card-text CSS rules removed. Menu (Profile / Settings
  / Switch / sign out) untouched.
- Drive-by fix: the mobile menu-direction rule was scoped to the
  removed `mobile` wrap variant (menu would open upward off-screen in
  the top strip) — rescoped to `.mobile-account .accountmenu`.

## Evidence (real output)

- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`dist/assets/index-C6SZ_ojQ.js`, 256.74 kB;
  `dist/assets/index-BwOYy7b5.css`, 36.08 kB).
- Static checks: no `avatarOnly` / card-text references left in tsx;
  diff reviewed hunk-by-hunk.
- Browser behavior (zero viewport x-scroll at 0.5x–4x both themes both
  widths; avatar-only footer + menu in all three placements; mobile
  menu drops down) **not yet verified** (owner).

## Open questions

- None.

## Next step

Owner verifies: no horizontal page scroll at any text size; footer is
avatar-only with working menu; then commit (stacked on the adaptive
layout slice).
