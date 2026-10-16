# 2026-10-16 — Settings as pages, editor out (`docs/competitor_settings.png`)

## Goal

Two asks: (1) the profile editor should not appear in client settings
at all; (2) client settings should be organized into pages like the
competitor (section list → detail pages).

## What changed

- `frontend/src/routes/Settings.tsx`: `/settings` is now an index
  listing only the sections that exist — "Your account" (session info
  + sign out) and "Accessibility and display" (colour mode + text
  size) — each a full-width row link with title, hint, and chevron.
  Detail routes `AccountSettings` (`/settings/account`, keeps the
  authReady + signed-in gates and sign-out) and `DisplaySettings`
  (`/settings/display`, ungated — device-local) each carry a "Back to
  settings" link. `ProfileEditor` removed from settings entirely; the
  only editor left is the "Edit profile" button on your own profile
  page. No search box (two sections don't need one), no stub rows.
- `frontend/src/App.tsx`: `/settings/account` + `/settings/display`
  routes (same flat pattern as the followers/following sub-routes).
  The account-menu Settings entry lands on the index — no change needed
  there.
- `frontend/src/styles/global.css`: `.settings-list` / `.settings-row`
  styles — border-separated rows, hover fill, muted hint + chevron,
  global focus rule applies. Monochrome only.

## Evidence (real output)

- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`dist/assets/index-DLc6H7jc.js`, 242.85 kB;
  `dist/assets/index-DmjHJPo5.css`, 31.05 kB).
- Static checks: `ProfileEditor` referenced only by `Profile.tsx`
  (+ its own file); no "Edit profile" outside `Profile.tsx`; no
  `from "react"`, no new colors, no inert controls (every listed row
  navigates to a real page).
- Solid checklist (`solidjs.md` §10) walked: static section array
  rendered with plain `.map` (fixed list, not a dynamic collection —
  `<For>` unnecessary), reactive reads via accessors, `<Show>` gates
  preserved from the previous page, no dep arrays, no `ref` props.
- No backends on this machine — API suites N/A (no endpoints touched).
  Browser behavior (index → detail → back navigation, signed-out
  account page, mobile single column) **not yet verified** (owner).

## Open questions

- None. New settings sections (notifications? privacy?) arrive as new
  rows + routes when a scope lands them.

## Next step

Owner clicks through: account menu → Settings → both sections → back;
signed-out pass; mobile widths. Then commit this slice (with the
appearance slice below it).
