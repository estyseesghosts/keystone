# Device checks — owner-run checklist (repair program 2026-10-25, slice X12.1)

Every item below is something agents could not run: no simulator/device and
no reachable rig in the agent environment. Each item names its originating
slice + session log so the owner can ask follow-ups. Mark each `[ ]` → `[x]`
with the device/OS + result when done.

Conventions: "kill" = swipe away from recents / stop process; "relaunch" =
cold start from the launcher. Two devices are ideal (one iOS, one Android);
where only one is available, note which was used.

Deduplication note: many slice logs carry a generic
`Device/web runs → not verified (device)` template line with no specific
observable behavior (X2.2, X2.3, X2.4, X3.1, X3.2, X3.3, X4.1, X4.2, X4.5,
X5.5, X6.1–X6.4, X7.3, X7.4, X8.3, X8.4, X9.1–X9.5, X9.7, X9.8). Those are
covered by the specific items below plus the Wave 9 spot-check (§18); they
are not separate checks.

## Auth, vault, sessions

### 1. Native `crypto` present — PKCE login on iOS + Android
- Source: X2.1 (`state/logs/2026-10-25-repair25-x2.1.md`); repair §X2.1 acceptance.
- Steps:
  1. Fresh install on iOS and on Android.
  2. Start a Mastodon PKCE login (browser/app-auth session opens).
  3. Complete the authorize leg and return to the app.
- Expected: login completes on both OSes; no `errors.crypto.unavailable`
  surface. (Pre-fix code silently fell back to `Math.random`; post-fix code
  throws a typed error when `globalThis.crypto` is absent, so a missing
  polyfill shows up here, not as weak randomness.)

### 2. Mastodon `createPost` on device (idempotency key path)
- Source: X2.1 (`state/logs/2026-10-25-repair25-x2.1.md`).
- Steps:
  1. Sign in to a Mastodon account on Android and on iOS.
  2. Post a text note from each; then post again with the network flaky
     (toggle airplane mid-send, restore, retry the same body).
- Expected: both posts land exactly once; a timeout-then-retry of an
  unchanged body reuses one `Idempotency-Key` (no duplicate posts).

### 3. SecureStore round-trip after kill/relaunch
- Source: X1.1 (`state/logs/2026-10-25-repair25-x1.1.md`); repair §X1.1 acceptance.
- Steps:
  1. Sign in on iOS and on Android (one Misskey-family + one Mastodon account
     if possible).
  2. Kill the app, relaunch.
- Expected: still signed in on both OSes; timelines load without re-login.
  (Tokens + Mastodon `client_secret`s live only in SecureStore + memory.)

### 4. Upgrade migration — token moved out of MMKV
- Source: X1.1 (`state/logs/2026-10-25-repair25-x1.1.md`).
- Steps (needs a pre-X1.1 install, or a test build seeded with a legacy
  envelope that still carries `token`):
  1. Launch the new build over the old data.
  2. Dump every MMKV value (`JSON.stringify` of each key) and search for the
     token substring.
- Expected: first launch writes the token to the vault (verified by
  read-back), then rewrites the envelope without `token`; no MMKV value
  contains the token. Migration is idempotent — launching twice is safe.

### 5. Sign-out leaves no data (inspect MMKV)
- Source: X1.2 (`state/logs/2026-10-25-repair25-x1.2.md`).
- Steps:
  1. Sign in on iOS and on Android, browse (populate cache, drafts, recents).
  2. Remove the account; relaunch clean.
  3. Enumerate all MMKV keys and the query cache; search for the session id.
- Expected: no MMKV key contains the removed id (drafts, account, soft-mute,
  emoji recents/favs, like-emoji, homeTab, per-session query blob all gone);
  re-adding the same account shows cold data, not the old cache.

### 6. Draft-autosave notice on a locked store
- Source: X1.3 (`state/logs/2026-10-25-repair25-x1.3.md`).
- Steps: on a device with storage writes failing/locked (or simulated),
  type a draft and wait for autosave.
- Expected: a non-blocking notice appears (translated `msg` string); no crash,
  no lost composer text beyond the unwritten save.

### 7. Revoked-token drop, toast, Login routing
- Source: X1.5 (`state/logs/2026-10-25-repair25-x1.5.md`).
- Steps:
  1. Sign in on iOS and on Android.
  2. Revoke the token server-side (or expire it), then trigger a query.
- Expected: after confirmation the session is dropped (purge runs); exactly
  one "Signed out of \<acct\>: session expired" toast; if it was the last
  session the app routes to Login. A 403 or network error never drops.

## Platform config

### 8. Android backup exclusion + hardening
- Source: X1.6 (`state/logs/2026-10-25-repair25-x1.6.md`); repair §X1.6.
- Steps:
  1. `expo prebuild --no-install` into a scratch dir; diff the manifest.
  2. Confirm `android:allowBackup="false"`, `usesCleartextTraffic` false in
     release, and that `RECORD_AUDIO` / `SYSTEM_ALERT_WINDOW` are absent from
     the release merged manifest.
- Expected: manifest matches `app.config.js` + `withAndroidHardening`;
  runtime behavior on device `not verified` until this pass.

### 9. iOS MMKV backup exclusion — deferred, owner follow-up
- Source: X1.6 DECISIONS line (`docs/DECISIONS.md`, 2026-10-25).
- Note: `NSURLIsExcludedFromBackupKey` is NOT set — it needs a declared
  `expo-file-system` dep (today transitive-only) or a native modulette +
  rebuild. No device check possible yet; deciding the follow-up slice is the
  owner action.

## Composer keyboard

### 10. Composer keyboard layout — Android
- Source: X6.5 (`state/logs/2026-10-25-repair25-x6.5.md`); repair §X6.5.
- Steps:
  1. Open the sheet composer on Android; focus the text input.
  2. Rotate with the keyboard open; dismiss the keyboard; repeat in the Home
     inline composer (own KAV, out of scope — should be unchanged).
- Expected: the focused input stays above the keyboard; no over-shrink, no
  blank gap; rotation safe. Mechanism: manual `maxHeight` cap only (KAV does
  not mount on Android).

### 11. Composer keyboard layout — iOS
- Source: X6.5 (`state/logs/2026-10-25-repair25-x6.5.md`).
- Steps: open the sheet composer on iOS; focus the input; observe the rise.
- Expected: KAV `padding` compensation, no jump (manual `keyboardDidShow`
  handling would fire post-animation and jump — it is not used).

### 12. Prebuild manifest flips to `adjustPan`
- Source: X6.5 (`state/logs/2026-10-25-repair25-x6.5.md`).
- Steps: `expo prebuild` into a scratch dir; diff
  `android/app/src/main/AndroidManifest.xml`.
- Expected: the manifest picks up `adjustPan` from `app.config.js`
  `android.softwareKeyboardLayoutMode: 'pan'` (tracked manifest still says
  `adjustResize` until re-prebuilt — expected drift, not a bug).

## Lightbox + players + uploads

### 13. Lightbox — open at index, zoom, rotate, dismiss
- Source: X7.1 (`state/logs/2026-10-25-repair25-x7.1.md`,
  `state/logs/2026-10-25-repair25-x7.1-x7.2-coordinator.md` §X12.1 notes).
- Steps (real iOS + Android):
  1. Tap the 3rd image of a 4-attachment post → lightbox must open on frame 3
     (counter/caption/playing video all frame 3).
  2. Pinch-zoom + double-tap; swipe-down to dismiss (vs pager-gesture fight).
  3. Rotate mid-view → offset re-syncs to the current frame.
  4. On web desktop: ctrl+wheel/pinch zoom, Prev/Next on a small window,
     Tab trap + focus return with VoiceOver/TalkBack/screen readers.
- Expected: no wrong-frame opens; no gesture-fight lockups; reduced-motion
  respected on dismiss.

### 14. Video pause on scroll/background
- Source: X7.2 (via `state/logs/2026-10-25-repair25-x7.1-x7.2-coordinator.md`
  §X12.1 notes).
- Steps:
  1. Scroll a feed with playing videos/gifv fast → off-screen tiles pause;
     only one audio stream at a time when paging fast.
  2. Background the app mid-play; switch tabs (blur pause).
  3. Check the 44pt audio target, the affordance under reduce-motion /
     data-saver, and that no first-frame autoplay flash appears (async OS
     reduced-motion read; steady state is paused + affordance).
- Expected: pause-on-scroll/background/blur; single audio; no autoplay flash.

### 15. Uploads on device + slow links
- Source: X7.4 (`state/logs/2026-10-25-repair25-x7.4.md`),
  `state/logs/2026-10-25-repair25-x7.3-x7.4-coordinator.md`.
- Steps:
  1. Upload with real cancel → progress % on web + native; 60 s stall on a
     throttled link; kill the server mid-upload → timeout message with the
     file-may-be-stored wording.
  2. iOS: upload a `ph://` iCloud asset (no FileSystem copy step — may fail,
     needs this pass). Android: HEIC photo → stripped+re-encoded (decode
     support varies — fallback is original bytes).
  3. Real geotagged photo → GPS warning; Keep-original round-trip; Drive
     abort on unmount; Mastodon 15 s+ video → processing row then submit
     re-check; avatar/banner crop quality at 400/1500 px; cover fidelity +
     GIF animation in the grid.
- Expected: per-upload cancel works; warnings/notices appear; no silent
  EXIF leak on stripped uploads; video metadata ships unchanged with its
  once-per-session notice (D9).

## Privacy, boot, links, streams

### 16. Privacy-shield overlay in the app switcher
- Source: X2.5 (`state/logs/2026-10-25-repair25-x2.5.md`); D6 default off.
- Steps:
  1. Enable the shield in Settings → Privacy; background the app; open the OS
     app switcher.
  2. Open a DM/chat/conversation screen (shield forced on there regardless of
     pref); switcher again.
- Expected: opaque branded overlay, no content in the snapshot; shield off by
  default. Note: Android `FLAG_SECURE` is out of scope (needs a native
  module) — screenshots/screen-record are NOT blocked on Android.

### 17. Link-preview pref matrix + private-post guards
- Source: X2.5 (`state/logs/2026-10-25-repair25-x2.5.md`).
- Steps: for `tap` / `auto-public` / `off` × public / followers-only / direct
  posts: check unfurl behavior; try auto-translate on a followers-only post;
  Share/Copy on a DM.
- Expected: tap-to-unfurl default; never auto-unfurl non-public; one-line
  "sent to your server" notice on first manual translate of a private post;
  Share/Copy on non-public posts confirm first.

### 18. Boot with the network blackholed
- Source: X3.5 (`state/logs/2026-10-25-repair25-x3.5.md`); repair §X3.5 acceptance.
- Steps: airplane mode / blackholed network → cold launch on device.
- Expected: translated `Loader`, then the "Taking longer than usual" slow
  line after 3 s; app reaches ready via the 5 s config / 8 s session caps —
  never a blank screen.

### 19. Deep links signed-out (cold-open routing)
- Source: X8.2 (`state/logs/2026-10-25-repair25-x8.2.md`).
- Steps: signed out, cold-open `/notifications` and `/users/x` links on
  device (and web).
- Expected: signed-out states render via the real linking config (no crash,
  no dead route). Toast overlap on notched phones + tab-bar clearance feel
  are visual — eyeball them here too.

### 20. Mastodon stream handshake with subprotocol auth (iOS + Android)
- Source: X3.4 (`state/logs/2026-10-25-repair25-x3.4.md`); repair §X3.4 step 7.
- Steps: sign in on iOS and on Android; watch a live feed; background 30 s+
  then foreground.
- Expected: handshake succeeds with `Sec-WebSocket-Protocol` bearer (never a
  token in the URL); background suspend + foreground reconnect; gap-fill of
  first pages only. The `stream-connect` row of `scripts/fedi-smoke.ts`
  records the same outcome against the rig (see `live-checks.md` §11).

### 21. Crash UI + error surfaces
- Source: X8.1 (`state/logs/2026-10-25-repair25-x8.1.md`).
- Steps: force a row crash in a live list; force a screen crash; sign out
  from the root crash screen; check the dev sink; on web, trigger an
  `unhandledrejection`.
- Expected: single `post-row-error` fallback (siblings + list intact, scroll
  alive); screen retry works; root offers try-again + sign-out; nothing
  sensitive in logged output.

## Accessibility + i18n sweep spot-checks

### 22. Screen-reader flows, focus rings, hover-keyboard
- Source: X10.1 (`state/logs/2026-10-25-repair25-x10.1.md`,
  `state/logs/2026-10-25-repair25-x10.1-coordinator.md`).
- Steps: VoiceOver/TalkBack through dialogs, menus, chips, hover previews;
  keyboard-only on web (Escape ×2 in Menu-in-Dialog, focus trap).
- Expected: dialog semantics on the Modal root; visible focus rings; nothing
  keyboard-unreachable.

### 23. Contrast perception + disabled cue
- Source: X10.2 (`state/logs/2026-10-25-repair25-x10.2.md`,
  `state/logs/2026-10-25-repair25-x10.2-coordinator.md`).
- Steps: eyeball primary-button resting/disabled states and placeholder text
  in sunlight + low brightness.
- Expected: labels legible; disabled buttons read as disabled with their
  reason (a11y label), not just dimmed.

### 24. RTL layout, icon mirroring, writing direction
- Source: X9.6 (`state/logs/2026-10-25-repair25-x9.6-coordinator.md`).
- Steps: force RTL (system locale or dev toggle); browse feeds, composer,
  icons, insets.
- Expected: logical-property layout mirrors; icons mirror; text direction
  correct. LTR is pixel-identical by construction (no LTR check needed).

### 25. Wave 9 i18n sweep — English render spot-check
- Source: X9.1–X9.5, X9.8
  (`state/logs/2026-10-25-repair25-x9.1.md` … `-x9.5.md`, `-x9.8.md`).
- Steps: browse every converted screen (feed, notifications, composer,
  drive, lists, settings, profile editor, emoji picker) on device.
- Expected: every string renders in English; no blank labels, no message-id
  text, no frozen-locale leftovers. (Unit behavior is gate-covered; this is
  the human-readable pass the agents could not do.)
