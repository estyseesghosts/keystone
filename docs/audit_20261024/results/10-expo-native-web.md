# Expo / Native / Web Audit — 2026-10-24

Scope: `app.config.js`, `metro.config.ts`, `babel.config.js`, `index.ts`,
`index.web.ts`, `src/App.tsx`, `src/App.web.tsx`, `src/Root.tsx`,
`src/platform/*`, `src/sys/*`, `plugins/*`, `ios/*` + `android/*` (skim),
SDK 57 alignment, media/picker, hosting/prober/OAuth, build hygiene.
Context: `state/logs/2026-10-22-mobile-bringup.md`.
Method: full reads of configs + platform files; greps for `Platform.OS`,
`window.`/`document.`/`localStorage`, `expo-`, gesture-handler, reanimated/worklets,
`KeyboardAvoiding`, `SafeArea`, `Dimensions`, `StatusBar`, `Linking`;
`npx expo install --check` executed. Line numbers are current-`main` at audit time.

## SDK/config findings

- **F1 (confirmed, medium): declared deps overridden past SDK 57 pins.**
  `package.json:71` (`react-native-reanimated: 4.5.1`),
  `package.json:76` (`react-native-worklets: 0.10.1`),
  `package.json:73` (`react-native-screens: ~4.26.2`) are all superseded by
  `pnpm-workspace.yaml:8-10` (reanimated `4.7.1`, worklets `0.13.0`, screens
  `4.30.0` — installed versions verified on disk). `npx expo install --check`
  reports exactly these three as misaligned (expects reanimated `4.5.1`,
  screens `~4.26.0`, worklets `0.10.1`). The keep-the-overrides call is
  recorded (`docs/DECISIONS.md:170`), and both devices bundled per the
  bring-up log — but this is now the top native-crash suspect for any future
  stack-trace inside reanimated/screens/worklets, because the versions were
  chosen to mirror Bluesky, not SDK 57. (`@types/react`, `typescript` also
  flagged by `--check`; out of scope, noted only.)
- **F2 (low): dead dep `react-responsive`.** `package.json:77` still declares
  `react-responsive@^10.0.1`, but there are zero runtime imports — only
  "why we left" comments (`src/alf/useViewportWidth.ts:7`,
  `src/alf/breakpoints.ts:21-22`). It ships no code (never imported), but it
  invites a future contributor to reintroduce the exact bug those comments
  describe (media queries inert on native, desktop shell on phones).
  Remove the dep.
- **F3 (ok, verified): gesture-handler posture is correct.**
  Zero `GestureHandlerRootView` usages and zero gesture imports in `src/`
  (grep `Gesture|PanGesture|TapGesture|…`: no matches) is *not* a bug — nothing
  consumes the gesture system (`docs/DECISIONS.md:107`: bottom sheets deferred,
  no gesture code anywhere). `index.ts:1` imports `react-native-gesture-handler`
  first (native entry only), `index.web.ts:1-7` correctly omits it, and
  `metro.config.ts:25-38` throws on any web-side gesture-handler import.
  If/when gestures land, a root view becomes mandatory — until then this is fine.
- **F4 (low): worklets babel plugin runs over everything, used by nothing.**
  `babel.config.js:72` keeps `react-native-worklets/plugin` (correctly last),
  `metro.config.ts:5-11` documents bundleMode OFF. Grep confirms zero
  `reanimated|worklet|useAnimated|useSharedValue` imports in `src/`. No
  functional issue; the plugin is pure build cost + a latent "SHA-1" failure
  mode if anyone re-enables bundleMode without the watcher fix. Fine as-is.
- **F5 (low): `useWatchman = true` is a fresh-machine footgun.**
  `metro.config.ts:45` forces the resolver onto Watchman (correct for this
  repo's watcher race, `docs/DECISIONS.md:176`). If Watchman is not installed,
  Metro fails rather than falling back — new contributors hit this before any
  app code runs. The brew prerequisite is mentioned in config comments; confirm
  it is also in `docs/setup.md`-class onboarding (not verified here).
- **F6 (ok): SafeArea done right.** Single `SafeAreaProvider` at
  `src/Root.tsx:85-93` with zero `initialMetrics` fallback, provider-optional
  reads via `src/components/insets.ts:11-12`, no nested providers (only test
  trees). No action.
- **F7 (negligible): `StatusBar.setBarStyle` runs unguarded on web.**
  `src/state/systemUI.ts:18-27` — line 19 executes on all platforms; only the
  background-color calls are platform-guarded (`:20`, `:23`). RN-web's
  StatusBar setter is a no-op so this is harmless, but the file's own "Web is
  guarded" comment (`:13`) over-claims by one line. Leave or add
  `Platform.OS !== 'web'` around line 19 for honesty.

## Native-vs-web divergence (file:line)

All `Platform.OS` branches audited. The DOM-access discipline is consistently
good — every `document`/`window` touch is double-guarded (`Platform.OS ===
'web'` **plus** `typeof document/window === 'undefined'`):
`src/components/Menu.tsx:79`, `src/components/Dialog.tsx:32`,
`src/components/Popup.tsx:167,194`,
`src/components/Recommendations/RecommendationsSettingsOverlay.tsx:186`,
`src/components/Profile/HoverPreview.tsx:308,337,355,381,384,403`.
No `localStorage`, `innerHTML`, or WebView anywhere in `src/` (only comments
renouncing them: `src/components/RichText.tsx:6-7`). Divergences found:

- **D1 (medium): nested `KeyboardAvoidingView`s double-offset on iOS.**
  `src/screens/Compose.tsx:116-129` wraps the whole sheet in a KAV
  (`behavior` ios→`padding` at `:118`), and its content is `CompactComposer`,
  which renders its *own* KAV (`src/components/Composer/CompactComposer.tsx:177-181`,
  same behavior rule at `:180`). On iOS both `padding` behaviors apply, so the
  sheet over-compensates by ~keyboard height when the keyboard is up. On
  Android both use `height` — same double-application. (`Home.tsx:72` uses
  `CompactComposer` standalone, no nesting, unaffected.) Fix: remove one layer
  (the sheet-level KAV in `Compose.tsx` is the natural owner, since it also
  owns `sheetVisibleMaxHeight`/`sheetKeyboardInset` at `:79-82`).
- **D2 (low): Matrix-chip copy is native-only with no web fallback.**
  `src/components/RichText.tsx:710-712` — `onPress` copies only when
  `Platform.OS !== 'web'` (`:711`), and the a11y label even admits it
  (`:705-708`). Web *has* a working clipboard path (`src/lib/clipboard.ts:29-33`
  via `navigator.clipboard`), so this is a pure parity gap, not a capability
  gap. One-line fix: call `copy()` on web too.
- **D3 (low): conditional-hook-call shape in `AuthCallback`.**
  `src/screens/AuthCallback.tsx:86`:
  `Platform.OS === 'web' ? null : Linking.useURL()`. Safe in practice
  (`Platform.OS` is static per bundle), but it is a rules-of-hooks violation
  on its face and will trip `react-hooks/rules-of-hooks` if that lint ever
  lands. Prefer unconditional `Linking.useURL()` (it returns `null` on web
  anyway when unlinked) or a small wrapper hook.
- **D4 (info, verified-sound): `HoverPreview` early-return is hooks-safe.**
  `src/components/Profile/HoverPreview.tsx:515`
  (`if (Platform.OS !== 'web') return <>{children}</>`) sits *after* all hooks
  (`:298-507`), so hook order is stable; DOM portal setup (`:309-318`) is
  effect-guarded. `UserHoverCard.tsx:53`, `PostCard.tsx:178` follow the same
  safe pattern. No action.
- **D5 (info): widgets are web-gated by construction.**
  `src/Navigation.tsx:1096` (`Platform.OS === 'web' && …`) — `RightNav` never
  mounts on tablets. Acceptable for a Phase-5 stub, but record that large-screen
  native currently gets widened feed (`:1099`) instead of widgets; don't let the
  gate survive the real widgets slice unexamined.
- **D6 (info, benign): two module-scope native calls execute on web.**
  `src/screens/Login.tsx:55` (`void WebBrowser.maybeCompleteAuthSession()`)
  and `src/lib/clipboard.ts:18` (`require('expo-clipboard')` inside a function
  body, so Metro still resolves it into the web bundle). Both are no-ops/null
  on web (`clipboard.ts:16` guard; expo-web-browser web stub). `expo-clipboard`
  ships a web implementation, so bundle inclusion is harmless. No action, noted
  so a future auditor doesn't re-flag.
- **D7 (verified-followed): `docs/image-sizing.md` is implemented, not
  aspirational.** `src/components/Post/PostMediaGrid.tsx:41-47`
  (`MAX_DISPLAY_AR = 2/1`, `MIN_DISPLAY_AR = 3/4`, `MAX_DISPLAY_H = 480`) plus
  `displayAspect`/`isOutOfRange` (`:51-62`) match the doc's rules; crop only
  outside the range (`:198`, `:236`). The older fixed-`16/9` tile grid in
  `src/components/MediaGrid.tsx:137` is effectively dead UI — `MediaGrid` has
  no screen importer (only the barrel `src/components/index.ts:7` and tests);
  the live path is `PostMediaGrid` via `PostCard.tsx:71` / `PostQuote.tsx:26`
  (`Lightbox.tsx:13` imports only the `mediaAlt` helper). Consider deleting or
  explicitly marking `MediaGrid.tsx` legacy so the two grids can't drift.
- **D8 (info): image component split.** Live feed grid uses core RN `Image`
  (`PostMediaGrid.tsx:17`); `Lightbox.tsx:1` and `MediaGrid.tsx:2` use
  `expo-image`. Feed scrolling would benefit most from `expo-image`'s caching —
  currently the heaviest image surface uses the lightest component. Worth a
  swap when touching that file (measure first).

## Media/picker findings

- **M1 (medium): `pickMedia` never asks for permission; `pickProfileImage`
  does.** `src/components/Profile/pickProfileImage.ts:23` requests
  `requestMediaLibraryPermissionsAsync()` and returns a typed
  `denied|cancelled|picked` outcome. `src/components/Composer/pickMedia.ts:18-26`
  calls `launchImageLibraryAsync` directly. On iOS 14+ / Android 13+ the system
  picker UI mostly papers over this, but on older Android (pre-Photo-Picker,
  needs `READ_MEDIA_*`) the launch can fail into a silent `canceled` → the
  composer shows nothing and the user learns nothing (`Composer.tsx:484-491`
  only surfaces *thrown* errors). Align `pickMedia` with the profile flow's
  explicit-permission + typed-outcome pattern.
- **M2 (medium): unbounded full-resident media reads, no client size cap.**
  `pickMedia.ts:25` sets `quality: 1` (full-res originals);
  `assetToFile` (`:11-16`) does `fetch(uri)→blob→File`, materializing the
  entire asset in JS memory — a multi-hundred-MB video can OOM the Hermes heap
  before upload starts. `src/state/queries/composer.ts:203-265`
  (`uploadOne`/`uploadAll`) streams whatever `File` it is handed with no size
  validation; only the *count* is capped (`limits.maxMedia`,
  `Composer.tsx:296`). There is no app-side MIME allowlist either — the server
  is the only verdict. Recommend: (a) cap or downscale picker output
  (`quality` < 1 / `allowsEditing`-free resize, or at minimum a `file.size`
  guard with an honest "too large" error before `uploads.add`), (b) surface
  per-family upload limits from capabilities where known.
- **M3 (confirmed doc/code drift): the "10 MB size guard" does not exist.**
  `src/lib/documentPicker.ts:19-20` claims "the 10 MB size guard runs before
  any upload", but no size check exists anywhere in `src/` (grep
  `maxBytes|maxSize|file.size|TOO_BIG`: only server-error strings), and the
  caller uploads unconditionally (`src/components/Settings/TransferSections.tsx:142-145`).
  Either implement the guard or fix the comment — a comment asserting a safety
  property the code lacks is worse than no comment.
- **M4 (medium): every video in view owns a player; feed gifvs all autoplay.**
  `PostMediaGrid.tsx:228-233` (`LoopTile`: `p.play()` on init, muted loop) —
  every gifv tile in every mounted post plays simultaneously, including
  off-screen ones in the horizontal strip (`:430-435`, plain `ScrollView`, no
  windowing, no visibility gating). `Lightbox.tsx:55-69` mounts a player per
  frame for *all* frames at once (`:134-136`) and calls `player.play()` at
  init — opening a 4-video Lightbox starts 4 audio tracks. `MediaGrid.tsx:42-58`
  has the same per-tile-player shape (mitigated: currently dead UI per D7).
  Recommend: play only the focused/visible player (Lightbox: pause on
  `onMomentumScrollEnd` index change at `Lightbox.tsx:130-133`; feed: play on
  viewability, not on mount).
- **M5 (low): import path shares the whole-file-in-memory read.**
  `src/lib/documentPicker.ts:28-29` (`fetch(asset.uri)→blob`) — same OOM class
  as M2 for large CSV/JSON imports, compounded by M3's missing guard. Lower
  severity than media (imports are usually small), fix together with M3.
- **M6 (ok): picker lazy-loading discipline is good.** `expo-image-picker` and
  `expo-document-picker` are both `await import()`-ed at call time
  (`pickMedia.ts:20`, `pickProfileImage.ts:22`, `documentPicker.ts:23`), so
  tests and picker-less bundles never touch the native modules. `assetToFile`
  reuse across composer/profile (`pickProfileImage.ts:12`) is the right seam.

## Hosting/OAuth/prober findings

- **H1 (verified-sound, residual note): native fail-closed prober.**
  `src/state/hosting.tsx:47-52` injects `prober: () => ({status: 0, body: null})`
  on native so `loadRuntimeConfig` never issues the relative-URL fetch that
  hangs iOS forever (Android rejects, web resolves — the iOS-only blank screen
  from the log). `Root.tsx:58-61` additionally catches, defaulting to
  third-party. Live-verified on device per the bring-up log. Residual risk is
  contractual, not behavioral: if `@keystone/fedi`'s `loadRuntimeConfig`
  changes what a `status: 0` probe means, native silently boots to defaults —
  a fedi-side contract test pinning "status 0 ⇒ defaults" would close it.
- **H2 (verified-sound): OAuth callback hygiene is good.**
  `AuthCallback.tsx:73-81` strips one-time params via `history.replaceState`
  preserving path (`callbackCleanHref`, `src/routes.ts:257-264`); pending flows
  are take-once (`LoginFlows.ts:260`, `:323-353` replay guards); both callback
  paths parse identically (`AuthCallback.tsx:48-63`, base-strip exemption in
  `Navigation.tsx:145-152`). The `?code=` in the address bar / server logs
  between load and effect is inherent to OAuth (single-use + PKCE mitigates);
  no change needed. No token-in-`history` leakage beyond the standard code
  (tokens never transit the URL — exchange happens in `completeMastodonOAuth`,
  `LoginFlows.ts:255-283`).
- **H3 (low): iOS MiAuth drops the session result URL.**
  `Login.tsx:410-453` (`submitMiAuth`): on iOS, `openAuthSessionAsync`
  captures the `keystone://…?session=` redirect in-session exactly like the
  Mastodon case (H-background), but `startMisskeyMiAuth` discards the
  browser's return (`LoginFlows.ts:377` — `await opts.openBrowser(url)`,
  return value ignored) and the flow relies solely on polling
  (`pollMisskeyApproval`, default 30×2s). Polling works (log-verified
  strategy), so this is robustness, not breakage — but the unconsumed pending
  row lingers until its 15-min expiry (`LoginFlows.ts:306`), and a slow network
  can time out a flow the callback URL already answered. Consider returning the
  browser URL from `startMisskeyMiAuth` and completing inline like
  `finishOAuthCallbackUrl` (`Login.tsx:468-504`).
- **H4 (info): deep-link table is single-sourced and drift-tested.**
  `src/routes.ts:281-328` derives `linkingScreens()` from `paths`;
  `Navigation.tsx:114-121` + base-aware `getStateFromPathWithBase` (`:155-161`)
  consume it; scheme `keystone` (`app.config.js:25`) + `Linking.createURL`
  prefixes (`Navigation.tsx:115,166`). Android relaunch and iOS inline paths
  both live-verified. No action.

## Build/signing hygiene

- **B1 (ok): no secrets in config; placeholders explicit.**
  `app.config.js:1-69` carries no tokens/keys; identity placeholders
  (`app.keystone.dev`, `keystone` scheme) are flagged TODO pending owner D3
  (`:8-10`). `withAppleTeamId.js:11` bakes in team `67SBCKD5UK` with an
  `APPLE_TEAM_ID` override (`:7`) — a team ID is not a secret, and the
  free-team 7-day re-sign cadence is a documented owner cost (bring-up log).
  When the paid team lands, prefer env-only (no fallback) so CI can't silently
  sign with the wrong team.
- **B2 (ok): keystore/keychain material correctly excluded.**
  `android/app/debug.keystore` ignored via root `*.keystore`
  (`.gitignore:10`); `android/local.properties` via `android/.gitignore:10`
  (both verified with `git check-ignore -v`). `ios/` is fully untracked
  generated output (prebuild regenerates; scene/team plugins re-apply).
  Asymmetry noted: `android/` *is* tracked (gradle files) while `ios/` is not —
  Youngest `ios/` state exists only on the bring-up machine; anyone else runs
  `expo prebuild` to recreate. If that asymmetry is unintentional, either track
  both native dirs or neither.
- **B3 (low): scene-lifecycle plugin is correct but brittle by design.**
  `plugins/withSceneLifecycle.js:17-19` string-patches the AppDelegate
  template and `withAppleTeamId.js:23` relies on verbatim quote serialization —
  both already bit once (unquoted identity corrupted `project.pbxproj`,
  bring-up log). The loud-drift failure (`:30-36`) is the right mitigation.
  Re-verify both plugins after every `expo`/SDK bump (template drift is a
  matter of when).
- **B4 (info): local build outputs present, uncommitted — correct.**
  `android/app/build`, `ios/build`, `.expo/` all untracked/ignored. Nothing to do.

## Top 5 fix priorities

1. **Reconcile reanimated/worklets/screens with SDK 57 (F1).**
   Run `npx expo install --fix` (or pin `pnpm-workspace.yaml:8-10` to the
   `--check`-expected versions) and re-verify `pnpm android`/`ios` bundles +
   full test suite. Current overrides trade a known-good SDK matrix for a
   Bluesky mirror nothing in `src/` uses (F4: zero worklets/reanimated imports).
   Every future native animation/screens crash will otherwise start with
   version doubt.
2. **Un-nest the compose-sheet `KeyboardAvoidingView` (D1).**
   `src/screens/Compose.tsx:116` vs
   `src/components/Composer/CompactComposer.tsx:177` both apply keyboard
   compensation on iOS/Android. Remove the sheet-level (or composer-level) KAV
   and verify on-device that the toolbar tracks the keyboard exactly once.
   Look for siblings while there: any other screen wrapping a component that
   owns its own KAV.
3. **Bound media memory: permission + size guard before upload (M1+M2+M3).**
   Add the explicit permission request to `pickMedia.ts:18` (mirror
   `pickProfileImage.ts:23`), implement the 10 MB guard `documentPicker.ts:19-20`
   already promises (and an equivalent composer-side guard before
   `uploads.add`), and reconsider `quality: 1` (`pickMedia.ts:25`) for
   non-original-intent attachments. A single large video today can OOM Hermes
   via `assetToFile` (`pickMedia.ts:11-16`) with no honest error.
4. **Play only the visible video (M4).**
   Pause off-screen players in `Lightbox.tsx:124-136` (drive play/pause from
   the pager index computed at `:130-133`) and gate feed gifv autoplay on
   viewability instead of mount (`PostMediaGrid.tsx:228-233`). Current behavior
   is N simultaneous audio/video tracks — the most user-visible perf bug in
   this audit.
5. **Complete iOS MiAuth inline (H3) + delete/mark `MediaGrid` legacy (D7).**
   Thread the `openAuthSessionAsync` result URL through
   `startMisskeyMiAuth` (`LoginFlows.ts:365-379`) into an inline completion
   mirroring `finishOAuthCallbackUrl` (`Login.tsx:468-504`), closing the last
   known iOS auth gap from the bring-up log. In the same pass, resolve the
   `MediaGrid.tsx` / `PostMediaGrid.tsx` duplication so the dead fixed-`16/9`
   grid can't silently become the imported one.
