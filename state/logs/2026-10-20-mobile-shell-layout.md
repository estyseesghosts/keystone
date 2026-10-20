# 2026-10-20 — mobile shell layout fix (phone got desktop sidebar) — agent

Branch: `p3.1-signin-functional`
Goal: the Android build rendered the wide/desktop shell on a phone;
restore the phone (butterfly mobile) layout on native.

## Did

- Reproduced the mechanism outside the app: `matchmediaquery` (used by
  `react-responsive`) picks `window.matchMedia` when present and otherwise
  falls back to static matching against `{}`:
  `mm('(max-width: 720px)', {})` → `false`, same for the rail/full
  queries. React Native defines a `window` global but **no**
  `matchMedia`, so every breakpoint query was false on Android/iOS.
- `useShellLayout()` therefore fell through `mobile → rail → full` and
  always returned `'full'` on device: 220px sidebar + 600px centered main
  column squeezed into a 360dp screen. Web was unaffected (real
  `window.matchMedia`), which is why Helium passes never caught it.
- Added `src/alf/useViewportWidth.ts`: `useWindowDimensions().width`
  (dp on native, CSS px on web). Works on every platform, updates on
  rotation/resize.
- Rewrote `src/alf/breakpoints.ts` on top of it:
  `breakpointsForWidth`, `shellLayoutForWidth`, `layoutBreakpointsForWidth`
  are pure width math; `useBreakpoints` / `useShellLayout` /
  `useLayoutBreakpoints` keep their old signatures, so `Navigation`,
  `Compose`, `ComposeFab`, `Pagehead` needed no changes.
  Degenerate widths (0/NaN) resolve to phone, not desktop.
- Cut points unchanged: mobile ≤720, rail 721–1000, full >1000; gtPhone
  500 / gtMobile 800 / gtTablet 1300; right rail from 1100.
- Tests: replaced the `jest.mock('react-responsive', …)` pins in
  `src/screens/integration.test.tsx` and `src/__tests__/nav-escape.test.tsx`
  with a `#/alf/useViewportWidth` → 390 pin; same pin added to
  `src/__tests__/nav.test.tsx` and its tab press now uses the mobile
  tab testID (`tab-Explore`) instead of sidebar label text (mobile label
  is "Search").
- New `src/alf/__tests__/breakpoints.test.ts` locks every cut point
  (10 tests) without a renderer.

## Decided (→ DECISIONS.md entry, no ADR — bugfix-level)

- Breakpoints are width math over `useWindowDimensions`, not
  `react-responsive` media queries. `react-responsive` is now unused;
  removing it from `package.json`/lockfile deferred (no `pnpm` in this
  shell; `pnpm install --frozen-lockfile` would otherwise mismatch).
- Tests pin a 390px viewport instead of relying on jest's default 750px
  window (which is the rail cut point, not phone).

## Tests / verification (commands + results)

- `NODE_ENV=test npx jest src/alf/__tests__/breakpoints.test.ts src/__tests__/nav.test.tsx src/__tests__/nav-escape.test.tsx src/screens/integration.test.tsx src/__tests__/app.test.tsx`
  → 5 suites / 25 tests passed.
- `NODE_ENV=test npx jest --forceExit --testTimeout=20000` → **76 suites /
  950 tests passed** (was 75/940; +1 suite / +10 tests = new breakpoints
  suite). Same pre-existing worker-force-exit warning.
- `tsc -p tsconfig.check.{ios,android,web}.json` → clean (all three).
- `oxlint --quiet` + `eslint` on all six touched/added files → clean.
- Device (Oppo PLG110, USB): `adb shell wm size` 1080x2354,
  `wm density` 480 → 360dp wide; screenshot after Fast Refresh shows the
  mobile strip, content column and bottom tab bar (Home / My Network /
  Search / Notifications / Profile), no sidebar. User confirmed it is
  working on the phone.
- Note: a manual full-bundle curl to Metro while verifying hit
  `Failed to get the SHA-1 for node_modules/react-native-worklets/.worklets/*.js`
  (transient worklets temp-file race). The running app kept working and
  the user confirmed on-device; if Metro wedges later, restart it.
  Also captured on device: pre-existing "VirtualizedLists should never be
  nested" warning in the Home feed (not from this change; see Next).

## Deviations (files touched outside the slice + why)

- `src/__tests__/nav.test.tsx`, `src/__tests__/nav-escape.test.tsx`,
  `src/screens/integration.test.tsx`: only the layout pin changed, as
  required by the fix (the old mocks targeted a module no longer used).
- New files `src/alf/useViewportWidth.ts`,
  `src/alf/__tests__/breakpoints.test.ts`.

## Next

- Remove `react-responsive` from `package.json` + lockfile when `pnpm` is
  available.
- Investigate the nested-VirtualizedList warning on Home (feed list inside
  a ScrollView/FlatList) — visible as a red LogBox toast on device.
- Owner visual pass on tablet width (721–1000 rail, >1000 full sidebar)
  on the phone in landscape / web, since only 360dp was device-verified.
- Safe-area insets still pending (STATE next step 3); status bar overlaps
  nothing now but the tab bar sits above the gesture area by padding only.
