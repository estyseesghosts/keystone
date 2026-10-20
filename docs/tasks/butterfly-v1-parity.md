# Butterfly — match Keystone v1 look and layout

Plan ref: n/a (owner direction; see ADR-0002 — butterfly is the simple,
mobile/touch-friendly layout, current `src/` tree)
Status: in progress
Branch: TBD (branches from `p3.1-signin-functional` once merged, else `main`)

## Goal

Butterfly looks and is laid out like Keystone v1, on phone-size and on
wide (tablet/desktop) screens.

## Read first

- Old Keystone `frontend/src/styles/global.css`, `state/appearance.tsx`,
  `components/Layout.tsx`, `components/NoteCard.tsx`,
  `components/TimelineFeed.tsx`, `components/AccountCard.tsx`
- v2 `src/alf/` (theme, tokens, breakpoints), `src/Navigation.tsx`,
  `src/components/Post/`, `src/screens/HomeFeed.tsx`
- Survey notes in the session log (background research)

## Steps

- [x] 1. Survey v1 visual system (CSS variables, breakpoints, regions) — see session log
- [x] 2. Survey v1 post/feed component anatomy — see session log
- [x] 3. Shell chrome: icons (`src/components/icons.tsx` +
  `react-native-svg`), sidebar 220/rail 68, mobile strip + tab bar, pagehead,
  FAB, route titles — trio green, Helium screenshots verified
  (desktop/mobile/rail/light + v1 reference on :5199)
- [x] 4. Post card parity (Helium-proven vs Akkoma): inline icon+count
  action bar, v1 timestamps, counts line removed, v1 CW box, mine reaction
  chips, horizontal media strip, inline home composer, floating compose
  overlay (desktop card + mobile full-bleed) — post-login `reset`-to-Main
  fix included
- [x] 5. Popup/menu parity: `AnchoredPopup` primitive (measure + flip +
  viewport-scroll correction, instant open), audience vispick, composer More
  menu, emoji popup, note/boost/profile menus migrated off dialogs —
  Helium-proven (audience, note menu)
- [x] 6. Motion: route transitions off, all modal/popup/dialog animation none
  (v1 has no route transitions; popups appear instantly)
- [x] 7. Composer chrome parity: compact inline variant (avatar row, icon
  toolbar, audience pill, counter + Post) + modal uses it too —
  Helium-proven in the live session
- [ ] 8. Feed chrome parity: separators, thread connectors, empty/loading/
  error states, skeletons, "N new posts" pill decision, grammar fixes

## Acceptance

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green
- [ ] Side-by-side screenshots (v1 vs butterfly, phone + wide) pasted in log
- [ ] No `packages/fedi` changes; no wire in `src/`; tokens via alf only

## Out of scope

- Tarantula (widget/deck layout) — no widget code lands in this slice
- New features v1 lacks; behavior changes beyond visual parity (log them)

## Log

- (session log to be written when the slice lands)
