# 2026-10-21 — android build fix + minSdk 31 — agent

Branch: p3.1-signin-functional
Goal: make `pnpm android` build (fix gradle/expo failures), set minSdk to
Android 12, verify, test on the Oppo.

Did:

- Reproduced `pnpm android` gradle failure via
  `./gradlew :app:assembleDebug`:
  settings evaluation failed with
  `Field 'version' is required for type ... 'Publication' ... at path:
  $.modules[12].projects[0].publication`.
- Traced to `expo-modules-autolinking resolve --platform android --json`:
  modules[12] = `expo-image@58.0.15`; its `publication` lacks `version`.
  Same for `expo-secure-store@58.0.2`, `expo-video@58.0.11` — three SDK 58
  packages in an SDK 57 project (`expo install --check` confirmed).
- Ran `pnpm exec expo install expo-image expo-secure-store expo-video` →
  `~57.0.5` / `~57.0.5` / `~57.0.4`. Re-ran resolve: zero version-less
  publications.
- Pinned `minSdkVersion = 31` (Android 12) in `android/build.gradle`
  buildscript ext (honored via expo-root-project `setIfNotExist`,
  read as `rootProject.ext.minSdkVersion` in `app/build.gradle`).
- Created gitignored `android/local.properties` (`sdk.dir=.../Library/Android/sdk`);
  no ANDROID_HOME in shell env.
- Hit second failure: `:react-native-worklets:configureCMakeDebug[arm64-v8a]`
  → AGP `GeneratePrefabPackages` treats JDK 25 native-access warnings as
  errors. Only JVM was Zulu 25; Homebrew `openjdk@17` already present.
  Pinned `org.gradle.java.home` to it in `android/gradle.properties`.
- `./gradlew :app:assembleDebug` → BUILD SUCCESSFUL (7m). APK verified:
  `aapt dump badging` → `sdkVersion:'31'`, package `app.keystone.dev`.
- Owner adb: phone advertises two mDNS ghosts (`XKJ3ns` + `XKJ3ns (2)`);
  Expo picks the short non-suffix name, which is never connected.
  Both local adb binaries are 37.0.1 (no version skew). Advised
  pair-then-connect via main-screen IP:port; USB cable as fallback.
  Phone side still owner-pending.
- Trio (owner WIP fallout, not dep-related): fixed fused import line in
  dirty `src/Root.tsx` (would also break Metro bundle), missing `storage`
  destructure in new `src/state/appearance.test.ts:86`, removed two
  `eslint-disable react-hooks/exhaustive-deps` comments referencing a rule
  this repo never configures (only custom `keystone` plugin in
  eslint.config.mjs; no other file uses it).

Decided (→ DECISIONS.md entries, no new ADR — bugfix-level):

- SDK 58 expo packages downgraded to SDK 57 (reverses 58.x additions).
- minSdk 31 in build.gradle ext; JDK 17 via `org.gradle.java.home`;
  `local.properties` local-only.

Tests / verification (commands + results):

- `node ... expo-modules-autolinking resolve --platform android --json` →
  25 modules, 0 missing-version publications (was 3).
- `./gradlew :app:assembleDebug --console=plain` → BUILD SUCCESSFUL in
  7m 2s, 513 tasks.
- `aapt dump badging app-debug.apk` → `sdkVersion:'31'`.
- `pnpm typecheck && pnpm lint && pnpm test` → green:
  tsc ios+android+web clean, oxlint+eslint clean,
  75 suites / 940 tests passed.
- `expo install --check` remaining skew (NOT changed, pre-existing):
  expo 57.0.24 (want ~57.0.30), gesture-handler 3.3.0 (want ~2.32.0),
  reanimated 4.7.1 (want 4.5.1), screens 4.30 (want ~4.26),
  worklets 0.13.0 (want 0.10.1), @types/react 19.3.0, typescript 5.9.3.
  Build works with installed versions; full `--fix` deferred (blast radius).
- Device install/launch: not verified (owner adb reconnect pending).

Deviations (files touched outside the slice + why):

- `package.json` + `pnpm-lock.yaml`: expo 58→57 downgrades (build blocker).
- `android/build.gradle`, `android/gradle.properties`: minSdk 31 + JDK 17 pin.
- `android/local.properties`: created, gitignored (SDK discovery).
- `src/Root.tsx`, `src/state/appearance.test.ts`,
  `src/components/Settings/FiltersSection.tsx`,
  `src/components/Settings/MutesSection.tsx`: one-line fixes each to get
  trio green; all owner WIP (dirty/untracked), intent-preserving.
- `docs/DECISIONS.md`, `state/STATE.md`: updated per protocol.

Next:

1. Owner: adb pair → connect via Wireless-debugging MAIN screen IP:port
   (not pairing port), `adb devices` shows single `ip:port device`, then
   `pnpm android` (build+install+Metro). Or USB cable + USB debugging.
2. Consider full `expo install --fix` separately (reanimated/gesture-handler/
   screens/worklets skew) if native crashes appear on device.
3. Run trio again after owner finishes the appearance/Settings WIP edits.
