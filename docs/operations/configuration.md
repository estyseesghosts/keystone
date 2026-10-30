# Configuration reference

Source of truth: `app.config.js` (function of `package.json` version,
currently `0.1.0`). It reads **no environment variables** (verified:
no `process.env` read in the file) and defines no `extra` block.

## App identity (release track: owner decision, not done)

| Key                    | Value               | Note                                                |
| ---------------------- | ------------------- | --------------------------------------------------- |
| `expo.name`            | `Keystone`          | Placeholder — owner confirms before any store build |
| `expo.slug`            | `keystone`          | Placeholder                                         |
| `expo.scheme`          | `keystone`          | Deep-link / OAuth-callback scheme                   |
| `expo.version`         | from `package.json` | Single-sourced (`VERSION = pkg.version`)            |
| `ios.bundleIdentifier` | `app.keystone.dev`  | Placeholder; needs signing identity + provisioning  |
| `android.package`      | `app.keystone.dev`  | Placeholder; needs signing identity                 |

Release signing, App Links / domain + `assetlinks.json`, and final
name/bundle identifiers are **out of scope** (tracked in
`state/STATE.md` §owner actions; `app.config.js` header carries the
`TODO(D3, owner)`).

## Platform blocks

- **iOS** (`app.config.js:27-48`): `supportsTablet: true`; scene
  lifecycle manifest declaring `EXExpoAppSceneDelegate` (required —
  iOS 27 SDK traps at launch without scene adoption).
- **Android** (`app.config.js:49-70`): `allowBackup: false` (MMKV holds
  session envelopes + query cache — must never ride device backup);
  `softwareKeyboardLayoutMode: 'pan'`; `intentFilters` with exactly
  `VIEW / keystone://auth/callback`, `autoVerify: false` (no App
  Links: no signing identity, no domain — accepted risk recorded in
  ADR `0012-miauth-callback-risk.md`); `adaptiveIcon` from
  `./assets/adaptive-icon.png`.
- **Web** (`app.config.js:77-85`): Metro bundler, favicon + splash from
  `./assets/`.

## Expo plugins (`app.config.js:93-98`)

1. `./plugins/withAppleTeamId.js` — Apple Team ID injection.
2. `./plugins/withSceneLifecycle.js` — scene-delegate wiring.
3. `expo-image-picker` (`cameraPermission: false`,
   `microphonePermission: false`) — only `launchImageLibraryAsync` is
   used; camera/mic permission requests are stripped at merge time.
4. `./plugins/withAndroidHardening.js` — cleartext-traffic off,
   backup/permission policy (writes `backup_rules.xml` /
   `data_extraction_rules.xml` excluding `files/mmkv/` if backups are
   ever re-enabled). Listed last so its `tools:node="remove"` markers
   win.

## Environment variables (complete — every `process.env` hit by grep)

The app itself reads **none**: no `EXPO_PUBLIC_*`, no config env. The
only `process.env` reads in `src/` are `NODE_ENV === 'test'`
(`src/lib/logger.ts:167`). Everything below is scripts-only:

| Variable(s)                                            | Used by (run via)                                                                            | Default                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `FEDI_SMOKE_URL` (comma-separated) / `--url` / `--all` | `scripts/fedi-smoke.ts` (`pnpm smoke`)                                                       | none — required                                  |
| `FEDI_SMOKE_TOKEN`                                     | `scripts/fedi-smoke.ts` (authed `me` + stream-connect rows)                                  | unset → those rows `skip`                        |
| `FEDI_W4_ORIGIN` / `FEDI_W4_USER` / `FEDI_W4_PASSWORD` | `scripts/fedi-w4-probe.ts` (`pnpm probe:w4`)                                                 | `http://127.0.0.1:4000` / `akk1` / `password123` |
| `FEDI_W5_ORIGIN` / `FEDI_W5_USER` / `FEDI_W5_PASSWORD` | `scripts/fedi-w5-probe.ts` (`pnpm probe:w5`)                                                 | same as above                                    |
| `FEDI_W8_ORIGIN` / `FEDI_W8_USER` / `FEDI_W8_PASSWORD` | `scripts/fedi-w8-probe.ts` (`pnpm probe:w8`), `scripts/fedi-wsc-probe.ts` (`pnpm probe:wsc`) | same as above                                    |
| `FEDI_CAPTURE_TOKEN` or `--token`                      | `scripts/fedi-capture.ts`                                                                    | none — required for live capture                 |
| `CDP_PORT`                                             | `scripts/helium.mjs` (`pnpm helium`)                                                         | `9222`                                           |

Never commit a token; all probe writes clean up after themselves
(except `--include-writes` captures, which create-then-delete their own
probe posts).
