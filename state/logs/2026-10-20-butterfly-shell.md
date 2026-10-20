# 2026-10-20 — Butterfly shell (v1 parity, slice 1) — agent

Branch: `p3.1-signin-functional` (shell work rides along; splits before merge)
Goal: butterfly shell chrome laid out exactly like Keystone v1.

## Did

- Recorded ADR-0002 (butterfly vs tarantula) + index + DECISIONS rows.
- Two background surveys (verbatim results in the session transcript):
  layout/CSS system and post/feed component anatomy of v1.
- `react-native-svg@15.15.4` added (Expo SDK 57 track) for the icon set.
- New: `src/components/icons.tsx` (17 original stroke icons, v1 style) +
  `src/components/__tests__/icons.test.tsx` (17 tests).
- New: `src/components/Pagehead.tsx` (v1 `.pagehead`, hidden on mobile);
  Home/Network/Note/Notifications migrated; `FeedHeading` deleted.
- New: `src/alf` shell cut points (`butterflyPx`: 720/1000/220/68/600) +
  `useShellLayout()`; `src/routes.ts` `titleForRoute` (v1 strip mapping).
- `src/Navigation.tsx` rewritten: Sidebar (220 full / 68 rail, sticky,
  icons, active-inverted, Post button, account footer, Settings),
  MobileStrip (back | section title | avatar/Sign in), ButterflyTabBar
  (icon + 10px label, active inverted), maincol maxWidth 600, right rail
  restored on wide. `src/navigationRef.ts` carries the root ref.
- `src/components/ComposeFab.tsx`: v1 56px circle, mobile-layout only.
- `src/state/session/SessionProvider.tsx`: `useOptionalActiveSession`
  (shell never crashes provider-less trees).
- Test maintenance (honest, behavior-pinning): `integration.test.tsx`
  pins mobile via `react-responsive` mock; `nav.test.tsx` wraps bare
  `Navigation` in `I18nProvider`. Zero production-code weakening.
- `scripts/helium.mjs`: CDP driver for Helium (`new-tab/goto/shot/eval/
  close`). Keeper, untracked. Gotcha: emulation override drops when the
  last CDP client disconnects — `shot` holds one socket for the whole flow.

## Decided (-> ADR/DECISIONS)

- ADR-0002 accepted: butterfly (this tree) vs tarantula (later, rides
  `FeedDescriptor` columns). No widget code in this slice.
- `react-native-svg` picked for icons (standard Expo lib; dev-client
  rebuild already required).
- Mobile tab wording follows v1 exactly: "My Network" + "Search"
  (sidebar keeps "Network"-family "My Network"/"Explore").
- Strip back button always rendered (v1); no-op without history, like a
  browser back button. Sidebar signed-out has no Login entry (footer
  Sign in covers it); the Login *tab* is mobile-only.

## Tests / verification

- `pnpm typecheck` (ios+android+web): green. `pnpm lint`: exit 0.
- `pnpm test`: **61 suites / 837 tests pass** (820 prior + 17 icon tests).
- Failures fixed mid-session: web-only CSS values in RN styles (`as unknown
  as ViewStyle`); `useNavigationState` illegal outside screens (listener
  leaf tracker); `useSyncExternalStore` infinite loop from inline
  fallbacks (module-level `EMPTY_SNAPSHOT`/`NO_SUBSCRIBE`).
- Helium CDP proofs (all viewed, `/tmp/v2-*.png`):
  - desktop 1440 dark signed-in (dvd.chat): sidebar/pagehead/feed/right
    rail all correct; active states track.
  - mobile 390 dark: strip + tab bar + FAB correct.
  - rail 800: 68px icon rail + K brand correct.
  - mobile 390 light: light theme correct; labels/back verified.
  - v1 shot on :5199 (fresh `vite --port 5199`, signed out): sidebar/footer
    wording, strip, mobile tabs confirmed as the reference.
- Signed-in v1 pixels still uncompared (no working :3000 creds; will not
  approve MiAuth as the owner). Source surveys stand in.

## Deviations / follow-ups (post slice owns these)

- Post action bar is still v2 pills, not v1 inline icon+count actions.
- `FeedView` "N new posts" pill is a v2 invention (v1 silently prepends);
  keep-or-remove goes to the feed slice. Grammar bugs spotted live:
  "1 new posts", "1 boosts".
- `Notifications` grouped/flat subtitle dropped with the pagehead.
- maincol not centered on mid widths? Verify in feed slice screenshots.
- No safe-area insets on tab bar/strip (fixed padding); real-device check.
- `scripts/helium.mjs` untracked keeper; v1 dev on :5199 left running.

## Next

- Feed slice: post card parity (avatar/header/media/reactions/action bar,
  CW, quotes, timestamps), separators/thread lines, skeleton/empty/error
  states, pill decision. Then popups/menus/emoji-picker chrome.
- Owner: sign-in branch merge review; device runs.

## Bluesky reference paths consulted

- None (v1 `frontend/src` carried the patterns; ADR-0001).
- v1 paths read: `styles/global.css`, `state/appearance.tsx`,
  `components/Layout.tsx`, `components/icons.tsx`, `components/stripTitle.ts`
  (+ survey coverage of NoteCard/TimelineFeed/Reactions/AccountCard/etc.).
