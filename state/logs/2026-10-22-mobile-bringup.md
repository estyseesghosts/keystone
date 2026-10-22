# 2026-10-22 — mobile bring-up (Oppo PLG110 + iPhone 12 Pro Max) — agent

Branch: `main` (uncommitted at close; owner decides commit)
Goal: `pnpm android` and `pnpm ios` running on the two connected devices.

## Did

- **Devices confirmed**: Oppo PLG110 (`3B15A500TQD00000`, Android 16) via adb;
  iPhone 12 Pro Max (`00008101-000A113A3E82001E`, iOS 27.0.1) via devicectl.
  Xcode 27.0, Expo SDK 57.0.31 (local CLI), CocoaPods 1.17.0, JDK 17 pin +
  `~/.gradle` intact from prior session. Recreated gitignored
  `android/local.properties`; killed a stale `expo start --web` holding :8081.
- **Android blockers fixed**:
  - `debug.keystore` missing → regenerated with standard debug credentials
    (gitignored). Then `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (stale install,
    old signature) → `adb uninstall app.keystone.dev`, reinstall clean.
  - Metro `Failed to get the SHA-1 for .../.worklets/*.js` on every bundle:
    worklets `bundleMode` writes generated files mid-build that this repo's
    Metro never sees → turned bundleMode OFF (`babel.config.js` drops
    `bundleMode:true`; `metro.config.ts` drops `getBundleModeMetroConfig`,
    gesture-handler web guard kept). `src/` has zero direct
    worklets/reanimated imports, so no app change.
  - Aligned `expo@~57.0.31` + `gesture-handler@~2.32.0` via `expo install`;
    `pnpm-workspace.yaml` overrides (reanimated 4.7.1 / worklets 0.13.0 /
    screens 4.30.0, P1.1 Bluesky mirror) deliberately KEPT — bundle failure
    was the watcher, not the versions.
  - Result: `Android Bundled 11611ms index.ts (1929 modules)`; Oppo renders
    the full logged-in Home feed (screenshot `ks-oppo.png`).
- **iOS signing chain fixed**: Developer Mode was off (owner enabled);
  zero signing identities → owner created Apple Development cert, but it
  showed untrusted (missing Apple WWDR G3 intermediate) → installed
  `AppleWWDRCAG3.cer` (apple.com, verified subject/issuer) to login
  keychain → 1 valid identity. First personal team at Apple's free
  3-device cap with no portal access → owner added second Apple ID
  (`67SBCKD5UK`, cert valid) → `plugins/withAppleTeamId.js` pins team via
  `withXcodeProject` (manual pbxproj edits do not survive prebuild; first
  draft wrote the identity unquoted and corrupted the project — fixed with
  embedded quotes). `-allowProvisioningUpdates` xcodebuild bootstrapped the
  profile; `devicectl device install app` + VPN & Device Management trust
  (owner) got it on the phone.
- **iOS launch crashes fixed** (crash reports via `idevicecrashreport`):
  1. No `UIApplicationSceneManifest` → iOS 27 traps in
     `...NoSceneLifecycleAdoption` before JS runs. Fixed via `ios.infoPlist`
     scene manifest (`EXExpoAppSceneDelegate`) in `app.config.js`.
  2. Scene delegate `fatalError`: template AppDelegate lacked
     `ExpoReactNativeFactoryProvider` → `plugins/withSceneLifecycle.js`
     adds the conformance (fails loudly on template drift).
- **iOS white screen fixed**: boot hung in `resolveAppHosting` —
  `fetch('/keystone.config.json')` has no URL on native and on iOS that
  promise never settles (Android rejects, Web resolves). Diagnosed with
  temporary breadcrumbs + per-device Metro isolation. Fixed with a
  fail-closed injected prober on native (`src/state/hosting.tsx`);
  breadcrumbs removed. iPhone renders Sign-in (screenshot `ks-iphone2.png`).
- **Metro watcher fixed**: `@expo/metro-config` forces
  `resolver.useWatchman = null`; the Node crawler missed post-start file
  changes (stale bundles served, no HMR). Installed watchman, set
  `useWatchman = true` in `metro.config.ts` (`watchman watch-list` now
  shows the repo). This was also the underlying mechanism of the
  `.worklets` SHA failures.
- **iOS OAuth fixed + live-verified**: completion relied solely on the
  app-relaunch deep link, but `openAuthSessionAsync`
  (ASWebAuthenticationSession) consumes the `keystone://` redirect
  in-session and never re-opens the app → stuck after authorize (Android
  Custom Tabs relaunch, so only iOS stuck). `startMastodonOAuth` now
  returns the session result URL; Login completes inline on iOS only
  (`finishOAuthCallbackUrl`, AuthCallback parity, replay-safe).
  Owner signed in with Mastodon on the iPhone.

## Verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` (oxlint+eslint) clean.
- `pnpm test` → 182 suites / 2287 tests passed (2286 baseline + 1 new
  browser-URL passthrough test).
- Android: `pnpm android` BUILD SUCCESSFUL, installs, bundles, renders feed.
- iPhone: `pnpm ios -- --device 00008101-…` EXIT 0, installs; launches to
  Sign-in; Mastodon OAuth completes to session. Simulator (iPhone 17)
  also builds/runs (used for log access only).
- `pnpm ios` / `pnpm android` bare commands work; device targeting needs
  `-- --device <udid>` when several devices are attached.

## Deviations (all bring-up scope)

- `package.json` + `pnpm-lock.yaml`: expo 57.0.24→~57.0.31,
  gesture-handler 3.3.0→~2.32.0.
- New: `plugins/withAppleTeamId.js`, `plugins/withSceneLifecycle.js`,
  `ios/` (untracked, generated), `android/app/debug.keystore` +
  `android/local.properties` (gitignored).
- Edited: `app.config.js` (plugins, scene manifest),
  `babel.config.js` (bundleMode off), `metro.config.ts` (bundleMode
  wrapper off, `useWatchman=true`), `src/state/hosting.tsx` (native
  fail-closed config prober), `src/screens/LoginFlows.ts` (return browser
  URL), `src/screens/Login.tsx` (iOS inline completion),
  `src/screens/LoginFlows.test.ts` (+1 test), `docs/DECISIONS.md` (+8 rows).
- Machine-local only: watchman via brew, AppleWWDRCAG3 in login keychain.

## Next

- Owner: commit decision for the dirty tree on `main` (see status).
- iPhone stays on the second Apple ID's free provisioning (7-day profile
  expiry → rebuild weekly; paid team removes the cap).
- DDI for iOS 27.0.1 still absent (`connected (no DDI)`) — harmless so far
  (install/launch/screenshot/log-relay all work without it).
- Misskey MiAuth iOS callback deep link has the same in-session gap;
  manual "I've approved" polling covers it — inline completion if wanted.
